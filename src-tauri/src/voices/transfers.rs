//! 受控文件会话与有界后台任务。文件处理复用宿主 runtime，不占用引擎 LocalSet。
use super::*;
use std::{collections::HashMap, path::PathBuf};
use talechime::{ImportPreview, TransferControl, TransferLimits};
use tauri::Manager;

#[derive(Default)]
pub(super) struct Transfers {
    next: u32,
    selections: HashMap<u32, Vec<PathBuf>>,
    previews: HashMap<u32, PreviewSlot>,
    tasks: HashMap<u32, TaskSlot>,
}
struct PreviewSlot {
    ready: Option<ImportPreview>,
    submitted: Option<(Vec<VoiceImportDecision>, u32)>,
}
struct TaskSlot {
    snapshot: VoiceTaskSnapshot,
    control: Option<TransferControl>,
}
impl Transfers {
    fn id(&mut self) -> Result<u32, VoiceError> {
        self.next = self
            .next
            .checked_add(1)
            .ok_or_else(|| VoiceError::new(VoiceFailure::LimitExceeded))?;
        Ok(self.next)
    }
    fn ensure_available(&self) -> Result<(), VoiceError> {
        if self.tasks.values().any(|t| t.control.is_some()) {
            return Err(VoiceError::new(VoiceFailure::Busy));
        }
        if self.tasks.len() >= 32 {
            return Err(VoiceError::new(VoiceFailure::LimitExceeded));
        }
        Ok(())
    }
    pub(super) fn select(&mut self, paths: Vec<PathBuf>) -> Result<VoiceFileSelection, VoiceError> {
        if paths.is_empty() || paths.len() > 32 || self.selections.len() >= 4 {
            return Err(VoiceError::new(VoiceFailure::LimitExceeded));
        }
        let id = self.id()?;
        let files = paths
            .iter()
            .enumerate()
            .map(|(index, p)| SelectedVoiceFile {
                index: index as u32,
                name: p
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
            })
            .collect();
        self.selections.insert(id, paths);
        Ok(VoiceFileSelection { id, files })
    }
    fn selected_paths(
        &self,
        selection: u32,
        indices: Vec<u32>,
    ) -> Result<Vec<PathBuf>, VoiceError> {
        let files = self
            .selections
            .get(&selection)
            .ok_or_else(|| VoiceError::new(VoiceFailure::StalePreview))?;
        let mut seen = std::collections::HashSet::new();
        let mut paths = Vec::new();
        for index in indices {
            if !seen.insert(index) {
                return Err(VoiceError::new(VoiceFailure::InvalidPackage));
            }
            paths.push(
                files
                    .get(index as usize)
                    .ok_or_else(|| VoiceError::new(VoiceFailure::InvalidPackage))?
                    .clone(),
            );
        }
        if paths.is_empty() {
            return Err(VoiceError::new(VoiceFailure::InvalidPackage));
        }
        Ok(paths)
    }
    fn submitted(
        &self,
        preview_id: u32,
        decisions: &[VoiceImportDecision],
    ) -> Result<Option<u32>, VoiceError> {
        let slot = self
            .previews
            .get(&preview_id)
            .ok_or_else(|| VoiceError::new(VoiceFailure::StalePreview))?;
        if let Some((original, id)) = &slot.submitted {
            return if original == decisions {
                Ok(Some(*id))
            } else {
                Err(VoiceError::new(VoiceFailure::Conflict))
            };
        }
        Ok(None)
    }
    fn begin(
        &mut self,
        kind: VoiceTaskKind,
        total: u32,
        app: &tauri::AppHandle,
    ) -> Result<(u32, TransferControl), VoiceError> {
        self.ensure_available()?;
        let id = self.id()?;
        let handle = app.clone();
        let control = TransferControl::with_progress(move |p| {
            let state = handle.state::<VoiceState>();
            if let Ok(mut registry) = state.transfers.lock()
                && let Some(task) = registry.tasks.get_mut(&id)
            {
                task.snapshot.sequence = task.snapshot.sequence.saturating_add(1);
                task.snapshot.stage = match p.stage {
                    talechime::TransferStage::Checking => VoiceTaskStage::Checking,
                    talechime::TransferStage::Planning => VoiceTaskStage::Planning,
                    talechime::TransferStage::Writing => VoiceTaskStage::Writing,
                    talechime::TransferStage::Committing => VoiceTaskStage::Committing,
                    talechime::TransferStage::Completed => VoiceTaskStage::Completed,
                };
                task.snapshot.completed = p.completed as u32;
                task.snapshot.total = p.total as u32;
                task.snapshot.bytes = p.bytes as f64;
                let snapshot = task.snapshot.clone();
                drop(registry);
                VoiceTransferEvent::publish(snapshot, &handle);
            }
        });
        self.tasks.insert(
            id,
            TaskSlot {
                snapshot: VoiceTaskSnapshot {
                    id,
                    sequence: 0,
                    kind,
                    state: VoiceTaskState::Running,
                    stage: VoiceTaskStage::Checking,
                    completed: 0,
                    total,
                    bytes: 0.0,
                    preview: None,
                    items: Vec::new(),
                    error: None,
                    filename: None,
                },
                control: Some(control.clone()),
            },
        );
        Ok((id, control))
    }
    pub(super) fn occupied(&self) -> bool {
        !self.previews.is_empty()
            || self.tasks.values().any(|t| {
                matches!(
                    t.snapshot.state,
                    VoiceTaskState::Running | VoiceTaskState::Cancelling
                )
            })
    }
    pub(super) fn snapshots(&self) -> Vec<VoiceTaskSnapshot> {
        let mut snapshots: Vec<_> = self.tasks.values().map(|t| t.snapshot.clone()).collect();
        snapshots.sort_by_key(|t| t.id);
        snapshots
    }
    pub(super) fn cancel(&mut self, id: u32) -> Result<VoiceTaskSnapshot, VoiceError> {
        let task = self
            .tasks
            .get_mut(&id)
            .ok_or_else(|| VoiceError::new(VoiceFailure::StalePreview))?;
        if let Some(control) = &task.control {
            control.cancel();
            task.snapshot.state = VoiceTaskState::Cancelling;
            task.snapshot.sequence = task.snapshot.sequence.saturating_add(1);
        }
        Ok(task.snapshot.clone())
    }
    pub(super) fn dismiss(&mut self, id: u32) -> Result<(), VoiceError> {
        if self.tasks.get(&id).is_some_and(|t| t.control.is_some()) {
            return Err(VoiceError::new(VoiceFailure::Busy));
        }
        self.tasks.remove(&id);
        self.previews.remove(&id);
        Ok(())
    }
    pub(super) fn release_selection(&mut self, id: u32) {
        self.selections.remove(&id);
    }
}
fn unavailable() -> VoiceError {
    VoiceError::new(VoiceFailure::Unavailable)
}
impl VoiceState {
    pub(super) fn select_files(
        &self,
        paths: Vec<PathBuf>,
    ) -> Result<VoiceFileSelection, VoiceError> {
        self.transfers
            .lock()
            .map_err(|_| unavailable())?
            .select(paths)
    }
    pub(super) fn start_inspect(
        &self,
        app: tauri::AppHandle,
        selection: u32,
        indices: Vec<u32>,
    ) -> Result<u32, VoiceError> {
        let mut registry = self.transfers.lock().map_err(|_| unavailable())?;
        if registry.previews.values().any(|p| p.ready.is_some()) {
            return Err(VoiceError::new(VoiceFailure::Busy));
        }
        let paths = registry.selected_paths(selection, indices)?;
        let (id, control) = registry.begin(VoiceTaskKind::Inspect, paths.len() as u32, &app)?;
        drop(registry);
        let library = self.library.clone();
        run(app, id, move || {
            library
                .inspect_import(&paths, TransferLimits::default(), &control)
                .map(JobResult::Preview)
                .map_err(VoiceError::from)
        });
        Ok(id)
    }
    pub(super) fn start_import(
        &self,
        app: tauri::AppHandle,
        preview_id: u32,
        decisions: Vec<VoiceImportDecision>,
    ) -> Result<u32, VoiceError> {
        let mut registry = self.transfers.lock().map_err(|_| unavailable())?;
        if let Some(id) = registry.submitted(preview_id, &decisions)? {
            return Ok(id);
        }
        registry.ensure_available()?;
        let preview = registry
            .previews
            .get_mut(&preview_id)
            .and_then(|p| p.ready.take())
            .ok_or_else(|| VoiceError::new(VoiceFailure::StalePreview))?;
        let (id, control) = registry.begin(VoiceTaskKind::Import, decisions.len() as u32, &app)?;
        if let Some(slot) = registry.previews.get_mut(&preview_id) {
            slot.submitted = Some((decisions.clone(), id));
        }
        let inspect_snapshot = registry.tasks.get_mut(&preview_id).map(|task| {
            task.snapshot.preview = None;
            task.snapshot.sequence = task.snapshot.sequence.saturating_add(1);
            task.snapshot.clone()
        });
        drop(registry);
        if let Some(snapshot) = inspect_snapshot {
            VoiceTransferEvent::publish(snapshot, &app);
        }
        let library = self.library.clone();
        run(app, id, move || {
            let decisions = decisions
                .into_iter()
                .map(|d| talechime::ImportDecision {
                    entry: d.entry as usize,
                    action: match d.action {
                        VoiceImportAction::Import => talechime::ImportAction::Import,
                        VoiceImportAction::ImportAsNew => talechime::ImportAction::ImportAsNew,
                        VoiceImportAction::Skip => talechime::ImportAction::Skip,
                    },
                })
                .collect();
            let plan = library
                .plan_import(preview, decisions)
                .map_err(VoiceError::from)?;
            Ok(JobResult::Import(library.import_selected(plan, &control)))
        });
        Ok(id)
    }
    pub(super) fn start_export(
        &self,
        app: tauri::AppHandle,
        ids: Vec<String>,
        path: PathBuf,
        replace: bool,
    ) -> Result<u32, VoiceError> {
        let ids = ids
            .into_iter()
            .map(|id| id.parse())
            .collect::<Result<Vec<talechime::VoiceId>, _>>()
            .map_err(VoiceError::from)?;
        let filename = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let (id, control) = self.transfers.lock().map_err(|_| unavailable())?.begin(
            VoiceTaskKind::Export,
            ids.len() as u32,
            &app,
        )?;
        let library = self.library.clone();
        run(app, id, move || {
            let report = library
                .export_bundle(
                    &ids,
                    &path,
                    if replace {
                        talechime::ExportTarget::ReplaceConfirmed
                    } else {
                        talechime::ExportTarget::CreateNew
                    },
                    TransferLimits::default(),
                    &control,
                )
                .map_err(VoiceError::from)?;
            Ok(JobResult::Export {
                voices: report.voices as u32,
                bytes: report.bytes as f64,
                filename,
            })
        });
        Ok(id)
    }
}
enum JobResult {
    Preview(ImportPreview),
    Import(talechime::ImportReport),
    Export {
        voices: u32,
        bytes: f64,
        filename: String,
    },
}
fn run(
    app: tauri::AppHandle,
    id: u32,
    job: impl FnOnce() -> Result<JobResult, VoiceError> + Send + 'static,
) {
    tauri::async_runtime::spawn_blocking(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job))
            .unwrap_or_else(|_| Err(unavailable()));
        let state = app.state::<VoiceState>();
        let Ok(mut registry) = state.transfers.lock() else {
            return;
        };
        let snapshot = registry.finish(id, result);
        drop(registry);
        if let Some(snapshot) = snapshot {
            VoiceTransferEvent::publish(snapshot, &app);
        }
    });
}
impl Transfers {
    fn finish(
        &mut self,
        id: u32,
        result: Result<JobResult, VoiceError>,
    ) -> Option<VoiceTaskSnapshot> {
        let result = match result {
            Ok(JobResult::Preview(_))
                if self
                    .tasks
                    .get(&id)
                    .and_then(|t| t.control.as_ref())
                    .is_some_and(TransferControl::is_cancelled) =>
            {
                Err(VoiceError::new(VoiceFailure::Cancelled))
            }
            other => other,
        };
        if let Ok(JobResult::Preview(p)) = result {
            let preview = Some(super::library::preview(id, &p));
            self.previews.insert(
                id,
                PreviewSlot {
                    ready: Some(p),
                    submitted: None,
                },
            );
            if let Some(task) = self.tasks.get_mut(&id) {
                task.snapshot.preview = preview;
                task.snapshot.state = VoiceTaskState::Completed;
            }
        } else if let Some(task) = self.tasks.get_mut(&id) {
            match result {
                Ok(JobResult::Import(report)) => {
                    task.snapshot.items = report
                        .items
                        .into_iter()
                        .map(|item| VoiceItemResult {
                            name: item.name,
                            entry: item.entry as u32,
                            local_id: item.local_id,
                            status: match item.status {
                                talechime::ImportStatus::Imported => VoiceItemStatus::Imported,
                                talechime::ImportStatus::AlreadyPresent => {
                                    VoiceItemStatus::AlreadyPresent
                                }
                                talechime::ImportStatus::Skipped => VoiceItemStatus::Skipped,
                                talechime::ImportStatus::Failed => VoiceItemStatus::Failed,
                                talechime::ImportStatus::Cancelled => VoiceItemStatus::Cancelled,
                                talechime::ImportStatus::NotAttempted => {
                                    VoiceItemStatus::NotAttempted
                                }
                            },
                            error: item.error.map(VoiceError::from),
                        })
                        .collect();
                    task.snapshot.state = if task
                        .snapshot
                        .items
                        .iter()
                        .any(|i| matches!(i.status, VoiceItemStatus::Failed))
                    {
                        VoiceTaskState::Failed
                    } else if task
                        .snapshot
                        .items
                        .iter()
                        .any(|i| matches!(i.status, VoiceItemStatus::Cancelled))
                    {
                        VoiceTaskState::Cancelled
                    } else {
                        VoiceTaskState::Completed
                    };
                }
                Ok(JobResult::Export {
                    voices,
                    bytes,
                    filename,
                }) => {
                    task.snapshot.completed = voices;
                    task.snapshot.bytes = bytes;
                    task.snapshot.filename = Some(filename);
                    task.snapshot.state = VoiceTaskState::Completed;
                }
                Err(error) => {
                    task.snapshot.state = if error.code == VoiceFailure::Cancelled {
                        VoiceTaskState::Cancelled
                    } else {
                        VoiceTaskState::Failed
                    };
                    task.snapshot.error = Some(error);
                }
                Ok(JobResult::Preview(_)) => {}
            }
        }
        let task = self.tasks.get_mut(&id)?;
        task.control = None;
        task.snapshot.sequence = task.snapshot.sequence.saturating_add(1);
        task.snapshot.stage = VoiceTaskStage::Completed;
        Some(task.snapshot.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn slot(id: u32) -> TaskSlot {
        TaskSlot {
            snapshot: VoiceTaskSnapshot {
                id,
                sequence: 0,
                kind: VoiceTaskKind::Import,
                state: VoiceTaskState::Running,
                stage: VoiceTaskStage::Committing,
                completed: 0,
                total: 2,
                bytes: 0.0,
                preview: None,
                items: Vec::new(),
                error: None,
                filename: None,
            },
            control: Some(TransferControl::default()),
        }
    }
    #[test]
    fn file_selection_resolves_only_chosen_session_indices() {
        let mut registry = Transfers::default();
        let selection = registry
            .select(vec![
                PathBuf::from("/private/a.voice"),
                PathBuf::from("/private/b.voice"),
            ])
            .unwrap();
        assert_eq!(selection.files[0].name, "a.voice");
        assert_eq!(
            registry.selected_paths(selection.id, vec![1]).unwrap(),
            vec![PathBuf::from("/private/b.voice")]
        );
        for indices in [vec![], vec![2], vec![0, 0]] {
            assert_eq!(
                registry
                    .selected_paths(selection.id, indices)
                    .unwrap_err()
                    .code,
                VoiceFailure::InvalidPackage
            );
        }
        registry.release_selection(selection.id);
        assert_eq!(
            registry
                .selected_paths(selection.id, vec![0])
                .unwrap_err()
                .code,
            VoiceFailure::StalePreview
        );
    }
    #[test]
    fn duplicate_submission_returns_original_task_and_rejects_changed_decisions() {
        let mut registry = Transfers::default();
        let decisions = vec![VoiceImportDecision {
            entry: 0,
            action: VoiceImportAction::ImportAsNew,
        }];
        registry.previews.insert(
            1,
            PreviewSlot {
                ready: None,
                submitted: Some((decisions.clone(), 2)),
            },
        );
        assert_eq!(registry.submitted(1, &decisions).unwrap(), Some(2));
        assert_eq!(
            registry.submitted(1, &[]).unwrap_err().code,
            VoiceFailure::Conflict
        );
    }
    #[test]
    fn cancellation_is_cooperative_and_does_not_release_running_job() {
        let mut registry = Transfers::default();
        registry.tasks.insert(1, slot(1));
        let control = registry.tasks[&1].control.clone().unwrap();
        assert_eq!(
            registry.cancel(1).unwrap().state,
            VoiceTaskState::Cancelling
        );
        assert!(control.is_cancelled());
        assert_eq!(registry.dismiss(1).unwrap_err().code, VoiceFailure::Busy);
        assert_eq!(
            registry.ensure_available().unwrap_err().code,
            VoiceFailure::Busy
        );
        let snapshot = registry
            .finish(1, Err(VoiceError::new(VoiceFailure::Cancelled)))
            .unwrap();
        assert_eq!(snapshot.state, VoiceTaskState::Cancelled);
        assert_eq!(snapshot.sequence, 2);
        assert!(registry.ensure_available().is_ok());
        registry.dismiss(1).unwrap();
        assert!(registry.snapshots().is_empty());
    }
    #[test]
    fn partial_report_survives_cancellation_and_page_snapshot_queries() {
        let mut registry = Transfers::default();
        registry.tasks.insert(1, slot(1));
        let report = talechime::ImportReport {
            items: vec![
                talechime::ImportItemResult {
                    name: "声音".into(),
                    entry: 0,
                    sources: vec![],
                    local_id: Some("hero".into()),
                    status: talechime::ImportStatus::Imported,
                    error: None,
                },
                talechime::ImportItemResult {
                    name: "声音".into(),
                    entry: 1,
                    sources: vec![],
                    local_id: None,
                    status: talechime::ImportStatus::Cancelled,
                    error: None,
                },
            ],
        };
        registry.finish(1, Ok(JobResult::Import(report))).unwrap();
        let snapshots = registry.snapshots();
        assert_eq!(snapshots[0].state, VoiceTaskState::Cancelled);
        assert_eq!(snapshots[0].items[0].local_id.as_deref(), Some("hero"));
        assert_eq!(snapshots[0].items.len(), 2);
        assert!(registry.ensure_available().is_ok());
    }
    #[test]
    fn a_late_cancel_request_does_not_reverse_published_export() {
        let mut registry = Transfers::default();
        registry.tasks.insert(1, slot(1));
        registry.cancel(1).unwrap();
        registry
            .finish(
                1,
                Ok(JobResult::Export {
                    voices: 2,
                    bytes: 300.0,
                    filename: "voices.voice".into(),
                }),
            )
            .unwrap();
        assert_eq!(registry.cancel(1).unwrap().state, VoiceTaskState::Completed);
        assert_eq!(
            registry.snapshots()[0].filename.as_deref(),
            Some("voices.voice")
        );
    }
    #[test]
    fn nested_package_errors_preserve_kind_and_index_without_private_path() {
        let error = VoiceError::from(talechime::VoiceLibraryError::Input {
            index: 2,
            error: Box::new(talechime::VoiceLibraryError::InvalidPackage(
                "private diagnostic".into(),
            )),
        });
        assert_eq!(error.code, VoiceFailure::InvalidPackage);
        assert_eq!(error.input_index, Some(2));
        assert!(
            !serde_json::to_string(&error)
                .unwrap()
                .contains("private diagnostic")
        );
    }
    #[test]
    fn late_inspection_cancel_releases_preview_instead_of_publishing_it() {
        let root = tempfile::tempdir().unwrap();
        let library = talechime::VoiceLibrary::open(root.path().join("source")).unwrap();
        let mut data = std::io::Cursor::new(Vec::new());
        // Use a tiny prevalidated WAV fixture without adding an audio crate to the host.
        std::io::Write::write_all(
            &mut data,
            &[
                82, 73, 70, 70, 44, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0,
                1, 0, 192, 93, 0, 0, 128, 187, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 8, 0, 0, 0,
                100, 0, 156, 255, 100, 0, 156, 255,
            ],
        )
        .unwrap();
        library
            .create(
                "voice",
                "声音",
                data.get_ref(),
                "你好",
                None,
                talechime::VoiceSource::Imported,
            )
            .unwrap();
        let package = root.path().join("one.voice");
        library
            .export_bundle(
                &["voice".parse().unwrap()],
                &package,
                talechime::ExportTarget::CreateNew,
                TransferLimits::default(),
                &TransferControl::default(),
            )
            .unwrap();
        let target = talechime::VoiceLibrary::open(root.path().join("dest")).unwrap();
        let preview = target
            .inspect_import(
                &[package],
                TransferLimits::default(),
                &TransferControl::default(),
            )
            .unwrap();
        let mut registry = Transfers::default();
        registry.tasks.insert(1, slot(1));
        registry.cancel(1).unwrap();
        let snapshot = registry.finish(1, Ok(JobResult::Preview(preview))).unwrap();
        assert_eq!(snapshot.state, VoiceTaskState::Cancelled);
        assert!(snapshot.preview.is_none());
        assert!(registry.previews.is_empty());
        assert!(!target.root().exists());
    }
}
