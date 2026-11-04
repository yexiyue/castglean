//! 系统选择器建立文件权限；其余命令只接受受控会话和音色身份。
use super::*;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
fn unavailable() -> VoiceError {
    VoiceError::new(VoiceFailure::Unavailable)
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn list_library_voices(
    app: tauri::AppHandle,
) -> Result<VoiceInventory, VoiceError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<VoiceState>().inventory())
        .await
        .map_err(|_| unavailable())?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn select_voice_packages(
    app: tauri::AppHandle,
) -> Result<Option<VoiceFileSelection>, VoiceError> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(files) = app
            .dialog()
            .file()
            .add_filter("TaleChime", &["voice"])
            .blocking_pick_files()
        else {
            return Ok(None);
        };
        let paths = files
            .into_iter()
            .map(|p| p.into_path().map_err(|_| unavailable()))
            .collect::<Result<Vec<_>, _>>()?;
        app.state::<VoiceState>().select_files(paths).map(Some)
    })
    .await
    .map_err(|_| unavailable())?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn inspect_voice_packages(
    app: tauri::AppHandle,
    selection: u32,
    indices: Vec<u32>,
) -> Result<u32, VoiceError> {
    app.state::<VoiceState>()
        .start_inspect(app.clone(), selection, indices)
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn import_voice_entries(
    app: tauri::AppHandle,
    preview: u32,
    decisions: Vec<VoiceImportDecision>,
) -> Result<u32, VoiceError> {
    app.state::<VoiceState>()
        .start_import(app.clone(), preview, decisions)
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn export_voice_entries(
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Option<u32>, VoiceError> {
    tauri::async_runtime::spawn_blocking(move || {
        if ids.is_empty() || ids.len() > 256 {
            return Err(VoiceError::new(VoiceFailure::LimitExceeded));
        }
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("TaleChime", &["voice"])
            .set_file_name("voices.voice")
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let mut path = file.into_path().map_err(|_| unavailable())?;
        if path.extension().is_none() {
            path.set_extension("voice");
        }
        let replace = path.exists();
        let window = app.get_webview_window("main").ok_or_else(unavailable)?;
        if replace
            && !app
                .dialog()
                .message("Replace the existing voice package? / 替换已有音色包？")
                .title("CastGlean")
                .parent(&window)
                .buttons(MessageDialogButtons::OkCancel)
                .blocking_show()
        {
            return Ok(None);
        }
        app.state::<VoiceState>()
            .start_export(app.clone(), ids, path, replace)
            .map(Some)
    })
    .await
    .map_err(|_| unavailable())?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_transfer_tasks(
    state: tauri::State<'_, VoiceState>,
) -> Result<Vec<VoiceTaskSnapshot>, VoiceError> {
    Ok(state
        .transfers
        .lock()
        .map_err(|_| unavailable())?
        .snapshots())
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn cancel_voice_transfer(
    app: tauri::AppHandle,
    id: u32,
) -> Result<(), VoiceError> {
    let snapshot = app
        .state::<VoiceState>()
        .transfers
        .lock()
        .map_err(|_| unavailable())?
        .cancel(id)?;
    VoiceTransferEvent::publish(snapshot, &app);
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn dismiss_voice_transfer(
    state: tauri::State<'_, VoiceState>,
    id: u32,
) -> Result<(), VoiceError> {
    state
        .transfers
        .lock()
        .map_err(|_| unavailable())?
        .dismiss(id)
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn release_voice_selection(
    state: tauri::State<'_, VoiceState>,
    id: u32,
) -> Result<(), VoiceError> {
    state
        .transfers
        .lock()
        .map_err(|_| unavailable())?
        .release_selection(id);
    Ok(())
}
