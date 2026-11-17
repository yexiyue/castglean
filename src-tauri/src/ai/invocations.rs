//! Professional invocation ownership and durable lifecycle.
use super::{
    AiError, RunFailure,
    messages::{MessagePart, ToolState},
    runs::{self, Lease},
};
use crate::database::entity::{ai_interrupt, ai_invocation, ai_message};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};

pub(crate) async fn begin(
    db: &DatabaseConnection,
    parent: &Lease,
    name: &str,
) -> Result<Lease, AiError> {
    let tx = db.begin().await?;
    runs::lock(&tx, parent, false).await?;
    let answers = ai_interrupt::Entity::find()
        .filter(ai_interrupt::Column::ConsumedBy.eq(parent.run_id()))
        .all(&tx)
        .await?;
    for answer in answers {
        if let Some(id) = answer.invocation_id
            && let Some(invocation) = ai_invocation::Entity::find_by_id(&id).one(&tx).await?
            && invocation.name == name
            && invocation.status == "queued"
        {
            ai_invocation::Entity::update_many()
                .col_expr(
                    ai_invocation::Column::RunId,
                    sea_orm::sea_query::Expr::value(parent.run_id()),
                )
                .col_expr(
                    ai_invocation::Column::Status,
                    sea_orm::sea_query::Expr::value("running"),
                )
                .filter(ai_invocation::Column::Id.eq(&id))
                .exec(&tx)
                .await?;
            runs::commit(tx, parent).await?;
            return Ok(parent.for_invocation(id));
        }
    }
    let invocations = ai_invocation::Entity::find()
        .filter(ai_invocation::Column::RunId.eq(parent.run_id()))
        .all(&tx)
        .await?;
    let ordinal = invocations.len();
    let id = format!("{}:{ordinal:08}:{name}", parent.run_id());
    let mut messages =
        ai_message::Entity::find().filter(ai_message::Column::RunId.eq(parent.run_id()));
    messages = messages.filter(match parent.invocation() {
        Some(id) => ai_message::Column::SubagentRunId.eq(id),
        None => ai_message::Column::SubagentRunId.is_null(),
    });
    let messages = messages
        .order_by_asc(ai_message::Column::Ordinal)
        .all(&tx)
        .await?;
    let spawning = messages
        .iter()
        .flat_map(|message| {
            message
                .parts
                .parts()
                .iter()
                .map(move |part| (message, part))
        })
        .find_map(|(message, part)| match part {
            MessagePart::Tool { id, name: tool, state, output, .. }
                // Delegation is normally completed atomically before the child
                // starts. Failed calls and facts already claimed by a child
                // must not capture a later same-name delegation.
                if (*state == ToolState::Running
                    || (*state == ToolState::Completed
                        && output.as_ref().is_some_and(|value| value["status"] == "accepted")))
                && !invocations.iter().any(|invocation| {
                    invocation.message_id.as_deref() == Some(message.id.as_str())
                        && invocation.tool_call_id.as_deref() == Some(id.as_str())
                })
                && matches!(
                    (name, tool.as_str()),
                    ("chapter_analysis", "analyze_chapter")
                        | ("chapter_splitting", "check_splitting")
                        | ("casting", "cast_voices")
                ) =>
            {
                Some((message.id.clone(), id.clone()))
            }
            _ => None,
        });
    ai_invocation::ActiveModel {
        id: Set(id.clone()),
        run_id: Set(parent.run_id().into()),
        session_id: Set(parent.session_id().into()),
        name: Set(name.into()),
        parent_id: Set(parent.invocation().map(str::to_owned)),
        message_id: Set(spawning.as_ref().map(|(message, _)| message.clone())),
        tool_call_id: Set(spawning.map(|(_, tool)| tool)),
        status: Set("running".into()),
        error: Set(None),
    }
    .insert(&tx)
    .await?;
    runs::commit(tx, parent).await?;
    Ok(parent.for_invocation(id))
}

pub(crate) async fn finish(
    db: &DatabaseConnection,
    lease: &Lease,
    result: &Result<(), RunFailure>,
) -> Result<(), AiError> {
    let Some(id) = lease.invocation() else {
        return Ok(());
    };
    let tx = db.begin().await?;
    runs::lock(&tx, lease, true).await?;
    let pending = super::interrupts::pending(&tx, lease.session_id()).await?;
    let status = match result {
        Ok(())
            if pending
                .iter()
                .any(|row| row.invocation_id.as_deref() == Some(id)) =>
        {
            "suspended"
        }
        Ok(()) => "succeeded",
        Err(RunFailure::Cancelled) => "cancelled",
        Err(_) => "failed",
    };
    ai_invocation::Entity::update_many()
        .col_expr(
            ai_invocation::Column::Status,
            sea_orm::sea_query::Expr::value(status),
        )
        .col_expr(
            ai_invocation::Column::Error,
            sea_orm::sea_query::Expr::value(
                result.as_ref().err().map(|failure| format!("{failure:?}")),
            ),
        )
        .filter(ai_invocation::Column::Id.eq(id))
        .exec(&tx)
        .await?;
    // Completion may race a cancel request; publishing is allowed while cancelling.
    runs::bump(&tx, lease.session_id()).await?;
    tx.commit().await?;
    lease.notify_committed().await;
    Ok(())
}
