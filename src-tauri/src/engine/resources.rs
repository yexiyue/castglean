//! 资源准备任务：引擎线程上的状态机、磁盘预检、取消与事件。
//!
//! 引擎对象（`Rc`）全部生活在专用线程的 LocalSet 上，复用 Tauri
//! 运行时，符合 talechime「对象留在其 owner 线程」的约定。IPC 命令
//! 经 channel 与引擎线程通信；准备任务用 `spawn_local` 驱动，其
//! 下载使用 drop-future 取消，并等待任务退出。
//! 权威状态仍是离线盘点，任务阶段与失败是叠加视图；前端通过有序 Channel
//! 和重连快照消费，不拥有任务生命周期。
use std::{cell::RefCell, collections::HashMap, rc::Rc};

use talechime::Event;
use tauri::Manager;
use tokio::sync::{mpsc, oneshot};

use super::{EngineState, PrepareOutcome, ResourceState, events::ModelResourceUpdate, inventory};

/// IPC → 引擎线程的请求。
enum EngineRequest {
    Studio(Box<crate::voices::studio::StudioJob>),
    /// 章节顺序合成；与试听共用推理闸门。
    ChapterAudio {
        run_id: String,
    },
    Plan {
        backend: String,
        model: Option<String>,
        reply: oneshot::Sender<Result<super::preparation::ModelPreparationPlan, String>>,
    },
    Prepare {
        backend: String,
        model: Option<String>,
        fingerprint: String,
        reply: oneshot::Sender<Result<PrepareOutcome, String>>,
    },
    UpdateSettings {
        settings: super::config::EngineSettingsChange,
        operation_id: String,
        reply: oneshot::Sender<Result<super::config::EngineSettingsView, String>>,
    },
    GetSettings {
        reply: oneshot::Sender<super::config::EngineSettingsView>,
    },
    ClearApplicationCache {
        reply: oneshot::Sender<Result<u32, String>>,
    },
    Verify {
        backend: String,
        model: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Pause {
        backend: String,
        model: String,
        reply: oneshot::Sender<Result<bool, String>>,
    },
    Cancel {
        backend: String,
        model: String,
        reply: oneshot::Sender<Result<bool, String>>,
    },
}

#[derive(Clone)]
pub(crate) struct EngineThread {
    tx: mpsc::Sender<EngineRequest>,
}

impl EngineThread {
    /// 启动引擎线程，以宿主运行时驱动本线程的 LocalSet。
    /// 所有 `Rc` 引擎对象只在该线程内存在。
    pub(crate) fn start(app: tauri::AppHandle) -> std::io::Result<Self> {
        let (tx, rx) = mpsc::channel(16);
        std::thread::Builder::new()
            .name("castglean-engine".into())
            .spawn(move || engine_loop(app, rx))?;
        Ok(Self { tx })
    }

    async fn request<T>(
        &self,
        build: impl FnOnce(oneshot::Sender<T>) -> EngineRequest,
    ) -> Result<T, String> {
        let (reply, done) = oneshot::channel();
        self.tx
            .send(build(reply))
            .await
            .map_err(|_| "engine thread unavailable".to_string())?;
        done.await
            .map_err(|_| "engine thread dropped request".to_string())
    }

    pub(crate) async fn studio(&self, job: crate::voices::studio::StudioJob) -> Result<(), String> {
        self.tx
            .send(EngineRequest::Studio(Box::new(job)))
            .await
            .map_err(|_| "engine thread unavailable".into())
    }
    pub(crate) async fn chapter_audio(&self, run_id: String) -> Result<(), String> {
        self.tx
            .send(EngineRequest::ChapterAudio { run_id })
            .await
            .map_err(|_| "engine thread unavailable".into())
    }
    pub(crate) async fn prepare(
        &self,
        backend: String,
        model: Option<String>,
        fingerprint: String,
    ) -> Result<PrepareOutcome, String> {
        self.request(|reply| EngineRequest::Prepare {
            backend,
            model,
            fingerprint,
            reply,
        })
        .await?
    }

