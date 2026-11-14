//! Frozen composition export, independent of synthesis and source files.
use super::{ChapterAudioError, ChapterAudioState, arrangement, playback, store};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterExportView {
    pub id: String,
    pub run_id: String,
    pub revision: u32,
    pub status: String,
    pub completed: u32,
    pub total: u32,
    pub duration_ms: Option<f64>,
    pub filename: String,
}
struct Job {
    view: ChapterExportView,
    cancel: Arc<AtomicBool>,
}
#[derive(Default)]
pub(crate) struct ExportState(Mutex<HashMap<String, Job>>);
impl ExportState {
    pub(crate) fn view(&self, id: &str) -> Result<ChapterExportView, ChapterAudioError> {
        self.0
            .lock()
            .map_err(|_| ChapterAudioError::ReadFailed)?
            .get(id)
            .map(|j| j.view.clone())
            .ok_or(ChapterAudioError::NotFound)
    }
    pub(crate) fn cancel(&self, id: &str) -> Result<(), ChapterAudioError> {
        let jobs = self.0.lock().map_err(|_| ChapterAudioError::ReadFailed)?;
        jobs.get(id)
            .ok_or(ChapterAudioError::NotFound)?
            .cancel
            .store(true, Ordering::Relaxed);
        Ok(())
    }
    fn update(&self, id: &str, update: impl FnOnce(&mut ChapterExportView)) {
        if let Ok(mut jobs) = self.0.lock()
            && let Some(job) = jobs.get_mut(id)
        {
            update(&mut job.view);
        }
    }
}

fn fingerprint(path: &Path) -> std::io::Result<Option<(u64, std::time::SystemTime)>> {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_file() && !m.file_type().is_symlink() => Ok(Some((m.len(), m.modified()?))),
        Ok(_) => Err(std::io::Error::other("target must be a regular file")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Streams and validates every PCM sample before atomic publication.
pub(super) fn write(
    inputs: &[PathBuf],
    target: &Path,
    expected: Option<(u64, std::time::SystemTime)>,
    cancel: &AtomicBool,
    progress: impl Fn(u32),
) -> Result<f64, ChapterAudioError> {
    let parent = target.parent().ok_or(ChapterAudioError::InvalidData)?;
    let temp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| ChapterAudioError::WriteFailed)?;
    let duration = compose(inputs, temp.as_file(), cancel, progress)?;
    temp.as_file()
        .sync_all()
        .map_err(|_| ChapterAudioError::WriteFailed)?;
    if cancel.load(Ordering::Relaxed) {
        return Err(ChapterAudioError::Busy);
    }
    if fingerprint(target).map_err(|_| ChapterAudioError::WriteFailed)? != expected {
        return Err(ChapterAudioError::Conflict);
    }
    if expected.is_some() {
        temp.persist(target)
            .map_err(|_| ChapterAudioError::WriteFailed)?;
    } else {
        temp.persist_noclobber(target)
            .map_err(|_| ChapterAudioError::WriteFailed)?;
    }
    Ok(duration)
}

fn compose<W: std::io::Write + std::io::Seek>(
    inputs: &[PathBuf],
    sink: W,
    cancel: &AtomicBool,
    progress: impl Fn(u32),
) -> Result<f64, ChapterAudioError> {
    let mut writer: Option<hound::WavWriter<W>> = None;
    let mut sink = Some(sink);
    let mut spec = None;
    let mut samples = 0u64;
    for (index, input) in inputs.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(ChapterAudioError::Busy);
        }
        let mut reader =
            hound::WavReader::open(input).map_err(|_| ChapterAudioError::ReadFailed)?;
        let current = reader.spec();
        if current.bits_per_sample != 16
            || current.sample_format != hound::SampleFormat::Int
            || current.channels == 0
            || current.sample_rate == 0
        {
            return Err(ChapterAudioError::InvalidData);
        }
        if spec.is_some_and(|s| s != current) {
            return Err(ChapterAudioError::InvalidData);
        }
        if writer.is_none() {
            writer = Some(
                hound::WavWriter::new(sink.take().ok_or(ChapterAudioError::InvalidData)?, current)
                    .map_err(|_| ChapterAudioError::WriteFailed)?,
            );
            spec = Some(current);
        }
        let declared = reader.len();
        let mut count = 0;
        for sample in reader.samples::<i16>() {
            if count % 8192 == 0 && cancel.load(Ordering::Relaxed) {
                return Err(ChapterAudioError::Busy);
            }
            writer
                .as_mut()
                .unwrap()
                .write_sample(sample.map_err(|_| ChapterAudioError::ReadFailed)?)
                .map_err(|_| ChapterAudioError::WriteFailed)?;
            count += 1;
            samples += 1;
        }
        if count != declared {
            return Err(ChapterAudioError::InvalidData);
        }
        progress(index as u32 + 1);
    }
    let spec = spec.ok_or(ChapterAudioError::InvalidData)?;
    writer
        .ok_or(ChapterAudioError::InvalidData)?
        .finalize()
        .map_err(|_| ChapterAudioError::WriteFailed)?;
    Ok(samples as f64 / f64::from(spec.channels) / f64::from(spec.sample_rate) * 1000.0)
}

