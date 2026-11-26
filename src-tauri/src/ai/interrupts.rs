//! Interrupt ownership and exactly-once answering, without granting adoption permission.
use super::{
    AiError, StartRun, Trigger,
    runs::{self, Lease},
};
use crate::database::entity::ai_interrupt;
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};
use serde_json::{Value, json};

pub(crate) async fn request(
    tx: &impl ConnectionTrait,
    lease: &Lease,
    tool: &str,
    message: &str,
) -> Result<Value, AiError> {
    if message.trim().is_empty() || message.len() > 8192 {
        return Err(AiError::InvalidRequest);
    }
    let interrupt = serde_json::from_value(json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "reason": "human_input",
        "message": message,
        "toolCallId": tool,
        "responseSchema": {"type": "string"}
    }))
    .map_err(|_| AiError::InvalidRequest)?;
    persist(tx, lease, interrupt).await
}

pub(crate) async fn persist(
    tx: &impl ConnectionTrait,
    lease: &Lease,
    mut interrupt: ag_ui::Interrupt,
) -> Result<Value, AiError> {
    runs::lock(tx, lease, false).await?;
    interrupt.subagent_run_id = lease.invocation().map(Into::into);
    let id = interrupt.id.clone();
    let value = serde_json::to_value(interrupt).map_err(|_| AiError::StorageFailed)?;
    ai_interrupt::ActiveModel {
        id: Set(id),
        session_id: Set(lease.session_id().into()),
        run_id: Set(lease.run_id().into()),
        invocation_id: Set(lease.invocation().map(str::to_owned)),
        request: Set(value.clone()),
        consumed_by: Set(None),
        response: Set(None),
    }
    .insert(tx)
    .await?;
    Ok(value)
}

pub(crate) async fn pending(
    db: &impl ConnectionTrait,
    session: &str,
) -> Result<Vec<ai_interrupt::Model>, AiError> {
    Ok(ai_interrupt::Entity::find()
        .filter(ai_interrupt::Column::SessionId.eq(session))
        .filter(ai_interrupt::Column::ConsumedBy.is_null())
        .all(db)
        .await?)
}

pub(super) async fn match_answers<'a>(
    tx: &impl ConnectionTrait,
    request: &'a StartRun,
) -> Result<Vec<(ai_interrupt::Model, &'a ag_ui::ResumeEntry)>, AiError> {
    let pending = pending(tx, &request.session_id).await?;
    if pending.is_empty() && request.resume.is_empty() {
        return Ok(Vec::new());
    }
    if pending.len() != request.resume.len() {
        return Err(AiError::Conflict);
    }
    let Trigger::Continue { run_id, .. } = &request.trigger else {
        return Err(AiError::Conflict);
    };
    let mut answerable: std::collections::HashMap<_, _> = pending
        .into_iter()
        .filter(|row| row.run_id == *run_id)
        .map(|row| (row.id.clone(), row))
        .collect();
    request
        .resume
        .iter()
        .map(|answer| {
            answerable
                .remove(&answer.interrupt_id)
                .map(|row| (row, answer))
                .ok_or(AiError::Conflict)
        })
        .collect()
}

pub(super) async fn consume(
    tx: &impl ConnectionTrait,
    interrupt_id: &str,
    request_id: &str,
    response: Value,
) -> Result<(), AiError> {
    let changed = ai_interrupt::Entity::update_many()
        .col_expr(
            ai_interrupt::Column::ConsumedBy,
            sea_orm::sea_query::Expr::value(request_id),
        )
        .col_expr(
            ai_interrupt::Column::Response,
            sea_orm::sea_query::Expr::value(response),
        )
        .filter(ai_interrupt::Column::Id.eq(interrupt_id))
        .filter(ai_interrupt::Column::ConsumedBy.is_null())
        .exec(tx)
        .await?;
    if changed.rows_affected != 1 {
        return Err(AiError::Conflict);
    }
    Ok(())
}

/// A failed/cancelled run leaves no answerable gate or suspended producer behind.
pub(crate) async fn close(tx: &impl ConnectionTrait, run: &str) -> Result<(), AiError> {
    let rows = ai_interrupt::Entity::find()
        .filter(ai_interrupt::Column::RunId.eq(run))
        .filter(ai_interrupt::Column::ConsumedBy.is_null())
        .all(tx)
        .await?;
    for row in rows {
        ai_interrupt::Entity::update_many()
            .col_expr(
                ai_interrupt::Column::ConsumedBy,
                sea_orm::sea_query::Expr::value(run),
            )
            .col_expr(
                ai_interrupt::Column::Response,
                sea_orm::sea_query::Expr::value(json!({"interruptId":row.id,"status":"cancelled"})),
            )
            .filter(ai_interrupt::Column::Id.eq(row.id))
            .filter(ai_interrupt::Column::ConsumedBy.is_null())
            .exec(tx)
            .await?;
    }
    Ok(())
}

/// Reserve resumed producers in the same acceptance transaction after the new run exists.
pub(crate) async fn transfer(tx: &impl ConnectionTrait, request: &StartRun) -> Result<(), AiError> {
    let answers = ai_interrupt::Entity::find()
        .filter(ai_interrupt::Column::ConsumedBy.eq(&request.request_id))
        .all(tx)
        .await?;
    for answer in answers {
        if let Some(id) = answer.invocation_id {
            use crate::database::entity::ai_invocation;
            ai_invocation::Entity::update_many()
                .col_expr(
                    ai_invocation::Column::RunId,
                    sea_orm::sea_query::Expr::value(&request.request_id),
                )
                .col_expr(
                    ai_invocation::Column::Status,
                    sea_orm::sea_query::Expr::value("queued"),
                )
                .filter(ai_invocation::Column::Id.eq(id))
                .filter(ai_invocation::Column::Status.eq("suspended"))
                .exec(tx)
                .await?;
        }
    }
    Ok(())
}
