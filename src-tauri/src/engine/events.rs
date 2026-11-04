//! 宿主 → 前端的引擎事件桥（tauri-specta）。
//!
//! 事件与查询快照共用完整资源状态，避免额外的进度字段与状态重建。
//! 凭据与路径细节不进入事件。
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_specta::Event;

use super::ResourceState;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct ModelResourceEvent {
    pub backend: String,
    pub model: String,
    pub state: ResourceState,
}

impl ModelResourceEvent {
    /// 保存任务快照后发送通知；订阅重连不依赖通知必达。
    pub(crate) fn publish(&self, app: &tauri::AppHandle) {
        app.state::<super::EngineState>().record_task_state(
            &self.backend,
            &self.model,
            self.state.clone(),
        );
        let _ = self.emit(app);
    }

    pub(crate) fn progress(
        backend: &str,
        model: &str,
        downloaded: f64,
        total: f64,
        current_file: &str,
    ) -> Self {
        Self::state(
            backend,
            model,
            ResourceState::Downloading {
                downloaded_bytes: downloaded,
                total_bytes: total,
                current_file: Some(current_file.into()),
            },
        )
    }

    pub(crate) fn state(backend: &str, model: &str, state: ResourceState) -> Self {
        Self {
            backend: backend.into(),
            model: model.into(),
            state,
        }
    }
}
