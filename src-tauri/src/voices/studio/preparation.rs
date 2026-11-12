//! Design resource preparation shares the typed download journal and progress aggregation.
use super::tasks::cancelled;
use super::*;
use talechime::VoiceStudio;
use tauri::Manager;
use tauri_specta::Event;
use tokio::sync::watch;

struct DownloadGuard {
    app: tauri::AppHandle,
    key: crate::engine::ResourceKey,
    downloads: talechime::Downloads,
    finished: bool,
}
impl Drop for DownloadGuard {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        use crate::engine::{EngineState, PrepareFailure, ResourceState};
        let state = self.app.state::<EngineState>();
        let resource = match state.resource_task_state(&self.key) {
            Some(ResourceState::Downloading {
                downloaded_bytes,
                total_bytes,
                current_file,
                ..
            }) => {
                if self.downloads.checkpoint_failed() {
                    ResourceState::Failed {
                        error: PrepareFailure::Disk,
                        missing_bytes: (total_bytes - downloaded_bytes).max(0.0),
                    }
                } else {
                    ResourceState::Paused {
                        downloaded_bytes,
                        total_bytes,
                        current_file,
                    }
                }
            }
            _ => return,
        };
        state.record_resource_state(self.key.clone(), resource);
    }
}
pub(super) async fn run(
    app: &tauri::AppHandle,
    id: u32,
    studio: &VoiceStudio,
    registry: &talechime::Registry,
    engine: &str,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    use crate::engine::{EngineState, ResourceKey, ResourceState};
    let state = app.state::<EngineState>();
    let engines = tokio::select! {
        result = studio.engines() => result.map_err(|error| error.to_string())?,
        _ = cancelled(cancel) => return Err("cancelled".into()),
    };
    let info = engines
        .into_iter()
        .find(|info| info.id == engine)
        .ok_or("unknown design engine")?;
    let key = ResourceKey::Design {
        engine: engine.into(),
    };
    if info.ready {
        state.record_resource_state(key, ResourceState::Ready);
        return Ok(());
    }
    if info.devices.is_empty() {
        return Err("design engine has no available device".into());
    }
    let cache = state
        .download_config()
        .map_err(|e| e.to_string())?
        .cache_dir;
    if crate::engine::inventory::available_for(&cache).map_err(|e| e.to_string())?
        < info.extra_download_bytes as f64
    {
        return Err("insufficient disk space".into());
    }
    let total = info.extra_download_bytes as f64;
    state.record_resource_state(
        key.clone(),
        ResourceState::Downloading {
            downloaded_bytes: 0.0,
            total_bytes: total,
            current_file: None,
            bytes_per_second: None,
            remaining_seconds: None,
            stalled: false,
        },
    );
    state.persist_resource_tasks().map_err(|e| e.to_string())?;
    let mut guard = DownloadGuard {
        app: app.clone(),
        key: key.clone(),
        downloads: registry.downloads().clone(),
        finished: false,
    };
    let (tx, rx) = tokio::sync::mpsc::channel(64);
    let forward = crate::engine::progress::forward(rx, |file, metrics| {
        let downloaded = (metrics.downloaded as f64).min(total);
        let resource = ResourceState::Downloading {
            downloaded_bytes: downloaded,
            total_bytes: total,
            current_file: Some(file.into()),
            bytes_per_second: metrics.bytes_per_second,
            remaining_seconds: metrics
                .bytes_per_second
                .filter(|rate| *rate > 0.0)
                .map(|rate| (total - downloaded) / rate),
            stalled: metrics.stalled,
        };
        state.record_resource_state(key.clone(), resource.clone());
        let update = app
            .state::<StudioState>()
            .tasks
            .lock()
            .unwrap()
            .resource_progress(id, resource);
        if let Some(job) = update {
            let _ = StudioUpdate(job).emit(app);
        }
    });
    let work = async { tokio::join!(studio.prepare_design(engine, tx), forward).0 };
    let result = tokio::select! { result = work => result, _ = cancelled(cancel) => return Err("cancelled".into()) };
    guard.finished = true;
    match result {
        Ok(()) => {
            state.record_resource_state(key, ResourceState::Ready);
            state.persist_resource_tasks().map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(error) => {
            let diagnostic = error.to_string();
            let error = anyhow::Error::new(error);
            let remaining = studio
                .engines()
                .await
                .unwrap_or_default()
                .into_iter()
                .find(|info| info.id == engine)
                .map(|info| info.extra_download_bytes as f64)
                .unwrap_or(total);
            state.record_resource_state(
                key,
                ResourceState::Failed {
                    error: crate::engine::inventory::classify_failure(&error),
                    missing_bytes: remaining,
                },
            );
            Err(diagnostic)
        }
    }
}
