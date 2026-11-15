use super::*;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
#[specta::specta]
pub(crate) async fn local_source_select(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Selections>>,
) -> Result<Vec<FilePreview>, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(paths) = app
            .dialog()
            .file()
            .add_filter("TXT", &["txt"])
            .blocking_pick_files()
        else {
            return Ok(Vec::new());
        };
        let mut path_bufs = Vec::with_capacity(paths.len());
        for path in paths {
            path_bufs.push(path.into_path().map_err(|_| ProjectError::DialogFailed)?);
        }
        state.select_many(&path_bufs)
    })
    .await
    .map_err(|_| ProjectError::ReadFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn local_source_accept(
    state: tauri::State<'_, Arc<Selections>>,
    paths: Vec<String>,
) -> Result<Vec<FilePreview>, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths: Vec<_> = paths.into_iter().map(std::path::PathBuf::from).collect();
        state.select_many(&paths)
    })
    .await
    .map_err(|_| ProjectError::ReadFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn local_source_preview(
    state: tauri::State<'_, Arc<Selections>>,
    selection_id: String,
    encoding: String,
) -> Result<FilePreview, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.preview(&selection_id, &encoding))
        .await
        .map_err(|_| ProjectError::ReadFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) fn local_source_release(
    state: tauri::State<'_, Arc<Selections>>,
    selection_id: String,
) -> Result<(), ProjectError> {
    state.release(&selection_id)
}
