//! Host-owned import and editing entry points; file paths never come from model or frontend.
use super::{DraftEdit, FilePreview, ImportSnapshot, ImportState, TextPage};
use crate::project::ProjectError;
use std::sync::Arc;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
#[specta::specta]
pub(crate) async fn import_create(
    state: tauri::State<'_, Arc<ImportState>>,
    title: String,
    description: String,
) -> Result<ImportSnapshot, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.create(title, description))
        .await
        .map_err(|_| ProjectError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn import_list(
    state: tauri::State<'_, Arc<ImportState>>,
) -> Result<Vec<ImportSnapshot>, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.list())
        .await
        .map_err(|_| ProjectError::ReadFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn import_snapshot(
    state: tauri::State<'_, Arc<ImportState>>,
    id: String,
) -> Result<ImportSnapshot, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.read(&id).map(|r| r.snapshot()))
        .await
        .map_err(|_| ProjectError::ReadFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn import_select(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ImportState>>,
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
        let mut selected = Vec::new();
        for path in paths {
            let result = path
                .into_path()
                .map_err(|_| ProjectError::DialogFailed)
                .and_then(|path| state.select(&path, None));
            match result {
                Ok(file) => selected.push(file),
                Err(error) => {
                    for file in selected {
                        let _ = state.release_selection(&file.id);
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
pub(crate) async fn import_preview_encoding(
    state: tauri::State<'_, Arc<ImportState>>,
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
pub(crate) async fn import_confirm(
    state: tauri::State<'_, Arc<ImportState>>,
    id: String,
    revision: u32,
    selection_id: String,
    encoding: String,
    split: bool,
) -> Result<ImportSnapshot, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.confirm(&id, revision, &selection_id, &encoding, split)
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn import_edit(
    state: tauri::State<'_, Arc<ImportState>>,
    id: String,
    revision: u32,
    edit: DraftEdit,
) -> Result<ImportSnapshot, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.edit(&id, revision, edit))
        .await
        .map_err(|_| ProjectError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn import_text(
    state: tauri::State<'_, Arc<ImportState>>,
    id: String,
    source_id: String,
    line: u32,
    count: u32,
) -> Result<TextPage, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.text(&id, &source_id, line, count))
        .await
        .map_err(|_| ProjectError::ReadFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn import_release_selection(
    state: tauri::State<'_, Arc<ImportState>>,
    selection_id: String,
) -> Result<(), ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.release_selection(&selection_id))
        .await
        .map_err(|_| ProjectError::WriteFailed)?
}
