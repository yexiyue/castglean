//! Local project IPC: metadata reads and committed commands, never portable files.
use super::query::{LocalProjectListItem, LocalProjectSnapshot};
use super::{
    ProjectDocument, ProjectError, TextPage, edits,
    receipts::CommandResult,
    store::{self, EditState, LocalProject},
};
use crate::novel_import::{self, confirm::ImportSource, selection::Selections};
use sea_orm::DatabaseConnection;
use std::{path::PathBuf, sync::Arc};
use tauri::Manager;

fn resources(app: &tauri::AppHandle) -> Result<(DatabaseConnection, PathBuf), ProjectError> {
    Ok((
        app.state::<DatabaseConnection>().inner().clone(),
        crate::storage::data(app).join("project-sources"),
    ))
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn local_project_create(
    app: tauri::AppHandle,
    title: String,
    description: String,
) -> Result<LocalProjectSnapshot, ProjectError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = LocalProject {
            document: ProjectDocument::new(uuid::Uuid::new_v4().to_string(), title, description),
            edit: EditState {
                rules: serde_json::to_value(novel_import::heading_rules())
                    .map_err(|_| ProjectError::InvalidProject)?,
                issues: serde_json::json!([]),
                single_chapter_sources: serde_json::json!([]),
                undo: None,
            },
        };
        tauri::async_runtime::block_on(store::save(&db, &root, &state, None))?;
        state.try_into()
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn local_project_snapshot(
    app: tauri::AppHandle,
    id: String,
) -> Result<LocalProjectSnapshot, ProjectError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(store::read(&db, &root, &id)).and_then(TryInto::try_into)
    })
    .await
    .map_err(|_| ProjectError::ReadFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn local_project_list(
    app: tauri::AppHandle,
) -> Result<Vec<LocalProjectListItem>, ProjectError> {
    let (db, _) = resources(&app)?;
    super::query::list(&db).await
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn local_project_edit(
    app: tauri::AppHandle,
    id: String,
    revision: u32,
    command_id: String,
    edit: edits::ProjectEdit,
) -> Result<CommandResult, ProjectError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(edits::apply(&db, &root, &id, revision, &command_id, edit))
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn local_project_undo(
    app: tauri::AppHandle,
    id: String,
    revision: u32,
    command_id: String,
) -> Result<CommandResult, ProjectError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(edits::undo(&db, &root, &id, revision, &command_id))
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn local_project_import(
    app: tauri::AppHandle,
    selections: tauri::State<'_, Arc<Selections>>,
    request: ImportSource,
) -> Result<CommandResult, ProjectError> {
    let (db, root) = resources(&app)?;
    let selections = selections.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(novel_import::confirm::confirm(
            &db,
            &root,
            &selections,
            request,
        ))
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn local_project_text(
    app: tauri::AppHandle,
    id: String,
    source_id: String,
    line: u32,
    count: u32,
) -> Result<TextPage, ProjectError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(super::read_source_text(
            &db, &root, &id, &source_id, line, count,
        ))
    })
    .await
    .map_err(|_| ProjectError::ReadFailed)?
}
