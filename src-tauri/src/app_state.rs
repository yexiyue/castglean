//! 应用级界面状态：首次使用引导的完成标记由宿主持久化，前端只读。
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;

const STATE_VERSION: u32 = 1;

/// 前端可见的应用状态快照。
#[derive(Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppStateSnapshot {
    pub onboarding_completed: bool,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type, thiserror::Error,
)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AppStateError {
    #[error("app_state_unavailable")]
    Unavailable,
    #[error("app_state_write_failed")]
    WriteFailed,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredState {
    version: u32,
    onboarding_completed: bool,
}

impl Default for StoredState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            onboarding_completed: false,
        }
    }
}

/// 宿主持有的应用级状态；写入通过同目录临时文件原子替换。
pub(crate) struct AppState {
    path: PathBuf,
    inner: Mutex<StoredState>,
}

impl AppState {
    pub(crate) fn open(path: PathBuf) -> Self {
        let stored = read(&path).unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(stored),
        }
    }

    fn snapshot(&self) -> Result<AppStateSnapshot, AppStateError> {
        let inner = self.inner.lock().map_err(|_| AppStateError::Unavailable)?;
        Ok(AppStateSnapshot {
            onboarding_completed: inner.onboarding_completed,
        })
    }

    fn complete_onboarding(&self) -> Result<AppStateSnapshot, AppStateError> {
        let mut inner = self.inner.lock().map_err(|_| AppStateError::Unavailable)?;
        inner.onboarding_completed = true;
        crate::atomic_json::save(&self.path, &*inner, None)
            .map_err(|_| AppStateError::WriteFailed)?;
        Ok(AppStateSnapshot {
            onboarding_completed: true,
        })
    }
}

/// 缺失或损坏的状态文件都按未完成处理：引导标记不值得阻断应用启动。
fn read(path: &Path) -> Option<StoredState> {
    let raw = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str::<StoredState>(&raw) {
        Ok(state) if state.version == STATE_VERSION => Some(state),
        _ => {
            tracing::warn!(
                target: "app_state",
                event = "app_state_unreadable",
                "resetting unreadable app state"
            );
            None
        }
    }
}

pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let path = app.path().app_config_dir()?.join("app-state.json");
    app.manage(Arc::new(AppState::open(path)));
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn app_state_snapshot(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<AppStateSnapshot, AppStateError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.snapshot())
        .await
        .map_err(|_| AppStateError::Unavailable)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn app_state_complete_onboarding(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<AppStateSnapshot, AppStateError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.complete_onboarding())
        .await
        .map_err(|_| AppStateError::Unavailable)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_starts_uncompleted() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::open(dir.path().join("app-state.json"));
        assert!(!state.snapshot().unwrap().onboarding_completed);
    }

    #[test]
    fn completion_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-state.json");
        let state = AppState::open(path.clone());
        assert!(state.complete_onboarding().unwrap().onboarding_completed);
        let reopened = AppState::open(path);
        assert!(reopened.snapshot().unwrap().onboarding_completed);
    }

    #[test]
    fn unreadable_file_resets_to_uncompleted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-state.json");
        std::fs::write(&path, "{not json").unwrap();
        let state = AppState::open(path);
        assert!(!state.snapshot().unwrap().onboarding_completed);
    }
}
