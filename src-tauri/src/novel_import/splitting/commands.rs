//! Explicit human decision IPC. No chat text can invoke adoption.
use super::store::{self, ProposalInfo, SplitError};
use crate::project::{ProjectError, receipts::CommandResult};
use sea_orm::DatabaseConnection;
use tauri::Manager;

#[tauri::command]
#[specta::specta]
pub(crate) async fn split_proposal(
    db: tauri::State<'_, DatabaseConnection>,
    proposal_id: String,
) -> Result<ProposalInfo, SplitError> {
    store::query(db.inner(), &proposal_id).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn split_adopt(
    app: tauri::AppHandle,
    proposal_id: String,
    command_id: String,
) -> Result<CommandResult, SplitError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    let root = crate::storage::data(&app).join("project-sources");
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(store::adopt(&db, &root, &proposal_id, &command_id))
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn split_discard(
    db: tauri::State<'_, DatabaseConnection>,
    proposal_id: String,
    command_id: String,
) -> Result<CommandResult, SplitError> {
    store::discard(db.inner(), &proposal_id, &command_id).await
}
