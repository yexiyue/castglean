//! 引擎 IPC：参数校验后委托领域模块，自身无业务逻辑。
use serde::{Deserialize, Serialize};

use super::{EngineState, ModelEntry, PrepareOutcome, catalog, config::EngineSettings, inventory};
use tauri::{Manager, State};

/// 引擎命令错误：类型化到前端可区分的程度。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) enum EngineCommandError {
    /// 引擎内部错误；详情已写入日志，凭据不进入错误。
    Internal,
    /// 无效输入（未知后端/模型或非法设置）。
    Invalid(String),
}

impl From<anyhow::Error> for EngineCommandError {
    fn from(error: anyhow::Error) -> Self {
        // 概要进前端，全链路进日志；凭据不会出现在引擎错误消息中。
        eprintln!("engine command failed: {error:#}");
        EngineCommandError::Internal
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn list_models(
    app: tauri::AppHandle,
) -> Result<Vec<ModelEntry>, EngineCommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        catalog::list_models(&state)
    })
    .await
    .map_err(|_| EngineCommandError::Internal)?
    .map_err(EngineCommandError::from)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn get_engine_settings(
    state: State<'_, EngineState>,
) -> Result<EngineSettings, EngineCommandError> {
    Ok(state.settings())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn update_engine_settings(
    engine: State<'_, super::resources::EngineThread>,
    settings: EngineSettings,
) -> Result<EngineSettings, EngineCommandError> {
    engine
        .update_settings(settings)
        .await
        .map_err(EngineCommandError::Invalid)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn prepare_model(
    engine: State<'_, super::resources::EngineThread>,
    backend: String,
    model: Option<String>,
) -> Result<PrepareOutcome, EngineCommandError> {
    let backend = backend.trim().to_owned();
    if backend.is_empty() {
        return Err(EngineCommandError::Invalid("backend 不能为空".into()));
    }
    engine
        .prepare(backend, model)
        .await
        .map_err(EngineCommandError::Invalid)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn cancel_prepare(
    engine: State<'_, super::resources::EngineThread>,
    backend: String,
    model: String,
) -> Result<bool, EngineCommandError> {
    engine
        .cancel(backend, model)
        .await
        .map_err(EngineCommandError::Invalid)
}

/// 存储概览：生效缓存目录与其所在卷可用空间（供下载前确认对话展示）。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct StorageStatus {
    /// 生效的模型缓存目录（绝对路径）。
    pub cache_dir: String,
    /// 所在卷可用空间（字节）；查询失败为 None。
    pub available_bytes: Option<f64>,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn get_storage_status(
    app: tauri::AppHandle,
) -> Result<StorageStatus, EngineCommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let config = state.download_config()?;
        Ok(StorageStatus {
            cache_dir: config.cache_dir.display().to_string(),
            available_bytes: inventory::available_for(&config.cache_dir).ok(),
        })
    })
    .await
    .map_err(|_| EngineCommandError::Internal)?
}

/// 冒烟验证：通过专用引擎线程加载，成功即释放。
#[tauri::command]
#[specta::specta]
pub(crate) async fn verify_model(
    engine: State<'_, super::resources::EngineThread>,
    backend: String,
    model: Option<String>,
) -> Result<(), EngineCommandError> {
    engine
        .verify(backend, model)
        .await
        .map_err(EngineCommandError::Invalid)
}
