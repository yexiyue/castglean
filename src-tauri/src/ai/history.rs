//! Bounded authoritative reads, independent of subscriptions and task dispatch.
use super::{types::decode, *};
use crate::database::entity::{ai_invocation, ai_message, ai_run, ai_session};
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait, TransactionTrait,
};

pub(crate) async fn active_tasks(db: &DatabaseConnection) -> Result<u32, AiError> {
    ai_run::Entity::find()
        .filter(ai_run::Column::Status.is_in(["queued", "running", "cancelling"]))
        .filter(ai_run::Column::SessionId.in_subquery(current_sessions()))
        .count(db)
        .await?
        .try_into()
        .map_err(|_| AiError::StorageFailed)
}

pub(crate) async fn sessions(
    db: &DatabaseConnection,
    project: &str,
    task: &str,
    chapter: Option<&str>,
    before: Option<SessionCursor>,
) -> Result<SessionPage, AiError> {
    use sea_orm::Condition;
    let mut query = ai_session::Entity::find()
        .filter(ai_session::Column::ProjectId.eq(project))
        .filter(ai_session::Column::ProtocolVersion.eq(1))
        .filter(ai_session::Column::TaskKind.eq(task));
    query = if let Some(chapter) = chapter {
        query.filter(ai_session::Column::ChapterId.eq(chapter))
    } else if task == "project_assistant" {
        query
    } else {
        query.filter(ai_session::Column::ChapterId.is_null())
    };
    if let Some(cursor) = before {
        if cursor.created_at.len() > 40 || uuid::Uuid::parse_str(&cursor.id).is_err() {
            return Err(AiError::InvalidRequest);
        }
        query = query.filter(
            Condition::any()
                .add(ai_session::Column::CreatedAt.lt(cursor.created_at.clone()))
                .add(
                    Condition::all()
                        .add(ai_session::Column::CreatedAt.eq(cursor.created_at))
                        .add(ai_session::Column::Id.lt(cursor.id)),
                ),
        );
    }
    let mut rows = query
        .order_by_desc(ai_session::Column::CreatedAt)
        .order_by_desc(ai_session::Column::Id)
        .limit(33)
        .all(db)
        .await?;
    let more = rows.len() > 32;
    rows.truncate(32);
    let before = if more {
        rows.last().map(|r| SessionCursor {
            created_at: r.created_at.clone(),
            id: r.id.clone(),
        })
    } else {
        None
    };
    Ok(SessionPage {
        sessions: rows
            .into_iter()
            .map(session_info)
            .collect::<Result<_, _>>()?,
        before,
    })
}

pub(super) fn session_info(row: ai_session::Model) -> Result<SessionInfo, AiError> {
    if row.protocol_version != 1 {
        return Err(AiError::InvalidRequest);
    }
    Ok(SessionInfo {
        id: row.id,
        project_id: row.project_id,
        chapter_id: row.chapter_id,
        task_kind: row.task_kind,
        title: row.title,
        configuration: if row.configuration.is_null() {
            None
        } else {
            Some(decode(row.configuration)?)
        },
        budget: decode(row.budget)?,
        sequence: row
            .next_sequence
            .try_into()
            .map_err(|_| AiError::StorageFailed)?,
    })
}
pub(super) fn run_info(row: ai_run::Model) -> Result<RunInfo, AiError> {
    Ok(RunInfo {
        workspace_context: row.workspace_context.map(decode).transpose()?,
        id: row.id,
        session_id: row.session_id,
        retry_of: row.retry_of,
        status: RunStatus::parse(&row.status)?,
        configuration: decode(row.configuration)?,
        base_revision: row
            .base_revision
            .try_into()
            .map_err(|_| AiError::StorageFailed)?,
        budget: decode::<budget::Ledger>(row.budget)?.total()?,
        error: row.error.map(|error| {
            serde_json::from_value(serde_json::Value::String(error)).unwrap_or(RunFailure::Unknown)
        }),
    })
}