pub(crate) fn start(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
) -> Result<Option<ChapterExportView>, ChapterAudioError> {
    let db = app.state::<sea_orm::DatabaseConnection>();
    let state = app.state::<ChapterAudioState>();
    let row = tauri::async_runtime::block_on(store::find(&*db, &run_id))?;
    if row.project_id != project_id {
        return Err(ChapterAudioError::NotFound);
    }
    if !tauri::async_runtime::block_on(arrangement::valid(&*db, &row))? {
        return Err(ChapterAudioError::Conflict);
    }
    crate::project::source_asset_text(
        &store::sources_root(&crate::storage::data(&app)),
        &row.source_sha256,
    )
    .map_err(|_| ChapterAudioError::ReadFailed)?;
    let plan =
        tauri::async_runtime::block_on(playback::prepare(&db, &state, &project_id, &run_id, 0))?;
    if plan.gap_index.is_some() || plan.entries.is_empty() {
        return Err(ChapterAudioError::InvalidData);
    }
    let inputs = plan
        .entries
        .iter()
        .map(|e| {
            state
                .media_path(&e.media_id)
                .ok_or(ChapterAudioError::ReadFailed)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("WAV", &["wav"])
        .set_file_name("chapter.wav")
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut target = file
        .into_path()
        .map_err(|_| ChapterAudioError::InvalidData)?;
    if target.extension().is_none() {
        target.set_extension("wav");
    }
    if !target
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("wav"))
    {
        return Err(ChapterAudioError::InvalidData);
    }
    let parent = target
        .parent()
        .ok_or(ChapterAudioError::InvalidData)?
        .canonicalize()
        .map_err(|_| ChapterAudioError::WriteFailed)?;
    if parent.starts_with(
        crate::storage::data(&app)
            .canonicalize()
            .map_err(|_| ChapterAudioError::ReadFailed)?,
    ) {
        return Err(ChapterAudioError::InvalidData);
    }
    target = parent.join(target.file_name().ok_or(ChapterAudioError::InvalidData)?);
    let before = fingerprint(&target).map_err(|_| ChapterAudioError::WriteFailed)?;
    if before.is_some()
        && !app
            .dialog()
            .message("替换已有 WAV 文件？ / Replace the existing WAV file?")
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show()
    {
        return Ok(None);
    }
    let view = ChapterExportView {
        id: uuid::Uuid::new_v4().to_string(),
        run_id,
        revision: plan.revision,
        status: "running".into(),
        completed: 0,
        total: inputs.len() as u32,
        duration_ms: None,
        filename: target.file_name().unwrap().to_string_lossy().into_owned(),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let exports = app.state::<ExportState>();
        let mut jobs = exports
            .0
            .lock()
            .map_err(|_| ChapterAudioError::WriteFailed)?;
        if jobs.values().any(|j| j.view.status == "running") {
            return Err(ChapterAudioError::Busy);
        }
        if jobs.len() >= 32 {
            jobs.retain(|_, j| j.view.status == "running");
        }
        jobs.insert(
            view.id.clone(),
            Job {
                view: view.clone(),
                cancel: cancel.clone(),
            },
        );
    }
    let id = view.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let exports = app.state::<ExportState>();
        let outcome = write(&inputs, &target, before, &cancel, |n| {
            exports.update(&id, |v| v.completed = n)
        });
        exports.update(&id, |v| match outcome {
            Ok(ms) => {
                v.status = "succeeded".into();
                v.duration_ms = Some(ms);
            }
            Err(_) => {
                v.status = if cancel.load(Ordering::Relaxed) {
                    "cancelled"
                } else {
                    "failed"
                }
                .into()
            }
        });
    });
    Ok(Some(view))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn wav(path: &Path, rate: u32, sample: i16) {
        let mut w = hound::WavWriter::create(
            path,
            hound::WavSpec {
                channels: 1,
                sample_rate: rate,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        for _ in 0..rate / 10 {
            w.write_sample(sample).unwrap();
        }
        w.finalize().unwrap();
    }
    #[test]
    fn export_is_ordered_and_failure_keeps_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.wav");
        let b = dir.path().join("b.wav");
        let out = dir.path().join("out.wav");
        wav(&a, 24000, 1);
        wav(&b, 24000, 2);
        assert_eq!(
            write(
                &[a.clone(), b.clone()],
                &out,
                None,
                &AtomicBool::new(false),
                |_| {}
            )
            .unwrap(),
            200.0
        );
        let bytes = std::fs::read(&out).unwrap();
        wav(&b, 22050, 2);
        assert!(
            write(
                &[a.clone(), b],
                &out,
                fingerprint(&out).unwrap(),
                &AtomicBool::new(false),
                |_| {}
            )
            .is_err()
        );
        assert_eq!(std::fs::read(&out).unwrap(), bytes);
        assert!(
            write(
                &[a],
                &out,
                fingerprint(&out).unwrap(),
                &AtomicBool::new(true),
                |_| {}
            )
            .is_err()
        );
        assert_eq!(std::fs::read(&out).unwrap(), bytes);
    }
}

