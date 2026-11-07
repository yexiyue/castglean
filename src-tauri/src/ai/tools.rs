//! Tool facts are message parts. Business tools may complete them in their own transaction.
use super::{
    AiError,
    budget::Charge,
    messages::{MessagePart, MessageParts, ResultReference, ToolState},
    runs::{self, Lease, MessageState},
};
use crate::database::entity::ai_message;
use sea_orm::{ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, QuerySelect};
use serde_json::Value;

async fn message(
    tx: &DatabaseTransaction,
    lease: &Lease,
    message_id: &str,
) -> Result<Option<ai_message::Model>, AiError> {
    runs::lock(tx, lease, false).await?;
    let row = ai_message::Entity::find_by_id(message_id).one(tx).await?;
    if row.as_ref().is_some_and(|m| {
        m.session_id != lease.session_id()
            || m.run_id.as_deref() != Some(lease.run_id())
            || m.role != "assistant"
    }) {
        return Err(AiError::Conflict);
    }
    Ok(row)
}

pub(crate) async fn fact(
    tx: &DatabaseTransaction,
    lease: &Lease,
    message_id: &str,
    call_id: &str,
) -> Result<Option<MessagePart>, AiError> {
    Ok(message(tx, lease, message_id).await?.and_then(|m| {
        m.parts
            .parts()
            .iter()
            .find(|part| matches!(part, MessagePart::Tool { id, .. } if id == call_id))
            .cloned()
    }))
}

/// Reserve the attempt before dispatch, even if argument/tool validation will fail.
/// False means this identity was already accepted and must not run another tool.
pub(crate) async fn begin(
    tx: &DatabaseTransaction,
    lease: &Lease,
    message_id: &str,
    call_id: &str,
    name: &str,
    input: Value,
) -> Result<bool, AiError> {
    let row = message(tx, lease, message_id).await?;
    let mut parts = row
        .as_ref()
        .map_or_else(Vec::new, |m| m.parts.parts().to_vec());
    if let Some(MessagePart::Tool {
        name: old_name,
        input: old_input,
        ..
    }) = parts
        .iter()
        .find(|part| matches!(part, MessagePart::Tool { id, .. } if id == call_id))
    {
        return if old_name == name && *old_input == input {
            Ok(false)
        } else {
            Err(AiError::Conflict)
        };
    }
    // Provider IDs can repeat in later completions. A second message must not
    // introduce the same persisted identity into the model history.
    let history = ai_message::Entity::find()
        .filter(ai_message::Column::SessionId.eq(lease.session_id()))
        .filter(ai_message::Column::Id.ne(message_id))
        .limit(257)
        .all(tx)
        .await?;
    if history.len() > 256 {
        return Err(AiError::BudgetExhausted);
    }
    if history.iter().any(|m| {
        m.parts
            .parts()
            .iter()
            .any(|p| matches!(p, MessagePart::Tool { id, .. } if id == call_id))
    }) {
        return Err(AiError::Conflict);
    }
    parts.push(MessagePart::Tool {
        id: call_id.into(),
        name: name.into(),
        input,
        state: ToolState::Running,
        output: None,
        result: None,
    });
    let parts = MessageParts::new(parts).map_err(|_| AiError::InvalidRequest)?;
    runs::charge(tx, lease, Charge::ToolAttempt).await?;
    let version = row
        .map(|m| m.version.try_into().map_err(|_| AiError::StorageFailed))
        .transpose()?;
    runs::message(
        tx,
        lease,
        message_id,
        version,
        parts,
        MessageState::Streaming,
    )
    .await?;
    Ok(true)
}

/// Complete the fact and its byte accounting exactly once. The caller commits
/// any referenced business result in this same transaction before publishing.
pub(crate) async fn complete(
    tx: &DatabaseTransaction,
    lease: &Lease,
    message_id: &str,
    call_id: &str,
    output: Value,
    failed: bool,
    result: Option<ResultReference>,
) -> Result<bool, AiError> {
    let row = message(tx, lease, message_id)
        .await?
        .ok_or(AiError::NotFound)?;
    let mut parts = row.parts.parts().to_vec();
    let part = parts
        .iter_mut()
        .find(|part| matches!(part, MessagePart::Tool { id, .. } if id == call_id))
        .ok_or(AiError::NotFound)?;
    let MessagePart::Tool {
        state,
        output: saved_output,
        result: saved_result,
        ..
    } = part
    else {
        return Err(AiError::StorageFailed);
    };
    let target = if failed {
        ToolState::Failed
    } else {
        ToolState::Completed
    };
    if *state == target
        && saved_output.as_ref() == Some(&output)
        && (result.is_none() || *saved_result == result)
    {
        return Ok(false);
    }
    if *state != ToolState::Running {
        return Err(AiError::Conflict);
    }
    *state = target;
    *saved_output = Some(output.clone());
    *saved_result = result;
    let parts = MessageParts::new(parts).map_err(|_| AiError::InvalidRequest)?;
    let bytes = serde_json::to_vec(&output)
        .map_err(|_| AiError::InvalidRequest)?
        .len()
        .try_into()
        .map_err(|_| AiError::BudgetExhausted)?;
    runs::charge(tx, lease, Charge::ToolOutput { bytes }).await?;
    runs::message(
        tx,
        lease,
        message_id,
        Some(row.version.try_into().map_err(|_| AiError::StorageFailed)?),
        parts,
        MessageState::Streaming,
    )
    .await?;
    Ok(true)
}