pub(crate) async fn page(
    db: &DatabaseConnection,
    session: &str,
    before: Option<u32>,
    limit: u32,
) -> Result<HistoryPage, AiError> {
    if limit == 0 || limit > 100 {
        return Err(AiError::InvalidRequest);
    }
    require_current(db, session).await?;
    let tx = db.begin().await?;
    let session = ai_session::Entity::find_by_id(session)
        .one(&tx)
        .await?
        .ok_or(AiError::NotFound)?;
    let mut query =
        ai_message::Entity::find().filter(ai_message::Column::SessionId.eq(&session.id));
    if let Some(before) = before {
        query = query.filter(ai_message::Column::Ordinal.lt(i64::from(before)));
    }
    let mut messages = query
        .order_by_desc(ai_message::Column::Ordinal)
        .limit(u64::from(limit) + 1)
        .all(&tx)
        .await?;
    let has_older = messages.len() > limit as usize;
    messages.truncate(limit as usize);
    messages.reverse();
    let before = if has_older {
        messages
            .first()
            .map(|m| m.ordinal.try_into().map_err(|_| AiError::StorageFailed))
            .transpose()?
    } else {
        None
    };
    let run = ai_run::Entity::find()
        .filter(ai_run::Column::SessionId.eq(&session.id))
        .order_by_desc(ai_run::Column::CreatedAt)
        .one(&tx)
        .await?;
    let ids: std::collections::BTreeSet<_> =
        messages.iter().filter_map(|m| m.run_id.clone()).collect();
    let mut contexts = std::collections::BTreeMap::new();
    let mut runs = Vec::new();
    if !ids.is_empty() {
        for row in ai_run::Entity::find()
            .filter(ai_run::Column::SessionId.eq(&session.id))
            .filter(ai_run::Column::Id.is_in(ids.clone()))
            .all(&tx)
            .await?
        {
            if let Some(value) = row.workspace_context.clone() {
                contexts.insert(row.id.clone(), decode(value)?);
            }
            runs.push(run_info(row)?);
        }
    }
    if let Some(row) = &run
        && !runs.iter().any(|item| item.id == row.id)
    {
        runs.push(run_info(row.clone())?);
    }
    let mut invocation_runs = ids.clone();
    if let Some(run) = &run {
        invocation_runs.insert(run.id.clone());
    }
    // Resuming moves an invocation to the new run, while its older messages
    // keep their original run IDs. Resolve their producer identities directly.
    let invocation_ids: std::collections::BTreeSet<_> = messages
        .iter()
        .filter_map(|message| message.subagent_run_id.clone())
        .collect();
    let mut invocation_rows = ai_invocation::Entity::find()
        .filter(ai_invocation::Column::SessionId.eq(&session.id))
        .filter(
            sea_orm::Condition::any()
                .add(ai_invocation::Column::RunId.is_in(invocation_runs))
                .add(ai_invocation::Column::Id.is_in(invocation_ids)),
        )
        .order_by_asc(ai_invocation::Column::Id)
        .all(&tx)
        .await?;
    // Ancestors may have moved to another attempt independently of descendants.
    // Fetch only unseen parent IDs, one batch per level; cycles terminate here.
    let mut visited: std::collections::BTreeSet<_> =
        invocation_rows.iter().map(|row| row.id.clone()).collect();
    loop {
        let parents: Vec<_> = invocation_rows
            .iter()
            .filter_map(|row| row.parent_id.as_ref())
            .filter(|id| visited.insert((*id).clone()))
            .cloned()
            .collect();
        if parents.is_empty() {
            break;
        }
        invocation_rows.extend(
            ai_invocation::Entity::find()
                .filter(ai_invocation::Column::SessionId.eq(&session.id))
                .filter(ai_invocation::Column::Id.is_in(parents))
                .all(&tx)
                .await?,
        );
    }
    invocation_rows.sort_by(|left, right| left.id.cmp(&right.id));
    let invocations = invocation_rows
        .into_iter()
        .map(|row| super::protocol::Invocation {
            id: row.id,
            run_id: row.run_id,
            name: row.name,
            parent_id: row.parent_id,
            tool_call_id: row.tool_call_id,
            message_id: row.message_id,
            status: row.status,
            error: row.error,
        })
        .collect();
    let interrupts = super::interrupts::pending(&tx, &session.id)
        .await?
        .into_iter()
        .map(|row| row.request)
        .collect();
    tx.commit().await?;
    for message in &messages {
        if !matches!(message.role.as_str(), "user" | "assistant")
            || (message.role == "user"
                && message
                    .parts
                    .parts()
                    .iter()
                    .any(|part| !matches!(part, messages::MessagePart::Text { .. })))
        {
            return Err(AiError::StorageFailed);
        }
    }
    let messages = messages
        .into_iter()
        .map(message_info)
        .collect::<Result<_, _>>()?;
    Ok(HistoryPage {
        interrupts,
        invocations,
        contexts,
        session: session_info(session)?,
        messages,
        runs,
        run: run.map(run_info).transpose()?,
        before,
    })
}

fn message_info(row: ai_message::Model) -> Result<Message, AiError> {
    Ok(Message {
        usage: row.usage.map(decode).transpose()?,
        id: row.id,
        run_id: row.run_id,
        subagent_run_id: row.subagent_run_id,
        ordinal: row.ordinal.try_into().map_err(|_| AiError::StorageFailed)?,
        role: row.role,
        version: row.version.try_into().map_err(|_| AiError::StorageFailed)?,
        parts: row.parts,
        status: row.status,
    })
}

