//! Leased execution writes. All mutations verify run ownership in the same transaction.
use super::{
    budget::{Charge, Ledger},
    types::{decode, encode},
    *,
};
use crate::database::entity::{ai_message, ai_run, ai_session};
use sea_orm::sea_query::{Expr, ExprTrait};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction,
    EntityTrait, IntoActiveModel, QueryFilter, QueryOrder, Set, TransactionTrait,
};

#[derive(Debug, Clone)]
pub(crate) struct Lease {
    run_id: String,
    session_id: String,
    owner: String,
    generation: i64,
    stream: Option<std::sync::Arc<super::stream::Hub>>,
}
impl Lease {
    pub(crate) fn with_stream(mut self, stream: std::sync::Arc<super::stream::Hub>) -> Self {
        self.stream = Some(stream);
        self
    }

    async fn published(&self) {
        if let Some(stream) = &self.stream {
            let _ = stream.publish(&self.session_id).await;
        }
    }
    pub(crate) async fn notify_committed(&self) {
        self.published().await;
    }
    pub(crate) fn run_id(&self) -> &str {
        &self.run_id
    }
    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }
}

pub(crate) async fn claim(
    db: &DatabaseConnection,
    run_id: &str,
    owner: &str,
) -> Result<Option<Lease>, AiError> {
    if uuid::Uuid::parse_str(owner).is_err() {
        return Err(AiError::InvalidRequest);
    }
    let tx = db.begin().await?;
    let changed = ai_run::Entity::update_many()
        .col_expr(ai_run::Column::Status, Expr::value("running"))
        .col_expr(ai_run::Column::OwnerInstance, Expr::value(owner))
        .col_expr(
            ai_run::Column::Generation,
            Expr::col(ai_run::Column::Generation).add(1),
        )
        .filter(ai_run::Column::Id.eq(run_id))
        .filter(ai_run::Column::Status.eq("queued"))
        .filter(ai_run::Column::CancelRequested.eq(false))
        .filter(ai_run::Column::Generation.lt(i64::MAX))
        .exec(&tx)
        .await?;
    if changed.rows_affected == 0 {
        return Ok(None);
    }
    let row = ai_run::Entity::find_by_id(run_id)
        .one(&tx)
        .await?
        .ok_or(AiError::NotFound)?;
    bump(&tx, &row.session_id).await?;
    tx.commit().await?;
    Ok(Some(Lease {
        run_id: row.id,
        session_id: row.session_id,
        owner: owner.into(),
        generation: row.generation,
        stream: None,
    }))
}

/// A no-op conditional write gets SQLite's writer slot before loading state.
/// Callers may then combine budget, tool facts, checkpoints and business results.
pub(crate) async fn lock(
    tx: &impl ConnectionTrait,
    lease: &Lease,
    allow_cancelling: bool,
) -> Result<ai_run::Model, AiError> {
    let mut update = ai_run::Entity::update_many()
        .col_expr(
            ai_run::Column::Generation,
            Expr::col(ai_run::Column::Generation),
        )
        .filter(ai_run::Column::Id.eq(&lease.run_id))
        .filter(ai_run::Column::SessionId.eq(&lease.session_id))
        .filter(ai_run::Column::OwnerInstance.eq(&lease.owner))
        .filter(ai_run::Column::Generation.eq(lease.generation));
    if allow_cancelling {
        update = update.filter(ai_run::Column::Status.is_in(["running", "cancelling"]));
    } else {
        update = update
            .filter(ai_run::Column::Status.eq("running"))
            .filter(ai_run::Column::CancelRequested.eq(false));
    }
    if update.exec(tx).await?.rows_affected != 1 {
        return Err(AiError::Conflict);
    }
    ai_run::Entity::find_by_id(&lease.run_id)
        .one(tx)
        .await?
        .ok_or(AiError::NotFound)
}

pub(crate) async fn bump(tx: &impl ConnectionTrait, session: &str) -> Result<(), AiError> {
    let changed = ai_session::Entity::update_many()
        .col_expr(
            ai_session::Column::NextSequence,
            Expr::col(ai_session::Column::NextSequence).add(1),
        )
        .col_expr(
            ai_session::Column::UpdatedAt,
            Expr::value(crate::timestamp::unix_seconds()),
        )
        .filter(ai_session::Column::Id.eq(session))
        .filter(ai_session::Column::NextSequence.lt(i64::from(u32::MAX)))
        .exec(tx)
        .await?;
    if changed.rows_affected != 1 {
        return Err(AiError::StorageFailed);
    }
    Ok(())
}

