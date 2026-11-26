//! Split diagnosis phases and their durable boundary.
pub(crate) mod publication;
use crate::{
    ai::{self, AiError, RunFailure, runs::Lease},
    database::entity::{ai_run, ai_session, project},
};
use sea_orm::{DatabaseConnection, DatabaseTransaction, EntityTrait, TransactionTrait};
use serde::{Deserialize, Serialize};
use std::{future::Future, path::Path};

/// Durable, self-contained user intent passed from the conversational agent.
#[derive(serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct SplittingRequest {
    #[schemars(length(min = 1, max = 2048))]
    pub instruction: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    Prepare,
    Diagnose,
    Validate,
    Review,
}

impl Phase {
    fn next(self) -> Option<Self> {
        match self {
            Self::Prepare => Some(Self::Diagnose),
            Self::Diagnose => Some(Self::Validate),
            Self::Validate => Some(Self::Review),
            Self::Review => None,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Checkpoint {
    version: u32,
    phase: Phase,
    last_tool: Option<ToolBoundary>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ToolBoundary {
    message_id: String,
    call_id: String,
}

fn decode(value: serde_json::Value) -> Result<Checkpoint, AiError> {
    let checkpoint: Checkpoint =
        serde_json::from_value(value).map_err(|_| AiError::InvalidRequest)?;
    if checkpoint.version == 0 {
        return Err(AiError::InvalidRequest);
    }
    Ok(checkpoint)
}

async fn write(
    tx: &DatabaseTransaction,
    lease: &Lease,
    checkpoint: Checkpoint,
) -> Result<(), AiError> {
    ai::runs::checkpoint(
        tx,
        lease,
        serde_json::to_value(checkpoint).map_err(|_| AiError::StorageFailed)?,
    )
    .await
}

/// The candidate and this boundary commit together. The next model turn
/// consumes the shared call/result history.
pub(super) async fn tool_committed(
    tx: &DatabaseTransaction,
    lease: &Lease,
    message_id: &str,
    call_id: &str,
) -> Result<(), AiError> {
    let run = ai::runs::lock(tx, lease, false).await?;
    // Direct domain use cases may publish without a phase checkpoint.
    let Some(value) = run.checkpoint else {
        return Ok(());
    };
    let mut checkpoint = decode(value)?;
    if checkpoint.phase != Phase::Diagnose {
        return Err(AiError::Conflict);
    }
    checkpoint.last_tool = Some(ToolBoundary {
        message_id: message_id.into(),
        call_id: call_id.into(),
    });
    write(tx, lease, checkpoint).await
}

async fn advance(
    db: &DatabaseConnection,
    lease: &Lease,
    version: u32,
    phase: Phase,
) -> Result<u32, AiError> {
    let tx = db.begin().await?;
    let run = ai::runs::lock(&tx, lease, false).await?;
    let old = run.checkpoint.map(decode).transpose()?;
    if old.as_ref().map_or(0, |checkpoint| checkpoint.version) != version {
        return Err(AiError::Conflict);
    }
    let version = version.checked_add(1).ok_or(AiError::StorageFailed)?;
    write(
        &tx,
        lease,
        Checkpoint {
            version,
            phase,
            last_tool: old
                .filter(|_| phase != Phase::Prepare)
                .and_then(|checkpoint| checkpoint.last_tool),
        },
    )
    .await?;
    ai::runs::commit(tx, lease).await?;
    Ok(version)
}

async fn verify_scope(db: &DatabaseConnection, lease: &Lease) -> Result<String, AiError> {
    let tx = db.begin().await?;
    let run = ai::runs::lock(&tx, lease, false).await?;
    let session = ai_session::Entity::find_by_id(lease.session_id())
        .one(&tx)
        .await?
        .ok_or(AiError::NotFound)?;
    let project = project::Entity::find_by_id(session.project_id.clone())
        .one(&tx)
        .await?
        .ok_or(AiError::NotFound)?;
    let hashes = crate::project::source_hashes(&tx, &session.project_id).await?;
    if !matches!(
        session.task_kind.as_str(),
        "chapter_splitting" | "project_assistant"
    ) || project.revision != run.base_revision
        || serde_json::to_value(hashes).map_err(|_| AiError::StorageFailed)? != run.source_hashes
    {
        return Err(AiError::Conflict);
    }
    tx.commit().await?;
    Ok(session.project_id)
}

fn scope_failure(error: AiError) -> RunFailure {
    match error {
        AiError::Conflict => RunFailure::StaleProject,
        _ => RunFailure::StorageFailed,
    }
}

pub(crate) async fn execute<F, Fut>(
    db: &DatabaseConnection,
    root: &Path,
    lease: &Lease,
    diagnose: F,
) -> Result<(), RunFailure>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<(), RunFailure>>,
{
    let project_id = verify_scope(db, lease).await.map_err(scope_failure)?;
    let row = ai_run::Entity::find_by_id(lease.run_id())
        .one(db)
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .ok_or(RunFailure::StorageFailed)?;
    let checkpoint = row
        .checkpoint
        .map(decode)
        .transpose()
        .map_err(|_| RunFailure::InvalidResponse)?;

    // Database digests alone cannot detect damaged files. Verify source files
    // even when resuming at a phase after Prepare.
    let read_db = db.clone();
    let storage_root = root.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(crate::project::store::read(
            &read_db,
            &storage_root,
            &project_id,
        ))
        .map(|_| ())
    })
    .await
    .map_err(|_| RunFailure::StorageFailed)?
    .map_err(|_| RunFailure::StorageFailed)?;

    let committed = checkpoint.as_ref().is_some_and(|checkpoint| {
        checkpoint.phase == Phase::Diagnose && checkpoint.last_tool.is_some()
    });
    let (mut phase, mut version) = match checkpoint {
        Some(checkpoint) if checkpoint.phase != Phase::Review => {
            (checkpoint.phase, checkpoint.version)
        }
        checkpoint => {
            let previous = checkpoint.map_or(0, |checkpoint| checkpoint.version);
            let version = advance(db, lease, previous, Phase::Prepare)
                .await
                .map_err(|_| RunFailure::StorageFailed)?;
            (Phase::Prepare, version)
        }
    };

    loop {
        verify_scope(db, lease).await.map_err(scope_failure)?;
        if phase == Phase::Diagnose && !committed {
            diagnose().await?;
        }
        let Some(next) = phase.next() else {
            return Ok(());
        };
        version = advance(db, lease, version, next)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        phase = next;
    }
}

#[cfg(test)]
mod tests;
