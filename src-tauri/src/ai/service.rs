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
    if request.task_kind == "project_assistant" && request.chapter_id.is_some() {
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
        if old.protocol_version != 1 {
            return Err(AiError::InvalidRequest);
        }
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
        protocol_version: Set(1),
        task_kind: Set(request.task_kind),
        chapter_id: Set(request.chapter_id),
        title: Set(request.title),
        configuration: Set(serde_json::Value::Null),
        budget: Set(encode(&Budget::default())?),
        context_summary: Set(None),
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
    let session = ai_session::Entity::find_by_id(id)
        .one(tx)
        .await?
        .ok_or(AiError::NotFound)?;
    if session.protocol_version != 1 {
        return Err(AiError::InvalidRequest);
    }
    Ok(session)
}

pub(crate) async fn replay(
    db: &impl ConnectionTrait,
    request: &StartRun,
) -> Result<Option<RunInfo>, AiError> {
    super::history::require_current(db, &request.session_id).await?;
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

/// Retry is an explicit request for the original run configuration. Toolbar
/// changes only affect new messages; the request itself remains the replay key.
pub(crate) async fn run_configuration(
    db: &impl ConnectionTrait,
    request: &StartRun,
) -> Result<Configuration, AiError> {
    let run_id = match &request.trigger {
        Trigger::Retry { run_id } => run_id,
        Trigger::Continue { run_id, .. } if !request.resume.is_empty() => run_id,
        _ => return Ok(request.configuration.clone()),
    };
    let original = ai_run::Entity::find_by_id(run_id)
        .one(db)
        .await?
        .ok_or(AiError::NotFound)?;
    if original.session_id != request.session_id {
        return Err(AiError::Conflict);
    }
    decode(original.configuration)
}

#[cfg(test)]
pub(crate) async fn start(
    db: &DatabaseConnection,
    request: StartRun,
    casting_catalog: Option<crate::voice_binding::CatalogSnapshot>,
) -> Result<RunInfo, AiError> {
    start_inner(db, request, false, casting_catalog, None).await
}

pub(crate) async fn start_analysis(
    db: &DatabaseConnection,
    request: StartRun,
) -> Result<RunInfo, AiError> {
    start_inner(db, request, true, None, None).await
}

pub(super) async fn start_desktop(
    db: &DatabaseConnection,
    request: StartRun,
    casting_catalog: Option<crate::voice_binding::CatalogSnapshot>,
    resources: Option<&crate::voice_binding::suggest::auditions::ApprovalInventory>,
) -> Result<RunInfo, AiError> {
    start_inner(db, request, false, casting_catalog, resources).await
}

async fn start_inner(
    db: &DatabaseConnection,
    request: StartRun,
    analyze: bool,
    casting_catalog: Option<crate::voice_binding::CatalogSnapshot>,
    resources: Option<&crate::voice_binding::suggest::auditions::ApprovalInventory>,
) -> Result<RunInfo, AiError> {
    // AG-UI run identities are opaque strings (the official runtime uses nanoid).
    if request.request_id.is_empty()
        || request.request_id.len() > 256
        || request.request_id.chars().any(char::is_control)
    {
        return Err(AiError::InvalidRequest);
    }
    if request.configuration.revision == 0
        || request.configuration.selection.connection_id.is_empty()
        || request.configuration.selection.model_id.is_empty()
    {
        return Err(AiError::InvalidRequest);
    }
    match &request.trigger {
        Trigger::Message { message } | Trigger::Continue { message, .. }
            if message.trim().is_empty()
                || message.len() > 16 * 1024 * 1024
                || message.contains('\0') =>
        {
            return Err(AiError::InvalidRequest);
        }
        _ => {}
    }
    let tx = db.begin().await?;
    let session = lock_session(&tx, &request.session_id).await?;
    if matches!(request.trigger, Trigger::Compact)
        && (session.task_kind != "project_assistant"
            || !request.resume.is_empty()
            || request.workspace_context.as_ref().is_none_or(|ctx| {
                ctx.action != WorkspaceAction::Compact || ctx.chapter_id.is_some()
            }))
    {
        return Err(AiError::InvalidRequest);
    }
    if analyze && (session.task_kind != "chapter_analysis" || session.chapter_id.is_none()) {
        return Err(AiError::InvalidRequest);
    }
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
    super::interrupts::consume(&tx, &request, resources).await?;
    let budget: Budget = decode(session.budget.clone())?;
    // Validate persisted history before accepting another execution. The worker
    // reads the same authoritative projection rather than trusting frontend history.
    super::history::model_input(&tx, &session.id).await?;
    let configuration = run_configuration(&tx, &request).await?;
    if !session.configuration.is_null() && !matches!(request.trigger, Trigger::Retry { .. }) {
        let previous: Configuration = decode(session.configuration.clone())?;
        if previous != configuration && !request.confirm_rebind {
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
                matches!(
                    old.status.as_str(),
                    "waiting_for_input" | "interrupted" | "succeeded"
                )
            }
            _ => false,
        };
        if old.session_id != session.id
            || !valid
            || (!matches!(
                session.task_kind.as_str(),
                "chapter_analysis" | "project_assistant"
            ) && (old.base_revision != project.revision
                || old.source_hashes != encode(&hashes)?))
        {
            return Err(AiError::Conflict);
        }
        if matches!(request.trigger, Trigger::Retry { .. }) || !request.resume.is_empty() {
            original_message = Some(old.trigger_message_id);
        }
        // Split retries retain the previous durable stage after the scope check.
        if (session.task_kind != "project_assistant" || !request.resume.is_empty())
            && matches!(request.trigger, Trigger::Continue { .. })
            || (matches!(request.trigger, Trigger::Retry { .. })
                && old.checkpoint.is_some()
                && old.base_revision == project.revision
                && old.source_hashes == encode(&hashes)?)
        {
            checkpoint = old.checkpoint;
        }
        retry_of = Some(old.id);
    }
    let mut workspace_context = request.workspace_context.clone();
    if session.task_kind == "project_assistant" {
        let resumed_context = retry_of.as_ref().filter(|_| {
            matches!(request.trigger, Trigger::Retry { .. }) || !request.resume.is_empty()
        });
        if let Some(id) = resumed_context {
            let old = ai_run::Entity::find_by_id(id)
                .one(&tx)
                .await?
                .ok_or(AiError::NotFound)?;
            workspace_context = old.workspace_context.map(decode).transpose()?;
        }
        let context = workspace_context.as_mut().ok_or(AiError::InvalidRequest)?;
        if resumed_context.is_none() {
            context.analysis_base_revision = None;
        }
        if context.action == WorkspaceAction::Compact
            && !matches!(request.trigger, Trigger::Compact | Trigger::Retry { .. })
        {
            return Err(AiError::InvalidRequest);
        }
        if context.action == WorkspaceAction::Analyze && context.chapter_id.is_none() {
            return Err(AiError::InvalidRequest);
        }
        if context.action == WorkspaceAction::Cast && context.chapter_id.is_some() {
            return Err(AiError::InvalidRequest);
        }
        if let Some(id) = &context.chapter_id {
            let c = chapter::Entity::find_by_id(id)
                .one(&tx)
                .await?
                .ok_or(AiError::Conflict)?;
            if c.project_id != project.id {
                return Err(AiError::Conflict);
            }
            if resumed_context.is_none() && context.action == WorkspaceAction::Auto {
                context.analysis_base_revision = Some(
                    crate::chapter_analysis::analysis_state(&tx, &project.id, id)
                        .await?
                        .map_or(0, |state| state.revision as u32),
                );
            }
        }
    } else if workspace_context.is_some() {
        return Err(AiError::InvalidRequest);
    }
    let run_id = request.request_id.clone();
    let message_id = original_message.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = run_timestamp();
    let saved = ai_run::ActiveModel {
        id: Set(run_id.clone()),
        session_id: Set(session.id.clone()),
        trigger_message_id: Set(message_id.clone()),
        request_id: Set(request.request_id.clone()),
        request_hash: Set(request_hash(&request)?),
        retry_of: Set(retry_of.clone()),
        status: Set("queued".into()),
        configuration: Set(encode(&configuration)?),
        base_revision: Set(project.revision),
        source_hashes: Set(encode(&hashes)?),
        budget: Set(encode(&budget::Ledger::new(budget.clone()))?),
        agent_checkpoint: Set(None),
        checkpoint: Set(checkpoint),
        workspace_context: Set(workspace_context.as_ref().map(encode).transpose()?),
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
    super::interrupts::transfer(&tx, &request).await?;
    if session.task_kind == "project_assistant" {
        let context = workspace_context.as_ref().ok_or(AiError::InvalidRequest)?;
        let resume =
            if matches!(request.trigger, Trigger::Retry { .. }) || !request.resume.is_empty() {
                retry_of.as_deref()
            } else {
                None
            };
        // A routed analysis has a frozen input even when its original action was auto.
        let resumed_analysis = if let Some(id) = resume {
            crate::database::entity::analysis_input::Entity::find_by_id(id)
                .one(&tx)
                .await?
                .is_some()
        } else {
            false
        };
        if context.action == WorkspaceAction::Analyze || resumed_analysis {
            crate::chapter_analysis::freeze_input(
                &tx,
                &project.id,
                context
                    .chapter_id
                    .as_deref()
                    .ok_or(AiError::InvalidRequest)?,
                &run_id,
                request.configuration.clone(),
                true,
                resume,
            )
            .await?;
        }
        let resumed_casting = if let Some(id) = resume {
            crate::database::entity::casting_input::Entity::find_by_id(id)
                .one(&tx)
                .await?
                .is_some()
        } else {
            false
        };
        if context.action == WorkspaceAction::Cast || resumed_casting {
            // The triggering message text rides along as frozen instructions;
            // the resume branch inside freeze ignores it for retried runs.
            let casting_instructions = match &request.trigger {
                Trigger::Message { message } | Trigger::Continue { message, .. } => {
                    message.as_str()
                }
                Trigger::Retry { .. } | Trigger::Compact => "",
            };
            let mut refreshed_instructions = None;
            if let (Some(previous), Some(_)) = (resume, resources) {
                use crate::database::entity::{ai_interrupt, casting_input};
                let declined = ai_interrupt::Entity::find()
                    .filter(ai_interrupt::Column::ConsumedBy.eq(&request.request_id))
                    .all(&tx)
                    .await?
                    .iter()
                    .any(|row| {
                        row.request["reason"]
                            == crate::voice_binding::suggest::auditions::APPROVAL_REASON
                            && row.request["metadata"]["retry"] != true
                            && row.response.as_ref().is_some_and(|response| {
                                response["castingReceipt"]["decision"] == "rejected"
                            })
                    });
                if declined {
                    let previous = casting_input::Entity::find_by_id(previous)
                        .one(&tx)
                        .await?
                        .ok_or(AiError::Conflict)?;
                    refreshed_instructions = Some(
                        previous.content["instructions"]
                            .as_str()
                            .ok_or(AiError::StorageFailed)?
                            .to_owned(),
                    );
                }
            }
            let (catalog, resume, instructions) = match &refreshed_instructions {
                Some(instructions) => (
                    resources.map(|inventory| inventory.catalog.clone()),
                    None,
                    instructions.as_str(),
                ),
                None => (casting_catalog.clone(), resume, casting_instructions),
            };
            crate::voice_binding::suggest::freeze(
                &tx,
                &project.id,
                &run_id,
                catalog,
                resume,
                instructions,
            )
            .await
            .map_err(|_| AiError::InvalidRequest)?;
        }
    }
    if session.task_kind == "chapter_analysis" {
        crate::chapter_analysis::freeze_input(
            &tx,
            &project.id,
            session
                .chapter_id
                .as_deref()
                .ok_or(AiError::InvalidRequest)?,
            &run_id,
            request.configuration.clone(),
            analyze,
            if analyze || matches!(request.trigger, Trigger::Retry { .. }) {
                retry_of.as_deref()
            } else {
                None
            },
        )
        .await?;
    }
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
            id: Set(if request.resume.is_empty() {
                message_id
            } else {
                uuid::Uuid::new_v4().to_string()
            }),
            session_id: Set(session.id.clone()),
            run_id: Set(Some(run_id)),
            subagent_run_id: Set(None),
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
            Expr::value(encode(&configuration)?),
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
