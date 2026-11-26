//! The tool lease, candidate, durable tool result and checkpoint commit together.
use crate::{
    ai::{
        self,
        messages::{MessagePart, ResultReference, ToolState},
        runs::Lease,
    },
    database::entity::ai_session,
    novel_import::splitting::{PreparedProposal, store},
    project::ProjectError,
};
use sea_orm::{DatabaseConnection, EntityTrait, TransactionTrait};
use serde_json::{Value, json};

#[derive(Debug, thiserror::Error)]
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

/// The prepared proposal is computed outside the transaction. A completed tool
/// part only becomes visible if its candidate insert commits in this transaction.
pub(crate) async fn publish(
    db: &DatabaseConnection,
    lease: &Lease,
    message_id: &str,
    call_id: &str,
    proposed: PreparedProposal,
) -> Result<Value, SplitError> {
    let id = uuid::Uuid::new_v4().to_string();
    let output = summarize(&id, &proposed);
    let tx = db.begin().await?;
    let run = ai::runs::lock(&tx, lease, false).await?;
    let session = ai_session::Entity::find_by_id(lease.session_id())
        .one(&tx)
        .await?
        .ok_or(ProjectError::NotFound)?;
    if !matches!(
        session.task_kind.as_str(),
        "chapter_splitting" | "project_assistant"
    ) || !proposed.matches_scope(
        &session.project_id,
        run.base_revision as u32,
        &run.source_hashes,
    )? {
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
    if !proposed.matches_call(&name, &input) {
        return Err(ai::AiError::Conflict.into());
    }
    if state == ToolState::Completed {
        let result = result.ok_or(ai::AiError::Conflict)?;
        if result.kind != "chapter_split_proposal" {
            return Err(ai::AiError::Conflict.into());
        }
        let matches = store::matches_published(
            &tx,
            &result.id,
            lease.run_id(),
            &proposed,
            &run.source_hashes,
        )
        .await?
        .ok_or(ai::AiError::StorageFailed)?;
        if !matches {
            return Err(ai::AiError::Conflict.into());
        }
        return saved_output.ok_or_else(|| ai::AiError::StorageFailed.into());
    }
    if state != ToolState::Running {
        return Err(ai::AiError::Conflict.into());
    }
    store::insert_pending(&tx, &id, lease.run_id(), proposed).await?;
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
            notice: None,
        }),
    )
    .await?;
    super::tool_committed(&tx, lease, message_id, call_id).await?;
    ai::runs::commit(tx, lease).await?;
    Ok(output)
}

fn summarize(id: &str, proposed: &PreparedProposal) -> Value {
    let content = proposed.content();
    json!({
        "proposal_id": id,
        "chapters": content.chapters.len(),
        "added_count": content.added_lines.len(),
        "removed_count": content.removed_lines.len(),
        "added": content.added_lines.iter().take(20).collect::<Vec<_>>(),
        "removed": content.removed_lines.iter().take(20).collect::<Vec<_>>(),
    })
}
