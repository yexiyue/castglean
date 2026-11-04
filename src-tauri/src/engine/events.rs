//! 宿主 → 前端的引擎事件桥（tauri-specta）。
//!
//! 扁平结构：进度事件填字节字段，状态变更填 `state`；凭据与路径细节
//! 不进入事件。
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_specta::Event;

use super::ResourceState;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct ModelResourceEvent {
    pub backend: String,
    pub model: String,
    /// 进度事件：已下载字节（跨文件累计的整体进度）。
    pub downloaded_bytes: Option<f64>,
    /// 进度事件：总字节（本次准备还需下载的字节量）。
    pub total_bytes: Option<f64>,
    /// 进度事件：当前正在下载的文件名。
    pub current_file: Option<String>,
    /// 状态变更事件：新的资源状态。
    pub state: Option<ResourceState>,
}

impl ModelResourceEvent {
    /// 保存任务快照后发送通知；订阅重连不依赖通知必达。
    pub(crate) fn publish(&self, app: &tauri::AppHandle) {
        let state = self.state.clone().or_else(|| {
            self.downloaded_bytes
                .map(|downloaded_bytes| ResourceState::Downloading {
                    downloaded_bytes,
                    total_bytes: self.total_bytes.unwrap_or_default(),
                    current_file: self.current_file.clone(),
                })
        });
        if let Some(state) = state {
            app.state::<super::EngineState>()
                .record_task_state(&self.backend, &self.model, state);
        }
        let _ = self.emit(app);
    }

    pub(crate) fn progress(
        backend: &str,
        model: &str,
        downloaded: f64,
        total: f64,
        current_file: &str,
    ) -> Self {
        Self {
            backend: backend.into(),
            model: model.into(),
            downloaded_bytes: Some(downloaded),
            total_bytes: Some(total),
            current_file: Some(current_file.into()),
            state: None,
        }
    }

    pub(crate) fn state(backend: &str, model: &str, state: ResourceState) -> Self {
        Self {
            backend: backend.into(),
            model: model.into(),
            downloaded_bytes: None,
            total_bytes: None,
            current_file: None,
            state: Some(state),
        }
    }
}
