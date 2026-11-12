//! 引擎 IPC：参数校验后委托领域模块，自身无业务逻辑。
use serde::{Deserialize, Serialize};

use super::{EngineState, ModelEntry, PrepareOutcome, catalog, config::EngineSettings, inventory};
use tauri::{Manager, State};

/// 引擎命令错误：类型化到前端可区分的程度。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) enum EngineCommandError {
    /// 引擎内部错误；可能含凭据的原始错误不跨 IPC 传播。
    Internal,
    /// 无效输入（未知后端/模型或非法设置）。
    Invalid(String),
}

impl From<anyhow::Error> for EngineCommandError {
    fn from(error: anyhow::Error) -> Self {
        // 原始下载错误可能含凭据，只向前端返回稳定分类。
        let _ = error; // Download errors may contain credential-bearing URLs.
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
        tauri::async_runtime::block_on(catalog::list_models(&state))
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

/// 清理当前生效的应用校准缓存及失去租约的旧试听会话。
#[tauri::command]
#[specta::specta]
pub(crate) async fn clear_application_cache(
    engine: State<'_, super::resources::EngineThread>,
) -> Result<u32, EngineCommandError> {
    engine
        .clear_application_cache()
        .await
        .map_err(EngineCommandError::Invalid)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn model_preparation_plan(
    engine: State<'_, super::resources::EngineThread>,
    backend: String,
    model: Option<String>,
) -> Result<super::preparation::ModelPreparationPlan, EngineCommandError> {
    engine
        .plan(backend, model)
        .await
        .map_err(|_| EngineCommandError::Internal)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn prepare_model(
    engine: State<'_, super::resources::EngineThread>,
    backend: String,
    model: Option<String>,
    fingerprint: String,
) -> Result<PrepareOutcome, EngineCommandError> {
    let backend = backend.trim().to_owned();
    if backend.is_empty() {
        return Err(EngineCommandError::Invalid("backend 不能为空".into()));
    }
    engine
        .prepare(backend, model, fingerprint)
        .await
        .map_err(EngineCommandError::Invalid)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn pause_prepare(
    engine: State<'_, super::resources::EngineThread>,
    backend: String,
    model: String,
) -> Result<bool, EngineCommandError> {
    engine
        .pause(backend, model)
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

/// 先取得盘点，再在同一流锁内叠加竞态期间的更新、发送快照并登记订阅。
#[tauri::command]
#[specta::specta]
pub(crate) async fn subscribe_model_resources(
    window: tauri::WebviewWindow,
    on_event: tauri::ipc::Channel<super::events::ModelResourceMessage>,
) -> Result<u32, EngineCommandError> {
    let app = window.app_handle().clone();
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let since = state.model_stream.sequence();
        let entries = tauri::async_runtime::block_on(catalog::list_models(&state))?;
        state
            .model_stream
            .subscribe(owner, on_event, entries, since)
            .map_err(anyhow::Error::msg)
    })
    .await
    .map_err(|_| EngineCommandError::Internal)?
    .map_err(EngineCommandError::from)
}
#[tauri::command]
#[specta::specta]
pub(crate) fn unsubscribe_model_resources(window: tauri::WebviewWindow, subscription: u32) {
    window
        .state::<EngineState>()
        .model_stream
        .unsubscribe(window.label(), subscription);
}
/// 路径只取宿主当前生效的配置，不接受前端任意路径。
#[tauri::command]
#[specta::specta]
pub(crate) async fn open_model_cache(app: tauri::AppHandle) -> Result<(), EngineCommandError> {
    use tauri_plugin_opener::OpenerExt;
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
        let path = app.state::<EngineState>().download_config()?.cache_dir;
        std::fs::create_dir_all(&path)?;
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)?;
        Ok(())
    })
    .await
    .map_err(|_| EngineCommandError::Internal)?
    .map_err(EngineCommandError::from)
}