#[cfg(test)]
mod faults {
    use super::*;
    use std::io::{Cursor, Seek, SeekFrom, Write};
    struct FullDisk(Cursor<Vec<u8>>);
    impl Write for FullDisk {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.0.position() > 80 {
                return Err(std::io::Error::from_raw_os_error(28));
            }
            self.0.write(bytes)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl Seek for FullDisk {
        fn seek(&mut self, from: SeekFrom) -> std::io::Result<u64> {
            self.0.seek(from)
        }
    }
    #[test]
    fn full_disk_corruption_and_target_change_fail_without_publish() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.wav");
        let target = root.path().join("target.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 24000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(&source, spec).unwrap();
        for _ in 0..100 {
            w.write_sample(1i16).unwrap();
        }
        w.finalize().unwrap();
        assert_eq!(
            compose(
                std::slice::from_ref(&source),
                FullDisk(Cursor::new(vec![])),
                &AtomicBool::new(false),
                |_| {}
            )
            .unwrap_err(),
            ChapterAudioError::WriteFailed
        );
        std::fs::write(&target, b"original").unwrap();
        let before = fingerprint(&target).unwrap();
        let result = write(
            std::slice::from_ref(&source),
            &target,
            before,
            &AtomicBool::new(false),
            |_| {
                std::fs::write(&target, b"changed by another process").unwrap();
            },
        );
        assert_eq!(result.unwrap_err(), ChapterAudioError::Conflict);
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"changed by another process"
        );
        std::fs::write(&source, b"corrupt").unwrap();
        assert!(
            write(
                &[source],
                &target,
                fingerprint(&target).unwrap(),
                &AtomicBool::new(false),
                |_| {}
            )
            .is_err()
        );
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"changed by another process"
        );
    }
}

#[cfg(test)]
mod composition_tests {
    use super::*;
    #[test]
    fn paused_export_uses_the_playback_pcm_and_preserves_order() {
        let root = tempfile::tempdir().unwrap();
        let state = ChapterAudioState::new(root.path().join("audio"));
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 22050,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut inputs = vec![];
        for (name, sample) in [("a.wav", 100i16), ("b.wav", -100i16)] {
            let path = root.path().join(name);
            let mut w = hound::WavWriter::create(&path, spec).unwrap();
            for _ in 0..2205 {
                w.write_sample(sample).unwrap();
            }
            w.finalize().unwrap();
            inputs.push(path);
        }
        let (silence, ms) = playback::silence(&state, "run", 810, spec).unwrap();
        inputs.insert(1, state.media_path(&silence).unwrap());
        let target = root.path().join("out.wav");
        let duration = write(&inputs, &target, None, &AtomicBool::new(false), |_| {}).unwrap();
        assert!((duration - (200.0 + ms)).abs() < 0.001);
        let samples = hound::WavReader::open(&target)
            .unwrap()
            .samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(samples[..2205].iter().all(|s| *s == 100));
        assert!(samples[2205..samples.len() - 2205].iter().all(|s| *s == 0));
        assert!(samples[samples.len() - 2205..].iter().all(|s| *s == -100));
        let non_directory = root.path().join("file");
        std::fs::write(&non_directory, b"not a directory").unwrap();
        assert!(
            write(
                &inputs,
                &non_directory.join("out.wav"),
                None,
                &AtomicBool::new(false),
                |_| {}
            )
            .is_err()
        );
    }
}
