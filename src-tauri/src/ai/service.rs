//! Session use cases own transactions. Accepting a run persists its dispatch intent.
use super::{
    types::{decode, encode},
    *,
};
use crate::database::entity::{ai_message, ai_run, ai_session, chapter, project, source};
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, Set, TransactionTrait,
};
use std::collections::BTreeMap;

fn identity(id: &str) -> Result<(), AiError> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| AiError::InvalidRequest)
}

pub(crate) async fn create(
    db: &DatabaseConnection,
    request: CreateSession,
) -> Result<SessionInfo, AiError> {
    identity(&request.id)?;
    if request.task_kind.is_empty()
        || request.task_kind.len() > 80
        || !request
            .task_kind
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        || request.title.chars().count() > 120
        || request.title.contains('\0')
    {
        return Err(AiError::InvalidRequest);
    }
    let tx = db.begin().await?;
    // A write before reading avoids a stale WAL read snapshot when another host edits.
    if project::Entity::update_many()
        .col_expr(
            project::Column::Revision,
            Expr::col(project::Column::Revision),
        )
        .filter(project::Column::Id.eq(&request.project_id))
        .exec(&tx)
        .await?
        .rows_affected
        != 1
    {
        return Err(AiError::NotFound);
    }
    if let Some(old) = ai_session::Entity::find_by_id(&request.id).one(&tx).await? {
        if old.project_id != request.project_id
            || old.task_kind != request.task_kind
            || old.chapter_id != request.chapter_id
            || old.title != request.title
        {
            return Err(AiError::Conflict);
        }
        return super::history::session_info(old);
    }
    if let Some(id) = &request.chapter_id {
        let c = chapter::Entity::find_by_id(id)
            .one(&tx)
            .await?
            .ok_or(AiError::NotFound)?;
        if c.project_id != request.project_id {
            return Err(AiError::Conflict);
        }
    }
    let now = run_timestamp();
    let saved = ai_session::ActiveModel {
        id: Set(request.id),
        project_id: Set(request.project_id),
        task_kind: Set(request.task_kind),
        chapter_id: Set(request.chapter_id),
        title: Set(request.title),
        configuration: Set(serde_json::Value::Null),
        budget: Set(encode(&Budget::default())?),
        next_sequence: Set(0),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    }
    .insert(&tx)
    .await?;
    tx.commit().await?;
    super::history::session_info(saved)
}

/// Acquire SQLite's writer slot before reading authoritative state. The application
/// transaction, rather than an in-memory mutex, serializes competing send commands.
pub(super) async fn lock_session(
    tx: &impl ConnectionTrait,
    id: &str,
) -> Result<ai_session::Model, AiError> {
    if ai_session::Entity::update_many()
        .col_expr(
            ai_session::Column::NextSequence,
            Expr::col(ai_session::Column::NextSequence),
        )
        .filter(ai_session::Column::Id.eq(id))
        .exec(tx)
        .await?
        .rows_affected
        != 1
    {
        return Err(AiError::NotFound);
    }
    ai_session::Entity::find_by_id(id)
        .one(tx)
        .await?
        .ok_or(AiError::NotFound)
}

pub(super) async fn replay(
    db: &impl ConnectionTrait,
    request: &StartRun,
) -> Result<Option<RunInfo>, AiError> {
    let row = ai_run::Entity::find()
        .filter(ai_run::Column::SessionId.eq(&request.session_id))
        .filter(ai_run::Column::RequestId.eq(&request.request_id))
        .one(db)
        .await?;
    row.map(|row| {
        if row.request_hash != request_hash(request)? {
            return Err(AiError::Conflict);
        }
        super::history::run_info(row)
    })
    .transpose()
}

fn request_hash(request: &StartRun) -> Result<String, AiError> {
    Ok(crate::project::hash(
        &serde_json::to_vec(request).map_err(|_| AiError::InvalidRequest)?,
    ))
}

