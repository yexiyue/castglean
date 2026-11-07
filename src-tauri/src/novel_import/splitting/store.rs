//! Candidate/tool atomic publication and explicit human decisions.
use super::*;
use crate::{
    ai::{
        self,
        messages::{MessagePart, ResultReference, ToolState},
        runs::Lease,
    },
    database::entity::{ai_session, project, source, split_proposal},
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

#[derive(Debug, Serialize, specta::Type, thiserror::Error)]
#[serde(tag = "domain", content = "error", rename_all = "snake_case")]
pub(crate) enum SplitError {
    #[error("{0}")]
    Project(#[from] ProjectError),
    #[error("{0}")]
    Ai(#[from] ai::AiError),
}
impl From<sea_orm::DbErr> for SplitError {
    fn from(error: sea_orm::DbErr) -> Self {
        Self::Ai(error.into())
    }
}

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
) -> Result<(u32, BTreeMap<String, String>), SplitError> {
    let p = project::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or(ProjectError::NotFound)?;
    let revision = p
        .revision
        .try_into()
        .map_err(|_| ProjectError::InvalidProject)?;
    let hashes = source::Entity::find()
        .filter(source::Column::ProjectId.eq(id))
        .all(db)
        .await?
        .into_iter()
        .map(|s| (s.id, s.text_sha256))
        .collect();
    Ok((revision, hashes))
}

fn content(row: &split_proposal::Model) -> Result<ProposalContent, SplitError> {
    if row.version != 1 {
        return Err(ProjectError::UnsupportedVersion.into());
    }
    serde_json::from_value(row.content.clone()).map_err(|_| ProjectError::InvalidProject.into())
}

pub(crate) async fn query(db: &DatabaseConnection, id: &str) -> Result<ProposalInfo, SplitError> {
    let tx = db.begin().await?;
    let row = split_proposal::Entity::find_by_id(id)
        .one(&tx)
        .await?
        .ok_or(ProjectError::NotFound)?;
    let content = content(&row)?;
    let (revision, hashes) = stamp(&tx, &row.project_id).await?;
    let expected: BTreeMap<String, String> =
        serde_json::from_value(row.source_hashes).map_err(|_| ProjectError::InvalidProject)?;
    let status: ProposalStatus = serde_json::from_value(Value::String(row.status))
        .map_err(|_| ProjectError::InvalidProject)?;
    tx.commit().await?;
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

/// The prepared proposal is computed outside the transaction. A completed tool
/// part only becomes visible if its candidate insert commits in this transaction.
pub(crate) async fn publish(
    db: &DatabaseConnection,
    lease: &Lease,
    message_id: &str,
    call_id: &str,
    proposed: PreparedProposal,
) -> Result<Value, SplitError> {
    let candidate_json =
        serde_json::to_value(&proposed.content).map_err(|_| ProjectError::InvalidProject)?;
    let hashes_json =
        serde_json::to_value(&proposed.hashes).map_err(|_| ProjectError::InvalidProject)?;
    let id = uuid::Uuid::new_v4().to_string();
    let output = json!({"proposal_id":id,"chapters":proposed.content.chapters.len(),"added_count":proposed.content.added_lines.len(),"removed_count":proposed.content.removed_lines.len(),
        "added":proposed.content.added_lines.iter().take(20).collect::<Vec<_>>(),"removed":proposed.content.removed_lines.iter().take(20).collect::<Vec<_>>()});
    let tx = db.begin().await?;
    let run = ai::runs::lock(&tx, lease, false).await?;
    let session = ai_session::Entity::find_by_id(lease.session_id())
        .one(&tx)
        .await?
        .ok_or(ProjectError::NotFound)?;
    if session.task_kind != "chapter_splitting"
        || session.project_id != proposed.project_id
        || run.base_revision as u32 != proposed.revision
        || run.source_hashes != hashes_json
    {
        return Err(ProjectError::Conflict.into());
    }
    let fact = ai::tools::fact(&tx, lease, message_id, call_id)
        .await?
        .ok_or(ai::AiError::NotFound)?;
    let MessagePart::Tool {
        name,
        input,
        state,
        result,
        output: saved_output,
        ..
    } = fact
    else {
        return Err(ai::AiError::Conflict.into());
    };
    if name != proposed.tool_name || input != proposed.input {
        return Err(ai::AiError::Conflict.into());
    }
    if state == ToolState::Completed {
        let result = result.ok_or(ai::AiError::Conflict)?;
        if result.kind != "chapter_split_proposal" {
            return Err(ai::AiError::Conflict.into());
        }
        let old = split_proposal::Entity::find_by_id(&result.id)
            .one(&tx)
            .await?
            .ok_or(ai::AiError::StorageFailed)?;
        if old.run_id != lease.run_id()
            || old.project_id != proposed.project_id
            || old.version != 1
            || old.base_revision as u32 != proposed.revision
            || old.source_hashes != hashes_json
        {
            return Err(ai::AiError::Conflict.into());
        }
        return saved_output.ok_or_else(|| ai::AiError::StorageFailed.into());
    }
    if state != ToolState::Running {
        return Err(ai::AiError::Conflict.into());
    }
    if stamp(&tx, &proposed.project_id).await? != (proposed.revision, proposed.hashes.clone()) {
        return Err(ProjectError::Conflict.into());
    }
    if split_proposal::Entity::find()
        .filter(split_proposal::Column::RunId.eq(lease.run_id()))
        .count(&tx)
        .await?
        >= 16
    {
        return Err(ProjectError::TooLarge.into());
    }
    split_proposal::ActiveModel {
        id: Set(id.clone()),
        project_id: Set(proposed.project_id),
        run_id: Set(lease.run_id().into()),
        base_revision: Set(proposed
            .revision
            .try_into()
            .map_err(|_| ProjectError::TooLarge)?),
        source_hashes: Set(hashes_json),
        version: Set(1),
        content: Set(candidate_json),
        status: Set("pending".into()),
    }
    .insert(&tx)
    .await?;
    ai::tools::complete(
        &tx,
        lease,
        message_id,
        call_id,
        output.clone(),
        false,
        Some(ResultReference {
            kind: "chapter_split_proposal".into(),
            id: id.clone(),
            summary: "分章方案等待人工审阅".into(),
        }),
    )
    .await?;
    super::graph::tool_committed(&tx, lease, message_id, call_id).await?;
    ai::runs::commit(tx, lease).await?;
    Ok(output)
}

pub(crate) async fn adopt(
    db: &DatabaseConnection,
    root: &Path,
    proposal_id: &str,
    command_id: &str,
) -> Result<CommandResult, SplitError> {
    let hash = receipts::fingerprint("adopt_split", &proposal_id)?;
    if let Some(result) = receipts::replay(db, command_id, "adopt_split", &hash).await? {
        return Ok(result);
    }
    let row = split_proposal::Entity::find_by_id(proposal_id)
        .one(db)
        .await?
        .ok_or(ProjectError::NotFound)?;
    let candidate = content(&row)?;
    let mut state = projects::read(db, root, &row.project_id).await?;
    if row.status != "pending"
        || row.base_revision as u32 != state.document.project.revision
        || row.source_hashes
            != serde_json::to_value(hashes(&state)).map_err(|_| ProjectError::InvalidProject)?
    {
        return Err(ProjectError::Conflict.into());
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
    let tx = db.begin().await?;
    projects::lock(&tx, &row.project_id).await?;
    if let Some(result) = receipts::replay(&tx, command_id, "adopt_split", &hash).await? {
        return Ok(result);
    }
    let current = split_proposal::Entity::find_by_id(proposal_id)
        .one(&tx)
        .await?
        .ok_or(ProjectError::NotFound)?;
    if current.status != "pending"
        || current.version != row.version
        || current.content != row.content
        || current.source_hashes != row.source_hashes
    {
        return Err(ProjectError::Conflict.into());
    }
    projects::write(&tx, &prepared, Some(revision)).await?;
    let mut active = current.into_active_model();
    active.status = Set("adopted".into());
    active.update(&tx).await?;
    let result = CommandResult {
        version: 1,
        project_id: row.project_id,
        revision: state.document.project.revision,
        result_id: Some(row.id),
    };
    receipts::record(&tx, command_id, "adopt_split", &hash, &result).await?;
    tx.commit().await?;
    Ok(result)
}

pub(crate) async fn discard(
    db: &DatabaseConnection,
    proposal_id: &str,
    command_id: &str,
) -> Result<CommandResult, SplitError> {
    let hash = receipts::fingerprint("discard_split", &proposal_id)?;
    if let Some(result) = receipts::replay(db, command_id, "discard_split", &hash).await? {
        return Ok(result);
    }
    let row = split_proposal::Entity::find_by_id(proposal_id)
        .one(db)
        .await?
        .ok_or(ProjectError::NotFound)?;
    let tx = db.begin().await?;
    projects::lock(&tx, &row.project_id).await?;
    if let Some(result) = receipts::replay(&tx, command_id, "discard_split", &hash).await? {
        return Ok(result);
    }
    let current = split_proposal::Entity::find_by_id(proposal_id)
        .one(&tx)
        .await?
        .ok_or(ProjectError::NotFound)?;
    if current.version != 1 {
        return Err(ProjectError::UnsupportedVersion.into());
    }
    if current.status == "adopted" {
        return Err(ProjectError::Conflict.into());
    }
    if !matches!(current.status.as_str(), "pending" | "discarded") {
        return Err(ProjectError::InvalidProject.into());
    }
    let mut active = current.into_active_model();
    active.status = Set("discarded".into());
    active.update(&tx).await?;
    let (revision, _) = stamp(&tx, &row.project_id).await?;
    let result = CommandResult {
        version: 1,
        project_id: row.project_id,
        revision,
        result_id: Some(row.id),
    };
    receipts::record(&tx, command_id, "discard_split", &hash, &result).await?;
    tx.commit().await?;
    Ok(result)
}

#[cfg(test)]
mod tests;
