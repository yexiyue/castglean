//! Idempotent application commands. Receipts contain result references, never project bodies.
use super::{ProjectError, hash};
use crate::database::entity::command_receipt;
use sea_orm::{ActiveModelTrait, ConnectionTrait, DatabaseTransaction, EntityTrait, Set};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommandResult {
    pub version: u32,
    pub project_id: String,
    pub revision: u32,
    pub result_id: Option<String>,
}

pub(crate) fn fingerprint<T: Serialize>(
    operation: &str,
    payload: &T,
) -> Result<String, ProjectError> {
    Ok(hash(
        &serde_json::to_vec(&(operation, payload)).map_err(|_| ProjectError::InvalidProject)?,
    ))
}

pub(crate) async fn replay(
    db: &impl ConnectionTrait,
    id: &str,
    operation: &str,
    request_hash: &str,
) -> Result<Option<CommandResult>, ProjectError> {
    uuid::Uuid::parse_str(id).map_err(|_| ProjectError::InvalidProject)?;
    let row = command_receipt::Entity::find_by_id(id)
        .one(db)
        .await
        .map_err(|_| ProjectError::ReadFailed)?;
    row.map(|row| {
        if row.operation != operation || row.request_hash != request_hash {
            return Err(ProjectError::Conflict);
        }
        let result: CommandResult =
            serde_json::from_value(row.result).map_err(|_| ProjectError::InvalidProject)?;
        if result.version != 1 || result.project_id != row.project_id || result.revision == 0 {
            return Err(ProjectError::InvalidProject);
        }
        Ok(result)
    })
    .transpose()
}

pub(crate) async fn record(
    tx: &DatabaseTransaction,
    id: &str,
    operation: &str,
    request_hash: &str,
    result: &CommandResult,
) -> Result<(), ProjectError> {
    if result.version != 1 || result.revision == 0 {
        return Err(ProjectError::InvalidProject);
    }
    command_receipt::ActiveModel {
        id: Set(id.into()),
        project_id: Set(result.project_id.clone()),
        operation: Set(operation.into()),
        request_hash: Set(request_hash.into()),
        result: Set(serde_json::to_value(result).map_err(|_| ProjectError::InvalidProject)?),
    }
    .insert(tx)
    .await
    .map_err(|_| ProjectError::WriteFailed)?;
    Ok(())
}
