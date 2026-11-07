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
        if paths.len() > 128 {
            return Err(ProjectError::TooLarge);
        }
        let mut selected: Vec<FilePreview> = Vec::new();
        for path in paths {
            match path
                .into_path()
                .map_err(|_| ProjectError::DialogFailed)
                .and_then(|p| state.select(&p))
            {
                Ok(preview) => selected.push(preview),
                Err(error) => {
                    for preview in selected {
                        let _ = state.release(&preview.id);
                    }
                    return Err(error);
                }
            }
        }
        Ok(selected)
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