pub(crate) async fn charge(
    tx: &impl ConnectionTrait,
    lease: &Lease,
    charge: Charge,
) -> Result<Budget, AiError> {
    let row = lock(tx, lease, false).await?;
    let mut ledger: Ledger = decode(row.budget)?;
    let session = ai_session::Entity::find_by_id(&lease.session_id)
        .one(tx)
        .await?
        .ok_or(AiError::NotFound)?;
    if decode::<Budget>(session.budget)? != ledger.total()? {
        return Err(AiError::Conflict);
    }
    let total = ledger.charge(charge)?;
    ai_run::Entity::update_many()
        .col_expr(ai_run::Column::Budget, Expr::value(encode(&ledger)?))
        .filter(ai_run::Column::Id.eq(&lease.run_id))
        .exec(tx)
        .await?;
    ai_session::Entity::update_many()
        .col_expr(ai_session::Column::Budget, Expr::value(encode(&total)?))
        .filter(ai_session::Column::Id.eq(&lease.session_id))
        .exec(tx)
        .await?;
    Ok(total)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum MessageState {
    Streaming,
    Complete,
}
impl MessageState {
    fn name(self) -> &'static str {
        match self {
            Self::Streaming => "streaming",
            Self::Complete => "complete",
        }
    }
}

/// `expected_version: None` inserts a server-owned assistant message. Updating an
/// existing message requires its exact version and the same leased run.
pub(crate) async fn message(
    tx: &impl ConnectionTrait,
    lease: &Lease,
    id: &str,
    expected_version: Option<u32>,
    parts: messages::MessageParts,
    state: MessageState,
) -> Result<(), AiError> {
    lock(tx, lease, false).await?;
    if id.is_empty() || id.len() > 128 {
        return Err(AiError::InvalidRequest);
    }
    if state == MessageState::Complete
        && parts.parts().iter().any(|part| {
            matches!(
                part,
                messages::MessagePart::Tool {
                    state: messages::ToolState::Running | messages::ToolState::Interrupted,
                    ..
                }
            )
        })
    {
        return Err(AiError::InvalidRequest);
    }
    let existing = ai_message::Entity::find_by_id(id).one(tx).await?;
    if let Some(existing) = existing {
        if existing.session_id != lease.session_id
            || existing.run_id.as_deref() != Some(&lease.run_id)
            || existing.role != "assistant"
            || Some(existing.version as u32) != expected_version
            || existing.version < 1
            || existing.status != "streaming"
        {
            return Err(AiError::Conflict);
        }
        let mut update = existing.into_active_model();
        let next = expected_version
            .ok_or(AiError::Conflict)?
            .checked_add(1)
            .and_then(|v| i32::try_from(v).ok())
            .ok_or(AiError::StorageFailed)?;
        update.parts = Set(parts);
        update.version = Set(next);
        update.status = Set(state.name().into());
        update.update(tx).await?;
    } else {
        if expected_version.is_some() {
            return Err(AiError::Conflict);
        }
        let last = ai_message::Entity::find()
            .filter(ai_message::Column::SessionId.eq(&lease.session_id))
            .order_by_desc(ai_message::Column::Ordinal)
            .one(tx)
            .await?;
        let ordinal = last.map_or(Ok(0), |m| {
            m.ordinal.checked_add(1).ok_or(AiError::StorageFailed)
        })?;
        ai_message::ActiveModel {
            id: Set(id.into()),
            session_id: Set(lease.session_id.clone()),
            run_id: Set(Some(lease.run_id.clone())),
            ordinal: Set(ordinal),
            role: Set("assistant".into()),
            version: Set(1),
            parts: Set(parts),
            status: Set(state.name().into()),
            usage: Set(None),
            created_at: Set(crate::timestamp::unix_seconds()),
        }
        .insert(tx)
        .await?;
    }
    Ok(())
}

pub(crate) async fn checkpoint(
    tx: &impl ConnectionTrait,
    lease: &Lease,
    checkpoint: serde_json::Value,
) -> Result<(), AiError> {
    lock(tx, lease, false).await?;
    ai_run::Entity::update_many()
        .col_expr(ai_run::Column::Checkpoint, Expr::value(checkpoint))
        .filter(ai_run::Column::Id.eq(&lease.run_id))
        .exec(tx)
        .await?;
    Ok(())
}

/// Publish one cursor for the entire use-case transaction, regardless of how
/// many message, budget, tool and candidate rows it changed.
pub(crate) async fn commit(tx: DatabaseTransaction, lease: &Lease) -> Result<(), AiError> {
    lock(&tx, lease, false).await?;
    bump(&tx, &lease.session_id).await?;
    tx.commit().await?;
    lease.published().await;
    Ok(())
}

