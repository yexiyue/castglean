//! Split candidate storage and explicit human decisions.
use super::*;
use crate::{
    database::entity::{project, split_proposal},
    project::{
        receipts::{self, CommandResult},
        store::{self as projects, UndoState},
    },
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, PaginatorTrait, QueryFilter, Set, TransactionTrait,
};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProposalStatus {
    Pending,
    Adopted,
    Discarded,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalInfo {
    pub id: String,
    pub project_id: String,
    pub run_id: String,
    pub base_revision: u32,
    pub status: ProposalStatus,
    pub stale: bool,
    pub content: ProposalContent,
}

async fn stamp(
    db: &impl ConnectionTrait,
    id: &str,
) -> Result<(u32, BTreeMap<String, String>), ProjectError> {
    let p = project::Entity::find_by_id(id)
        .one(db)
        .await
        .map_err(|_| ProjectError::ReadFailed)?
        .ok_or(ProjectError::NotFound)?;
    let revision = p
        .revision
        .try_into()
        .map_err(|_| ProjectError::InvalidProject)?;
    let hashes = crate::project::source_hashes(db, id)
        .await
        .map_err(|_| ProjectError::ReadFailed)?;
    Ok((revision, hashes))
}

fn content(row: &split_proposal::Model) -> Result<ProposalContent, ProjectError> {
    if row.version != 1 {
        return Err(ProjectError::UnsupportedVersion);
    }
    serde_json::from_value(row.content.clone()).map_err(|_| ProjectError::InvalidProject)
}

pub(crate) async fn query(db: &DatabaseConnection, id: &str) -> Result<ProposalInfo, ProjectError> {
    let tx = db.begin().await.map_err(|_| ProjectError::WriteFailed)?;
    let row = split_proposal::Entity::find_by_id(id)
        .one(&tx)
        .await
        .map_err(|_| ProjectError::ReadFailed)?
        .ok_or(ProjectError::NotFound)?;
    let content = content(&row)?;
    let (revision, hashes) = stamp(&tx, &row.project_id).await?;
    let expected: BTreeMap<String, String> =
        serde_json::from_value(row.source_hashes).map_err(|_| ProjectError::InvalidProject)?;
    let status: ProposalStatus = serde_json::from_value(Value::String(row.status))
        .map_err(|_| ProjectError::InvalidProject)?;
    tx.commit().await.map_err(|_| ProjectError::WriteFailed)?;
    Ok(ProposalInfo {
        id: row.id,
        project_id: row.project_id,
        run_id: row.run_id,
        base_revision: row
            .base_revision
            .try_into()
            .map_err(|_| ProjectError::InvalidProject)?,
        status,
        stale: row.base_revision as u32 != revision || expected != hashes,
        content,
    })
}

pub(crate) async fn matches_published(
    tx: &sea_orm::DatabaseTransaction,
    id: &str,
    run_id: &str,
    proposed: &PreparedProposal,
    expected_hashes: &Value,
) -> Result<Option<bool>, sea_orm::DbErr> {
    let row = split_proposal::Entity::find_by_id(id).one(tx).await?;
    Ok(row.map(|row| {
        row.run_id == run_id
            && row.project_id == proposed.project_id
            && row.version == 1
            && row.base_revision as u32 == proposed.revision
            && &row.source_hashes == expected_hashes
    }))
}

pub(crate) async fn insert_pending(
    tx: &sea_orm::DatabaseTransaction,
    id: &str,
    run_id: &str,
    proposed: PreparedProposal,
) -> Result<(), ProjectError> {
    if stamp(tx, &proposed.project_id).await? != (proposed.revision, proposed.hashes.clone()) {
        return Err(ProjectError::Conflict);
    }
    if split_proposal::Entity::find()
        .filter(split_proposal::Column::RunId.eq(run_id))
        .count(tx)
        .await
        .map_err(|_| ProjectError::ReadFailed)?
        >= 16
    {
        return Err(ProjectError::TooLarge);
    }
    split_proposal::ActiveModel {
        id: Set(id.into()),
        project_id: Set(proposed.project_id),
        run_id: Set(run_id.into()),
        base_revision: Set(proposed
            .revision
            .try_into()
            .map_err(|_| ProjectError::TooLarge)?),
        source_hashes: Set(
            serde_json::to_value(proposed.hashes).map_err(|_| ProjectError::InvalidProject)?
        ),
        version: Set(1),
        content: Set(
            serde_json::to_value(proposed.content).map_err(|_| ProjectError::InvalidProject)?
        ),
        status: Set("pending".into()),
    }
    .insert(tx)
    .await
    .map_err(|_| ProjectError::WriteFailed)?;
    Ok(())
}

pub(crate) async fn adopt(
    db: &DatabaseConnection,
    root: &Path,
    proposal_id: &str,
    command_id: &str,
) -> Result<CommandResult, ProjectError> {
    let hash = receipts::fingerprint("adopt_split", &proposal_id)?;
    if let Some(result) = receipts::replay(db, command_id, "adopt_split", &hash).await? {
        return Ok(result);
    }
    let row = split_proposal::Entity::find_by_id(proposal_id)
        .one(db)
        .await
        .map_err(|_| ProjectError::ReadFailed)?
        .ok_or(ProjectError::NotFound)?;
    let candidate = content(&row)?;
    let mut state = projects::read(db, root, &row.project_id).await?;
    if row.status != "pending"
        || row.base_revision as u32 != state.document.project.revision
        || row.source_hashes
            != serde_json::to_value(hashes(&state)).map_err(|_| ProjectError::InvalidProject)?
    {
        return Err(ProjectError::Conflict);
    }
    validate(&state, &candidate)?;
    let revision = state.document.project.revision;
    state.edit.undo = Some(UndoState {
        document: state.document.clone(),
        rules: state.edit.rules.clone(),
        issues: state.edit.issues.clone(),
        single_chapter_sources: state.edit.single_chapter_sources.clone(),
    });
    state.document.project.chapters = candidate.chapters;
    state.document.project.volumes = candidate.volumes;
    state.document.project.corrections = candidate.corrections;
    state.document.project.revision = revision.checked_add(1).ok_or(ProjectError::TooLarge)?;
    state.edit.rules =
        serde_json::to_value(candidate.rules).map_err(|_| ProjectError::InvalidProject)?;
    state.edit.issues =
        serde_json::to_value(candidate.issues).map_err(|_| ProjectError::InvalidProject)?;
    let prepared = projects::prepare(root, &state)?;
    let tx = db.begin().await.map_err(|_| ProjectError::WriteFailed)?;
    projects::lock(&tx, &row.project_id).await?;
    if let Some(result) = receipts::replay(&tx, command_id, "adopt_split", &hash).await? {
        return Ok(result);
    }
    let current = split_proposal::Entity::find_by_id(proposal_id)
        .one(&tx)
        .await
        .map_err(|_| ProjectError::ReadFailed)?
        .ok_or(ProjectError::NotFound)?;
    if current.status != "pending"
        || current.version != row.version
        || current.content != row.content
        || current.source_hashes != row.source_hashes
    {
        return Err(ProjectError::Conflict);
    }
    projects::write(&tx, &prepared, Some(revision)).await?;
    let mut active = current.into_active_model();
    active.status = Set("adopted".into());
    active
        .update(&tx)
        .await
        .map_err(|_| ProjectError::WriteFailed)?;
    let result = CommandResult {
        version: 1,
        project_id: row.project_id,
        revision: state.document.project.revision,
        result_id: Some(row.id),
    };
    receipts::record(&tx, command_id, "adopt_split", &hash, &result).await?;
    tx.commit().await.map_err(|_| ProjectError::WriteFailed)?;
    Ok(result)
}

pub(crate) async fn discard(
    db: &DatabaseConnection,
    proposal_id: &str,
    command_id: &str,
) -> Result<CommandResult, ProjectError> {
    let hash = receipts::fingerprint("discard_split", &proposal_id)?;
    if let Some(result) = receipts::replay(db, command_id, "discard_split", &hash).await? {
        return Ok(result);
    }
    let row = split_proposal::Entity::find_by_id(proposal_id)
        .one(db)
        .await
        .map_err(|_| ProjectError::ReadFailed)?
        .ok_or(ProjectError::NotFound)?;
    let tx = db.begin().await.map_err(|_| ProjectError::WriteFailed)?;
    projects::lock(&tx, &row.project_id).await?;
    if let Some(result) = receipts::replay(&tx, command_id, "discard_split", &hash).await? {
        return Ok(result);
    }
    let current = split_proposal::Entity::find_by_id(proposal_id)
        .one(&tx)
        .await
        .map_err(|_| ProjectError::ReadFailed)?
        .ok_or(ProjectError::NotFound)?;
    if current.version != 1 {
        return Err(ProjectError::UnsupportedVersion);
    }
    if current.status == "adopted" {
        return Err(ProjectError::Conflict);
    }
    if !matches!(current.status.as_str(), "pending" | "discarded") {
        return Err(ProjectError::InvalidProject);
    }
    let mut active = current.into_active_model();
    active.status = Set("discarded".into());
    active
        .update(&tx)
        .await
        .map_err(|_| ProjectError::WriteFailed)?;
    let (revision, _) = stamp(&tx, &row.project_id).await?;
    let result = CommandResult {
        version: 1,
        project_id: row.project_id,
        revision,
        result_id: Some(row.id),
    };
    receipts::record(&tx, command_id, "discard_split", &hash, &result).await?;
    tx.commit().await.map_err(|_| ProjectError::WriteFailed)?;
    Ok(result)
}

#[cfg(test)]
mod tests;
