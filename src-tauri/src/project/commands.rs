//! Portable publication is separate from the local recovery draft.
use crate::{
    novel_import::{ImportSnapshot, ImportState},
    project::{self, ProjectError},
};
use std::sync::Arc;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
#[specta::specta]
pub(crate) async fn save_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ImportState>>,
    id: String,
) -> Result<Option<ImportSnapshot>, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let document = state.export_document(&id)?;
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("CastGlean", &["castglean"])
            .set_file_name(project::filename(&document.project.title))
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let mut path = path.into_path().map_err(|_| ProjectError::DialogFailed)?;
        if path.extension().is_none() {
            path.set_extension("castglean");
        }
        state
            .save_to(&id, document.project.revision, &path)
            .map(Some)
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn open_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ImportState>>,
) -> Result<Option<ImportSnapshot>, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("CastGlean", &["castglean"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| ProjectError::DialogFailed)?;
        let document = project::read(&path)?;
        state
            .install(
                document,
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
            )
            .map(Some)
    })
    .await
    .map_err(|_| ProjectError::ReadFailed)?
}