pub(crate) async fn finish(
    db: &DatabaseConnection,
    lease: &Lease,
    status: RunStatus,
    error: Option<RunFailure>,
) -> Result<RunInfo, AiError> {
    if !matches!(
        status,
        RunStatus::WaitingForInput
            | RunStatus::Succeeded
            | RunStatus::Failed
            | RunStatus::Cancelled
    ) {
        return Err(AiError::InvalidRequest);
    }
    let tx = db.begin().await?;
    let row = lock(&tx, lease, true).await?;
    let cancelled = row.cancel_requested;
    let mut active = row.into_active_model();
    let (status, error) = if cancelled {
        (RunStatus::Cancelled, Some(RunFailure::Cancelled))
    } else {
        (status, error)
    };
    let status = encode(&status)?
        .as_str()
        .ok_or(AiError::InvalidRequest)?
        .to_owned();
    active.status = Set(status);
    active.error = Set(error
        .map(|e| {
            encode(&e).and_then(|v| v.as_str().map(str::to_owned).ok_or(AiError::InvalidRequest))
        })
        .transpose()?);
    active.finished_at = Set(Some(crate::timestamp::unix_seconds()));
    let saved = active.update(&tx).await?;
    interrupt_messages(&tx, &lease.run_id).await?;
    bump(&tx, &lease.session_id).await?;
    tx.commit().await?;
    lease.published().await;
    super::history::run_info(saved)
}

pub(crate) async fn cancel(db: &DatabaseConnection, run_id: &str) -> Result<RunInfo, AiError> {
    let tx = db.begin().await?;
    // Serialize against claim and finish before loading the current status.
    let changed = ai_run::Entity::update_many()
        .col_expr(
            ai_run::Column::Generation,
            Expr::col(ai_run::Column::Generation),
        )
        .filter(ai_run::Column::Id.eq(run_id))
        .exec(&tx)
        .await?;
    if changed.rows_affected != 1 {
        return Err(AiError::NotFound);
    }
    let row = ai_run::Entity::find_by_id(run_id)
        .one(&tx)
        .await?
        .ok_or(AiError::NotFound)?;
    if !matches!(row.status.as_str(), "queued" | "running") {
        return super::history::run_info(row);
    }
    let session_id = row.session_id.clone();
    let queued = row.status == "queued";
    let mut active = row.into_active_model();
    active.cancel_requested = Set(true);
    active.status = Set(if queued { "cancelled" } else { "cancelling" }.into());
    if queued {
        active.finished_at = Set(Some(crate::timestamp::unix_seconds()));
    }
    let saved = active.update(&tx).await?;
    bump(&tx, &session_id).await?;
    tx.commit().await?;
    super::history::run_info(saved)
}

async fn interrupt_messages(tx: &impl ConnectionTrait, run_id: &str) -> Result<(), AiError> {
    let rows = ai_message::Entity::find()
        .filter(ai_message::Column::RunId.eq(run_id))
        .filter(ai_message::Column::Status.eq("streaming"))
        .all(tx)
        .await?;
    for row in rows {
        let parts = row
            .parts
            .parts()
            .iter()
            .cloned()
            .map(|mut part| {
                if let messages::MessagePart::Tool { state, result, .. } = &mut part
                    && *state == messages::ToolState::Running
                {
                    *state = messages::ToolState::Interrupted;
                    *result = None;
                }
                part
            })
            .collect();
        let version = row.version.checked_add(1).ok_or(AiError::StorageFailed)?;
        let mut active = row.into_active_model();
        active.parts = Set(messages::MessageParts::new(parts).map_err(|_| AiError::StorageFailed)?);
        active.status = Set("interrupted".into());
        active.version = Set(version);
        active.update(tx).await?;
    }
    Ok(())
}

pub(crate) async fn interrupt_previous(
    db: &DatabaseConnection,
    current_owner: &str,
) -> Result<(), AiError> {
    if uuid::Uuid::parse_str(current_owner).is_err() {
        return Err(AiError::InvalidRequest);
    }
    let tx = db.begin().await?;
    // A writer lock precedes the read to fence every old owner atomically.
    ai_run::Entity::update_many()
        .col_expr(
            ai_run::Column::Generation,
            Expr::col(ai_run::Column::Generation),
        )
        .filter(ai_run::Column::Status.is_in(["running", "cancelling"]))
        .exec(&tx)
        .await?;
    let rows = ai_run::Entity::find()
        .filter(ai_run::Column::Status.is_in(["running", "cancelling"]))
        .all(&tx)
        .await?;
    for row in rows {
        if row.owner_instance.as_deref() == Some(current_owner) {
            continue;
        }
        let run_id = row.id.clone();
        let session_id = row.session_id.clone();
        let mut active = row.into_active_model();
        active.status = Set("interrupted".into());
        active.error = Set(Some("interrupted".into()));
        active.finished_at = Set(Some(crate::timestamp::unix_seconds()));
        active.update(&tx).await?;
        interrupt_messages(&tx, &run_id).await?;
        bump(&tx, &session_id).await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests;