    pub(crate) async fn plan(
        &self,
        backend: String,
        model: Option<String>,
    ) -> Result<super::preparation::ModelPreparationPlan, String> {
        self.request(|reply| EngineRequest::Plan {
            backend,
            model,
            reply,
        })
        .await?
    }

    pub(crate) async fn update_settings(
        &self,
        settings: super::config::EngineSettingsChange,
        operation_id: String,
    ) -> Result<super::config::EngineSettingsView, String> {
        self.request(|reply| EngineRequest::UpdateSettings {
            settings,
            operation_id,
            reply,
        })
        .await?
    }

    pub(crate) async fn get_settings(&self) -> Result<super::config::EngineSettingsView, String> {
        self.request(|reply| EngineRequest::GetSettings { reply })
            .await
    }

    pub(crate) async fn clear_application_cache(&self) -> Result<u32, String> {
        self.request(|reply| EngineRequest::ClearApplicationCache { reply })
            .await?
    }

    pub(crate) async fn verify(
        &self,
        backend: String,
        model: Option<String>,
    ) -> Result<(), String> {
        self.request(|reply| EngineRequest::Verify {
            backend,
            model,
            reply,
        })
        .await?
    }

    pub(crate) async fn pause(&self, backend: String, model: String) -> Result<bool, String> {
        self.request(|reply| EngineRequest::Pause {
            backend,
            model,
            reply,
        })
        .await?
    }
    pub(crate) async fn cancel(&self, backend: String, model: String) -> Result<bool, String> {
        self.request(|reply| EngineRequest::Cancel {
            backend,
            model,
            reply,
        })
        .await?
    }
}

/// 引擎线程内进行中任务的登记表。
enum TaskKind {
    Verify,
    Download(talechime::Downloads),
}
struct LocalTask {
    handle: tokio::task::JoinHandle<()>,
    kind: TaskKind,
}
impl LocalTask {
    fn is_verifying(&self) -> bool {
        matches!(self.kind, TaskKind::Verify)
    }
    async fn stop(self) -> bool {
        let downloads = match self.kind {
            TaskKind::Download(downloads) => {
                self.handle.abort();
                Some(downloads)
            }
            TaskKind::Verify => {
                self.handle.abort();
                None
            }
        };
        let _ = self.handle.await;
        downloads.is_some_and(|client| client.checkpoint_failed())
    }
}
type LocalTasks = Rc<RefCell<HashMap<(String, String), LocalTask>>>;
type PendingStarts = Rc<RefCell<HashMap<(String, String), tokio::task::JoinHandle<()>>>>;

struct PendingStartGuard {
    pending: PendingStarts,
    key: (String, String),
}
impl Drop for PendingStartGuard {
    fn drop(&mut self) {
        self.pending.borrow_mut().remove(&self.key);
    }
}

async fn cancel_pending(pending: &PendingStarts, backend: &str, model: &str) -> bool {
    let handle = pending
        .borrow_mut()
        .remove(&(backend.to_owned(), model.to_owned()));
    if let Some(handle) = handle {
        handle.abort();
        let _ = handle.await;
        true
    } else {
        false
    }
}

fn engine_loop(app: tauri::AppHandle, mut rx: mpsc::Receiver<EngineRequest>) {
    let local = tokio::task::LocalSet::new();
    tauri::async_runtime::block_on(local.run_until(async move {
        let tasks: LocalTasks = Rc::new(RefCell::new(HashMap::new()));
        let mut settings_receipts = super::config::SettingsReceipts::default();
        let mut settings_revision = super::config::SettingsRevision::default();
        let pending: PendingStarts = Default::default();
        let studio_gate = Rc::new(tokio::sync::Semaphore::new(1));
        while let Some(request) = rx.recv().await {
            match request {
                EngineRequest::Plan {
                    backend,
                    model,
                    reply,
                } => {
                    let app = app.clone();
                    tokio::task::spawn_local(async move {
                        let state = app.state::<EngineState>();
                        let result = super::preparation::plan(&state, &backend, model.as_deref())
                            .await
                            .map_err(|_| "无法计算资源准备计划".to_string());
                        let _ = reply.send(result);
                    });
                }
                EngineRequest::Studio(job) => {
                    tokio::task::spawn_local(crate::voices::studio::execution::run(
                        app.clone(),
                        *job,
                        studio_gate.clone(),
                    ));
                }
                EngineRequest::ChapterAudio { run_id } => {
                    tokio::task::spawn_local(crate::chapter_audio::run(
                        app.clone(),
                        run_id,
                        studio_gate.clone(),
                    ));
                }
                EngineRequest::Prepare {
                    backend,
                    model,
                    fingerprint,
                    reply,
                } => {
                    // reply 失败说明前端已离开；Started 的任务照常跑完并
                    // 发送 Channel 更新（幂等，重进页面即见权威状态）。
                    let key = match super::catalog::registry(&app.state::<EngineState>())
                        .and_then(|registry| registry.resolve(&backend, model.as_deref()))
                    {
                        Ok(resolved) => (
                            backend.clone(),
                            resolved.capabilities().model.clone().unwrap_or_default(),
                        ),
                        Err(error) => {
                            let _ = reply.send(Err(format!("unknown model: {error}")));
                            continue;
                        }
                    };
                    if pending.borrow().contains_key(&key) {
                        let _ = reply.send(Ok(PrepareOutcome::AlreadyPreparing));
                        continue;
                    }
                    let app = app.clone();
                    let tasks = tasks.clone();
                    let pending_tasks = pending.clone();
                    let pending_key = key.clone();
                    let handle = tokio::task::spawn_local(async move {
                        let _pending_guard = PendingStartGuard {
                            pending: pending_tasks,
                            key: pending_key,
                        };
                        let outcome =
                            begin_prepare(&app, &tasks, backend, model, fingerprint).await;
                        let _ = reply.send(outcome);
                    });
                    pending.borrow_mut().insert(key, handle);
                }
                EngineRequest::UpdateSettings {
                    settings,
                    operation_id,
                    reply,
                } => {
                    // 与任务启动同步串行处理，目录检查和任务登记之间不能切换配置。
                    let state = app.state::<EngineState>();
                    let result = settings_receipts
                        .execute(&operation_id, &settings, || {
                            if !settings_revision.matches(&settings.expected_revision) {
                                Err("settings_conflict".into())
                            } else if app.state::<crate::voices::studio::StudioState>().active()
                                || app
                                    .state::<crate::chapter_audio::ChapterAudioState>()
                                    .active()
                                || !tasks.borrow().is_empty()
                                || !pending.borrow().is_empty()
                            {
                                Err("音色任务正在运行，请稍后更改设置".into())
                            } else {
                                // An error can follow a disk commit. Invalidate older snapshots
                                // even when the write does not return success.
                                settings_revision.advance();
                                settings
                                    .clone()
                                    .resolve(&state.settings())
                                    .and_then(|settings| {
                                        state
                                            .set_settings(settings)
                                            .map_err(|error| error.to_string())
                                    })
                            }
                        })
                        .map(|()| {
                            super::config::EngineSettingsView::new(
                                &state.settings(),
                                settings_revision.current(),
                            )
                        });
                    let _ = reply.send(result);
                }
                EngineRequest::GetSettings { reply } => {
                    let state = app.state::<EngineState>();
                    let _ = reply.send(super::config::EngineSettingsView::new(
                        &state.settings(),
                        settings_revision.current(),
                    ));
                }
                EngineRequest::ClearApplicationCache { reply } => {
                    let state = app.state::<EngineState>();
                    let result =
                        if app.state::<crate::voices::studio::StudioState>().active()
                            || app
                                .state::<crate::chapter_audio::ChapterAudioState>()
                                .active()
                            || state.active_preparations().unwrap_or(1) > 0
                            || !tasks.borrow().is_empty()
                            || !pending.borrow().is_empty()
                        {
                            Err("模型任务正在运行，请稍后清理".to_string())
                        } else {
                            (|| -> anyhow::Result<u32> {
                                let data = crate::storage::data(&app);
                                let cache = crate::storage::cache(&app);
                                talechime::Registry::with_storage_paths(
                                    data,
                                    cache.clone(),
                                    &state.download_config()?,
                                    Default::default(),
                                )?;
                                let stale = crate::voices::studio::clear_stale_cache(&cache)?;
                                let calibration = state.registry()?.clear_calibration_cache()?;
                                Ok(u32::try_from(stale.saturating_add(calibration))
                                    .unwrap_or(u32::MAX))
                            })()
                            .map_err(|_| "无法清理应用缓存".to_string())
                        };
                    let _ = reply.send(result);
                }
                EngineRequest::Verify {
                    backend,
                    model,
                    reply,
                } => {
                    if app.state::<crate::voices::studio::StudioState>().active() {
                        let _ = reply.send(Err("音色任务正在运行".into()));
                        continue;
                    }
                    if app
                        .state::<crate::chapter_audio::ChapterAudioState>()
                        .active()
                    {
                        let _ = reply.send(Err("章节音频正在生成".into()));
                        continue;
                    }
                    let state = app.state::<EngineState>();
                    if state.active_preparations().unwrap_or(1) > 0 || !pending.borrow().is_empty()
                    {
                        let _ = reply.send(Err("请先完成或取消资源准备，再验证模型".into()));
                        continue;
                    }
                    let resolved = super::catalog::registry(&state)
                        .and_then(|registry| registry.resolve(&backend, model.as_deref()));
                    match resolved {
                        Err(error) => {
                            let _ = reply.send(Err(error.to_string()));
                        }
                        Ok(resolved) => {
                            let key = (
                                backend,
                                resolved.capabilities().model.clone().unwrap_or_default(),
                            );
                            if tasks.borrow().contains_key(&key) {
                                let _ = reply.send(Err("模型任务正在运行".into()));
                                continue;
                            }
                            let active_tasks = tasks.clone();
                            let task_key = key.clone();
                            let verify_gate = studio_gate.clone();
                            let handle = tokio::task::spawn_local(async move {
                                let _permit = verify_gate.acquire().await.unwrap();
                                let (tx, mut rx) = mpsc::channel(16);
                                let drain = async { while rx.recv().await.is_some() {} };
                                let options = talechime::PrepareOptions {
                                    device: resolved
                                        .available_devices()
                                        .into_iter()
                                        .next()
                                        .unwrap_or(talechime::Device::Cpu),
                                    calibrate: false,
                                    recovery: false,
                                    voice: None,
                                };
                                let (result, ()) =
                                    tokio::join!(resolved.load_existing(options, tx), drain);
                                active_tasks.borrow_mut().remove(&task_key);
                                let _ = reply
                                    .send(result.map(|_| ()).map_err(|error| error.to_string()));
                            });
                            tasks.borrow_mut().insert(
                                key,
                                LocalTask {
                                    handle,
                                    kind: TaskKind::Verify,
                                },
                            );
                        }
                    }
                }
                EngineRequest::Pause {
                    backend,
                    model,
                    reply,
                } => {
                    if cancel_pending(&pending, &backend, &model).await {
                        let _ = reply.send(Ok(true));
                        continue;
                    }
                    let _ = reply.send(pause_task(&app, &tasks, &backend, &model).await);
                }
                EngineRequest::Cancel {
                    backend,
                    model,
                    reply,
                } => {
                    if cancel_pending(&pending, &backend, &model).await {
                        let _ = reply.send(Ok(true));
                        continue;
                    }
                    let _ = reply.send(cancel_task(&app, &tasks, &backend, &model).await);
                }
            }
        }
    }));
}

async fn begin_prepare(
    app: &tauri::AppHandle,
    tasks: &LocalTasks,
    backend: String,
    model: Option<String>,
    fingerprint: String,
) -> Result<PrepareOutcome, String> {
    if app.state::<crate::voices::studio::StudioState>().active() {
        return Err("音色任务正在使用模型资源，请稍后准备".into());
    }
    if app
        .state::<crate::chapter_audio::ChapterAudioState>()
        .active()
    {
        return Err("章节音频正在使用模型资源，请稍后准备".into());
    }
    if tasks.borrow().values().any(LocalTask::is_verifying) {
        return Err("模型正在加载验证，请稍后准备资源".into());
    }
    let state = app.state::<EngineState>();
    let registry =
        super::catalog::registry(&state).map_err(|error| format!("engine registry: {error}"))?;
    let resolved = registry
        .resolve(&backend, model.as_deref())
        .map_err(|error| format!("unknown model: {error}"))?;
    let model_id = resolved.capabilities().model.clone().unwrap_or_default();

    if tasks
        .borrow()
        .contains_key(&(backend.clone(), model_id.clone()))
    {
        return Ok(PrepareOutcome::AlreadyPreparing);
    }

    let inventory = registry
        .resource_inventory(&backend, Some(&model_id))
        .await
        .map_err(|error| format!("inventory: {error}"))?;
    // Inventory yields while hashing; recheck all start guards before registration.
    if app.state::<crate::voices::studio::StudioState>().active()
        || app
            .state::<crate::chapter_audio::ChapterAudioState>()
            .active()
        || tasks.borrow().values().any(LocalTask::is_verifying)
    {
        return Err("模型资源正在使用，请稍后准备".into());
    }
    if tasks
        .borrow()
        .contains_key(&(backend.clone(), model_id.clone()))
    {
        return Ok(PrepareOutcome::AlreadyPreparing);
    }
    let config = state.download_config().map_err(|_| "无法读取资源设置")?;
    if fingerprint
        != super::preparation::download_fingerprint(
            &config,
            &backend,
            &model_id,
            inventory.missing_bytes,
            &inventory.fingerprint,
            registry.root(),
            registry.cache(),
        )
    {
        return Ok(PrepareOutcome::PlanChanged);
    }
    // 总量基线：本次准备还需下载的字节（就绪文件对进度分子分母都不贡献）。
    let missing_total = inventory.missing_bytes;
    let saved_state = state.task_state(&backend, &model_id);
    let prior_total = match saved_state {
        Some(ResourceState::Paused { total_bytes, .. }) => total_bytes as u64,
        _ => missing_total,
    };
    let progress_total = prior_total.max(missing_total);
    let ready_before = progress_total.saturating_sub(missing_total);
    if missing_total == 0 {
        return Ok(PrepareOutcome::AlreadyReady);
    }
    // Paused progress is historical, and its temporary files may have been
    // removed or invalidated. Only the current inventory is authoritative.
    if let Some(outcome) = space_check(&state, missing_total as f64) {
        return Ok(outcome);
    }

    let key = (backend.clone(), model_id.clone());
    let (tx, rx) = mpsc::channel::<Event>(64);
    let app = app.clone();
    let task_id = ModelResourceUpdate::state(
        &backend,
        &model_id,
        ResourceState::Downloading {
            downloaded_bytes: ready_before as f64,
            total_bytes: progress_total as f64,
            current_file: None,
            bytes_per_second: None,
            remaining_seconds: None,
            stalled: false,
        },
    )
    .publish(&app);
    if let Err(error) = state.persist_resource_tasks() {
        ModelResourceUpdate::state(
            &backend,
            &model_id,
            ResourceState::Failed {
                error: super::PrepareFailure::Disk,
                missing_bytes: missing_total as f64,
            },
        )
        .publish(&app);
        return Err(format!("无法保存下载任务：{error}"));
    }
    let task_backend = backend;
    let task_model = model_id;
    let active_tasks = tasks.clone();
    let downloads = registry.downloads().clone();
    let handle = tokio::task::spawn_local(async move {
        // Forwarding belongs to this task and drops with cancellation.
        let forward = super::progress::forward(rx, |resource, metrics| {
            ModelResourceUpdate::progress(
                &task_backend,
                &task_model,
                (ready_before + metrics.downloaded) as f64,
                progress_total.max(ready_before + metrics.downloaded) as f64,
                resource,
            )
            .with_metrics(metrics)
            .publish_for(&app, task_id);
        });
        let (result, ()) = tokio::join!(resolved.prepare_resources(tx), forward);

        let result = match result {
            Ok(()) => {
                registry
                    .resource_status(&task_backend, Some(&task_model))
                    .await
            }
            Err(error) => Err(error),
        };
        let next = match result {
            Ok(status) => inventory::from_engine(status),
            Err(error) => {
                let remaining = registry
                    .resource_status(&task_backend, Some(&task_model))
                    .await
                    .map(talechime::ResourceStatus::missing_bytes)
                    .unwrap_or(missing_total);
                ResourceState::Failed {
                    error: if registry.downloads().checkpoint_failed() {
                        super::PrepareFailure::Disk
                    } else {
                        inventory::classify_failure(&error)
                    },
                    missing_bytes: remaining as f64,
                }
            }
        };
        active_tasks
            .borrow_mut()
            .remove(&(task_backend.clone(), task_model.clone()));
        ModelResourceUpdate::state(&task_backend, &task_model, next).publish_for(&app, task_id);
    });
    tasks.borrow_mut().insert(
        key,
        LocalTask {
            handle,
            kind: TaskKind::Download(downloads),
        },
    );
    Ok(PrepareOutcome::Started)
}

fn space_check(
    state: &tauri::State<'_, EngineState>,
    missing_bytes: f64,
) -> Option<PrepareOutcome> {
    if missing_bytes == 0.0 {
        return None;
    }
    let config = state.download_config().ok()?;
    let available = inventory::available_for(&config.cache_dir).ok()?;
    (available < missing_bytes).then_some(PrepareOutcome::InsufficientSpace {
        available,
        required: missing_bytes,
    })
}

async fn cancel_task(
    app: &tauri::AppHandle,
    tasks: &LocalTasks,
    backend: &str,
    model: &str,
) -> Result<bool, String> {
    let handle = tasks
        .borrow_mut()
        .remove(&(backend.to_owned(), model.to_owned()));
    if let Some(task) = handle {
        if task.stop().await {
            return Err(checkpoint_failure(app, backend, model));
        }
    } else if !matches!(
        app.state::<EngineState>().task_state(backend, model),
        Some(ResourceState::Paused { .. } | ResourceState::Interrupted { .. })
    ) {
        return Ok(false);
    }
    // 已完成文件保留；状态立即回归盘点并广播。
    let state = app.state::<EngineState>();
    let next = match super::catalog::registry(&state) {
        Ok(registry) => registry
            .resource_status(backend, Some(model))
            .await
            .map(inventory::from_engine)
            .unwrap_or(ResourceState::Missing { missing_bytes: 0.0 }),
        Err(_) => ResourceState::Missing { missing_bytes: 0.0 },
    };
    ModelResourceUpdate::state(backend, model, next).publish(app);
    state
        .persist_resource_tasks()
        .map_err(|e| format!("下载已取消，但任务保存失败：{e}"))?;
    Ok(true)
}

async fn pause_task(
    app: &tauri::AppHandle,
    tasks: &LocalTasks,
    backend: &str,
    model: &str,
) -> Result<bool, String> {
    let state = app.state::<EngineState>();
    let Some(paused) = state
        .task_state(backend, model)
        .as_ref()
        .and_then(super::resource_tasks::paused)
    else {
        return Ok(false);
    };
    let handle = tasks
        .borrow_mut()
        .remove(&(backend.to_owned(), model.to_owned()));
    let next = pause_after_exit(handle, paused, || async {
        match super::catalog::registry(&state) {
            Ok(registry) => registry
                .resource_status(backend, Some(model))
                .await
                .is_ok_and(|status| status == talechime::ResourceStatus::Ready),
            Err(_) => false,
        }
    })
    .await
    .map_err(|()| checkpoint_failure(app, backend, model))?;
    ModelResourceUpdate::state(backend, model, next).publish(app);
    state
        .persist_resource_tasks()
        .map_err(|e| format!("下载已停止，但任务保存失败：{e}"))?;
    Ok(true)
}

/// Read publication readiness only after cancellation has joined all owned work.
async fn pause_after_exit<Fut: std::future::Future<Output = bool>>(
    task: Option<LocalTask>,
    paused: ResourceState,
    is_ready: impl FnOnce() -> Fut,
) -> Result<ResourceState, ()> {
    if let Some(task) = task
        && task.stop().await
    {
        return Err(());
    }
    Ok(if is_ready().await {
        ResourceState::Ready
    } else {
        paused
    })
}

fn checkpoint_failure(app: &tauri::AppHandle, backend: &str, model: &str) -> String {
    let state = app.state::<EngineState>();
    let missing_bytes = match state
        .task_state(backend, model)
        .as_ref()
        .and_then(super::resource_tasks::paused)
    {
        Some(ResourceState::Paused {
            total_bytes,
            downloaded_bytes,
            ..
        }) => (total_bytes - downloaded_bytes).max(0.0),
        _ => 0.0,
    };
    ModelResourceUpdate::state(
        backend,
        model,
        ResourceState::Failed {
            error: super::PrepareFailure::Disk,
            missing_bytes,
        },
    )
    .publish(app);
    "下载已停止，但断点保存失败，请检查缓存目录权限与空间".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancelling_pending_start_waits_for_inventory_to_stop() {
        tokio::task::LocalSet::new()
            .run_until(async {
                struct OnDrop(Rc<std::cell::Cell<bool>>);
                impl Drop for OnDrop {
                    fn drop(&mut self) {
                        self.0.set(true);
                    }
                }
                let pending: PendingStarts = Default::default();
                let stopped = Rc::new(std::cell::Cell::new(false));
                let marker = stopped.clone();
                let (started, started_rx) = oneshot::channel();
                let task = tokio::task::spawn_local(async move {
                    let _guard = OnDrop(marker);
                    let _ = started.send(());
                    std::future::pending::<()>().await;
                });
                pending
                    .borrow_mut()
                    .insert(("voxcpm".into(), "2b-q8_0".into()), task);
                started_rx.await.unwrap();
                assert!(cancel_pending(&pending, "voxcpm", "2b-q8_0").await);
                assert!(stopped.get());
                assert!(pending.borrow().is_empty());
                assert!(!cancel_pending(&pending, "voxcpm", "2b-q8_0").await);
            })
            .await;
    }
    #[tokio::test]
    async fn download_cancellation_waits_for_future_drop() {
        tokio::task::LocalSet::new()
            .run_until(async {
                struct OnDrop(Rc<std::cell::Cell<bool>>);
                impl Drop for OnDrop {
                    fn drop(&mut self) {
                        self.0.set(true);
                    }
                }
                let temp = tempfile::tempdir().unwrap();
                let downloads = talechime::Downloads::new(&talechime::DownloadConfig {
                    cache_dir: temp.path().join("hf"),
                    endpoint: None,
                    token: None,
                })
                .unwrap();
                let dropped = Rc::new(std::cell::Cell::new(false));
                let marker = dropped.clone();
                let (started, ready) = oneshot::channel();
                let handle = tokio::task::spawn_local(async move {
                    let _guard = OnDrop(marker);
                    let _ = started.send(());
                    std::future::pending::<()>().await;
                });
                ready.await.unwrap();
                assert!(
                    !LocalTask {
                        handle,
                        kind: TaskKind::Download(downloads)
                    }
                    .stop()
                    .await
                );
                assert!(dropped.get());
            })
            .await;
    }
}