pub(crate) async fn model_input(
    db: &impl sea_orm::ConnectionTrait,
    session: &str,
) -> Result<Vec<rig_core::message::Message>, AiError> {
    let rows = ai_message::Entity::find()
        .filter(ai_message::Column::SessionId.eq(session))
        .order_by_asc(ai_message::Column::Ordinal)
        .all(db)
        .await?;
    let messages = rows
        .into_iter()
        .map(message_info)
        .collect::<Result<Vec<_>, _>>()?;
    super::projection::history(&messages)
}

/// A professional task sees only its immutable trigger and subsequent task facts.
/// Retries retain completed tool pairs; unrelated earlier conversation stays UI-only.
pub(crate) async fn task_input(
    db: &impl sea_orm::ConnectionTrait,
    lease: &super::runs::Lease,
) -> Result<Vec<rig_core::message::Message>, AiError> {
    let run = ai_run::Entity::find_by_id(lease.run_id())
        .one(db)
        .await?
        .ok_or(AiError::NotFound)?;
    if run.session_id != lease.session_id() {
        return Err(AiError::Conflict);
    }
    let trigger = ai_message::Entity::find_by_id(run.trigger_message_id)
        .one(db)
        .await?
        .ok_or(AiError::NotFound)?;
    if trigger.session_id != lease.session_id() || trigger.role != "user" {
        return Err(AiError::Conflict);
    }
    let attempts = ai_run::Entity::find()
        .filter(ai_run::Column::SessionId.eq(lease.session_id()))
        .filter(ai_run::Column::TriggerMessageId.eq(&trigger.id))
        .select_only()
        .column(ai_run::Column::Id)
        .into_tuple::<String>()
        .all(db)
        .await?;
    let rows = ai_message::Entity::find()
        .filter(ai_message::Column::SessionId.eq(lease.session_id()))
        .filter(
            sea_orm::Condition::any()
                .add(ai_message::Column::Id.eq(trigger.id))
                .add(ai_message::Column::RunId.is_in(attempts)),
        )
        .order_by_asc(ai_message::Column::Ordinal)
        .all(db)
        .await?;
    let mut messages = rows
        .into_iter()
        .map(message_info)
        .collect::<Result<Vec<_>, _>>()?;
    let mut instruction = None;
    let mut delegation_ordinal = None;
    for message in &mut messages {
        if message.role != "assistant" {
            continue;
        }
        let mut parts = Vec::new();
        for part in message.parts.parts() {
            if let messages::MessagePart::Tool {
                name,
                state: messages::ToolState::Completed,
                input,
                ..
            } = part
                && name == "check_splitting"
            {
                let request: super::tasks::SplittingRequest =
                    serde_json::from_value(input.clone()).map_err(|_| AiError::StorageFailed)?;
                instruction = Some(request.instruction);
                delegation_ordinal = Some(message.ordinal);
                parts.clear();
            } else if instruction.is_some() {
                if let messages::MessagePart::Tool { name, .. } = part
                    && matches!(
                        name.as_str(),
                        "directory"
                            | "search_headings"
                            | "read_context"
                            | "compare_rules"
                            | "finish_splitting"
                    )
                {
                    parts.push(part.clone());
                }
            } else {
                parts.push(part.clone());
            }
        }
        message.parts = messages::MessageParts::new(parts).map_err(|_| AiError::StorageFailed)?;
    }
    if let Some(ordinal) = delegation_ordinal {
        // Earlier attempts may contain conversational tools before delegation.
        // Keep the trigger, but do not pass those parent-agent facts to the child.
        messages.retain(|message| message.role == "user" || message.ordinal >= ordinal);
    }
    let mut history = super::projection::history(&messages)?;
    if let Some(instruction) = instruction {
        let Some(first) = history.first_mut() else {
            return Err(AiError::StorageFailed);
        };
        *first = rig_core::message::Message::user(instruction);
    }
    Ok(history)
}

pub(crate) async fn require_current(
    db: &impl sea_orm::ConnectionTrait,
    id: &str,
) -> Result<(), AiError> {
    let session = ai_session::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or(AiError::NotFound)?;
    if session.protocol_version != 1 {
        return Err(AiError::InvalidRequest);
    }
    Ok(())
}

pub(crate) fn current_sessions() -> sea_orm::sea_query::SelectStatement {
    ai_session::Entity::find()
        .select_only()
        .column(ai_session::Column::Id)
        .filter(ai_session::Column::ProtocolVersion.eq(1))
        .into_query()
}