pub(crate) async fn start(db: &DatabaseConnection, request: StartRun) -> Result<RunInfo, AiError> {
    identity(&request.request_id)?;
    if request.configuration.revision == 0
        || request.configuration.selection.connection_id.is_empty()
        || request.configuration.selection.model_id.is_empty()
    {
        return Err(AiError::InvalidRequest);
    }
    match &request.trigger {
        Trigger::Message { message } | Trigger::Continue { message, .. }
            if message.trim().is_empty() || message.len() > 8192 || message.contains('\0') =>
        {
            return Err(AiError::InvalidRequest);
        }
        _ => {}
    }
    let tx = db.begin().await?;
    let session = lock_session(&tx, &request.session_id).await?;
    if let Some(run) = replay(&tx, &request).await? {
        return Ok(run);
    }
    if ai_run::Entity::find()
        .filter(ai_run::Column::SessionId.eq(&session.id))
        .filter(ai_run::Column::Status.is_in(["queued", "running", "cancelling"]))
        .one(&tx)
        .await?
        .is_some()
    {
        return Err(AiError::Busy);
    }
    let budget: Budget = decode(session.budget.clone())?;
    budget.check()?;
    // Validate persisted history before accepting another execution. The worker
    // reads the same authoritative projection rather than trusting frontend history.
    super::history::model_input(&tx, &session.id).await?;
    if !session.configuration.is_null() {
        let previous: Configuration = decode(session.configuration.clone())?;
        if previous != request.configuration && !request.confirm_rebind {
            return Err(AiError::ConfigurationChanged);
        }
    }
    let project = project::Entity::find_by_id(&session.project_id)
        .one(&tx)
        .await?
        .ok_or(AiError::NotFound)?;
    if project.revision < 1 || project.revision as u32 != request.expected_project_revision {
        return Err(AiError::Conflict);
    }
    if let Some(id) = &session.chapter_id {
        let c = chapter::Entity::find_by_id(id)
            .one(&tx)
            .await?
            .ok_or(AiError::Conflict)?;
        if c.project_id != project.id {
            return Err(AiError::Conflict);
        }
    }
    let hashes: BTreeMap<String, String> = source::Entity::find()
        .filter(source::Column::ProjectId.eq(&project.id))
        .all(&tx)
        .await?
        .into_iter()
        .map(|s| (s.id, s.text_sha256))
        .collect();
    if hashes.is_empty() {
        return Err(AiError::InvalidRequest);
    }
    let mut retry_of = None;
    let mut checkpoint = None;
    let mut original_message = None;
    if let Trigger::Retry { run_id } | Trigger::Continue { run_id, .. } = &request.trigger {
        let old = ai_run::Entity::find_by_id(run_id)
            .one(&tx)
            .await?
            .ok_or(AiError::NotFound)?;
        let valid = match &request.trigger {
            Trigger::Retry { .. } => {
                matches!(old.status.as_str(), "failed" | "interrupted" | "cancelled")
            }
            Trigger::Continue { .. } => {
                matches!(old.status.as_str(), "waiting_for_input" | "interrupted")
            }
            _ => false,
        };
        if old.session_id != session.id
            || !valid
            || old.base_revision != project.revision
            || old.source_hashes != encode(&hashes)?
        {
            return Err(AiError::Conflict);
        }
        if matches!(request.trigger, Trigger::Retry { .. }) {
            original_message = Some(old.trigger_message_id);
        }
        // A retry starts a fresh attempt; a continue retains validated step boundaries.
        if matches!(request.trigger, Trigger::Continue { .. }) {
            checkpoint = old.checkpoint;
        }
        retry_of = Some(old.id);
    }
    let run_id = uuid::Uuid::new_v4().to_string();
    let message_id = original_message.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = run_timestamp();
    let saved = ai_run::ActiveModel {
        id: Set(run_id.clone()),
        session_id: Set(session.id.clone()),
        trigger_message_id: Set(message_id.clone()),
        request_id: Set(request.request_id.clone()),
        request_hash: Set(request_hash(&request)?),
        retry_of: Set(retry_of),
        status: Set("queued".into()),
        configuration: Set(encode(&request.configuration)?),
        base_revision: Set(project.revision),
        source_hashes: Set(encode(&hashes)?),
        budget: Set(encode(&budget::Ledger::new(budget.clone()))?),
        checkpoint: Set(checkpoint),
        dispatch_after: Set(0),
        dispatched_at: Set(None),
        generation: Set(0),
        owner_instance: Set(None),
        cancel_requested: Set(false),
        error: Set(None),
        created_at: Set(now.clone()),
        finished_at: Set(None),
    }
    .insert(&tx)
    .await?;
    if let Trigger::Message { message } | Trigger::Continue { message, .. } = &request.trigger {
        let last = ai_message::Entity::find()
            .filter(ai_message::Column::SessionId.eq(&session.id))
            .order_by_desc(ai_message::Column::Ordinal)
            .one(&tx)
            .await?;
        let ordinal = last.map_or(Ok(0), |m| {
            m.ordinal.checked_add(1).ok_or(AiError::StorageFailed)
        })?;
        ai_message::ActiveModel {
            id: Set(message_id),
            session_id: Set(session.id.clone()),
            run_id: Set(Some(run_id)),
            ordinal: Set(ordinal),
            role: Set("user".into()),
            version: Set(1),
            parts: Set(
                messages::MessageParts::new(vec![messages::MessagePart::Text {
                    text: message.clone(),
                }])
                .map_err(|_| AiError::InvalidRequest)?,
            ),
            status: Set("complete".into()),
            usage: Set(None),
            created_at: Set(now),
        }
        .insert(&tx)
        .await?;
    }
    ai_session::Entity::update_many()
        .col_expr(
            ai_session::Column::Configuration,
            Expr::value(encode(&request.configuration)?),
        )
        .col_expr(
            ai_session::Column::NextSequence,
            Expr::value(
                session
                    .next_sequence
                    .checked_add(1)
                    .ok_or(AiError::StorageFailed)?,
            ),
        )
        .col_expr(
            ai_session::Column::UpdatedAt,
            Expr::value(crate::timestamp::unix_seconds()),
        )
        .filter(ai_session::Column::Id.eq(&session.id))
        .exec(&tx)
        .await?;
    tx.commit().await?;
    super::history::run_info(saved)
}

fn run_timestamp() -> String {
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:09}", time.as_secs(), time.subsec_nanos())
}

#[cfg(test)]
mod tests;
