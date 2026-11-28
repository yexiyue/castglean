//! AG-UI is the only UI protocol. Domain facts remain authoritative in SQLite.
use super::messages::{MessagePart, ResultReference, ToolState};
use super::{
    AiError, Configuration, HistoryPage, RunInfo, RunStatus, SessionInfo, WorkspaceContext,
};
use ag_ui::{Event, Message as WireMessage, RunAgentInput};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRequest {
    #[specta(type = specta_typescript::Unknown)]
    pub input: Value,
    pub configuration: Configuration,
    pub confirm_rebind: bool,
    pub expected_project_revision: u32,
    pub workspace_context: Option<WorkspaceContext>,
}

impl AgentRequest {
    pub(crate) fn into_start(self) -> Result<super::StartRun, AiError> {
        let input: RunAgentInput =
            serde_json::from_value(self.input).map_err(|_| AiError::InvalidRequest)?;
        // The client transcript is a display copy, never authoritative tool/system history.
        let mut message = input
            .messages
            .iter()
            .rev()
            .find_map(|message| match message {
                WireMessage::User(user) => serde_json::to_value(&user.content)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned)),
                _ => None,
            })
            .unwrap_or_default();
        if input
            .resume
            .as_ref()
            .is_some_and(|answers| !answers.is_empty())
        {
            // Store the user's answer in conversation history; routing identities remain
            // authoritative interrupt facts rather than visible chat text.
            message = input
                .resume
                .as_ref()
                .into_iter()
                .flatten()
                .map(|answer| match &answer.payload {
                    Some(Value::String(text)) => text.clone(),
                    Some(value) if value["decision"] == "approve" => "已批准选中的试听。".into(),
                    Some(value) if value["decision"] == "reject" => "已拒绝本批试听。".into(),
                    Some(_) => "已提交任务决定。".into(),
                    None => "用户结束了本次提问。".to_owned(),
                })
                .collect::<Vec<_>>()
                .join("\n");
        }
        let props = &input.forwarded_props;
        let trigger = if let Some(id) = props.get("retryRunId").and_then(Value::as_str) {
            super::Trigger::Retry {
                run_id: id.to_owned(),
            }
        } else if let Some(id) = props.get("continueRunId").and_then(Value::as_str) {
            super::Trigger::Continue {
                run_id: id.to_owned(),
                message,
            }
        } else if props.get("compact").and_then(Value::as_bool) == Some(true) {
            if !input.messages.is_empty()
                || input.resume.as_ref().is_some_and(|items| !items.is_empty())
            {
                return Err(AiError::InvalidRequest);
            }
            super::Trigger::Compact
        } else {
            super::Trigger::Message { message }
        };
        Ok(super::StartRun {
            resume: input.resume.unwrap_or_default(),
            session_id: input.thread_id.to_string(),
            request_id: input.run_id.to_string(),
            configuration: self.configuration,
            confirm_rebind: self.confirm_rebind,
            expected_project_revision: self.expected_project_revision,
            workspace_context: self.workspace_context,
            trigger,
        })
    }
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Record {
    pub id: String,
    pub run_id: Option<String>,
    pub subagent_run_id: Option<String>,
    pub status: String,
    pub usage: Option<super::types::TokenUsage>,
    pub results: Vec<ResultReference>,
    pub tools: BTreeMap<String, ResultReference>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Invocation {
    pub id: String,
    pub run_id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub message_id: Option<String>,
    pub status: String,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub casting_progress: Option<CastingProgress>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CastingProgress {
    pub total: u32,
    pub finished: u32,
    pub failed: u32,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPage {
    #[specta(type = Vec<specta_typescript::Unknown>)]
    pub interrupts: Vec<Value>,
    pub contexts: BTreeMap<String, WorkspaceContext>,
    pub session: SessionInfo,
    #[specta(type = Vec<specta_typescript::Unknown>)]
    pub messages: Vec<Value>,
    pub records: Vec<Record>,
    pub invocations: Vec<Invocation>,
    pub runs: Vec<RunInfo>,
    pub run: Option<RunInfo>,
    pub before: Option<u32>,
}

pub(crate) fn messages(page: &HistoryPage) -> Result<Vec<WireMessage>, AiError> {
    let mut messages = Vec::new();
    for message in &page.messages {
        let text = message
            .parts
            .parts()
            .iter()
            .filter_map(|part| match part {
                MessagePart::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        if message.role == "user" {
            messages.push(WireMessage::user(message.id.clone(), text));
            continue;
        }
        let reasoning = message
            .parts
            .parts()
            .iter()
            .filter_map(|part| match part {
                MessagePart::Reasoning { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        if !reasoning.is_empty() {
            let mut value = json!({"id":format!("{}:reasoning",message.id),"role":"reasoning","content":reasoning});
            if let Some(id) = &message.subagent_run_id {
                value["subagentRunId"] = json!(id);
            }
            messages.push(serde_json::from_value(value).map_err(|_| AiError::StorageFailed)?);
        }
        let mut assistant = json!({ "id": message.id, "role": "assistant", "content": text });
        if let Some(id) = &message.subagent_run_id {
            assistant["subagentRunId"] = json!(id);
        }
        assistant["metadata"] = json!({"castglean": {
            "runId": message.run_id, "status": message.status, "usage": message.usage
        }});
        let calls: Vec<_> = message
            .parts
            .parts()
            .iter()
            .filter_map(|part| match part {
                MessagePart::Tool {
                    id, name, input, ..
                } => Some(json!({
                    "id": id, "type": "function", "function": {
                        "name": name, "arguments": input.to_string()
                    }
                })),
                _ => None,
            })
            .collect();
        if !calls.is_empty() {
            assistant["toolCalls"] = json!(calls);
        }
        messages.push(serde_json::from_value(assistant).map_err(|_| AiError::StorageFailed)?);
        for part in message.parts.parts() {
            if let MessagePart::Tool {
                id,
                state,
                output,
                result,
                ..
            } = part
                && *state != ToolState::Running
            {
                let mut tool = json!({
                    "id": format!("{}:tool:{id}", message.id), "role": "tool", "toolCallId": id,
                    "content": json!({"output": output, "reference": result}).to_string()
                });
                if let Some(owner) = &message.subagent_run_id {
                    tool["subagentRunId"] = json!(owner);
                }
                if *state != ToolState::Completed {
                    tool["error"] = json!("tool_failed");
                }
                messages.push(serde_json::from_value(tool).map_err(|_| AiError::StorageFailed)?);
            }
        }
    }
    Ok(messages)
}

pub(crate) async fn page(
    db: &DatabaseConnection,
    history: HistoryPage,
) -> Result<AgentPage, AiError> {
    let mut invocations = history.invocations.clone();
    load_casting_progress(db, &history.session.id, &mut invocations).await?;
    let records = history
        .messages
        .iter()
        .map(|message| {
            let mut results = Vec::new();
            let mut tools = BTreeMap::new();
            for part in message.parts.parts() {
                match part {
                    MessagePart::Result { reference } => results.push(reference.clone()),
                    MessagePart::Tool {
                        id,
                        result: Some(reference),
                        ..
                    } => {
                        tools.insert(id.clone(), reference.clone());
                    }
                    _ => {}
                }
            }
            Record {
                id: message.id.clone(),
                run_id: message.run_id.clone(),
                subagent_run_id: message.subagent_run_id.clone(),
                status: message.status.clone(),
                usage: message.usage.clone(),
                results,
                tools,
            }
        })
        .collect();
    Ok(AgentPage {
        messages: messages(&history)?
            .into_iter()
            .map(serde_json::to_value)
            .collect::<Result<_, _>>()
            .map_err(|_| AiError::StorageFailed)?,
        interrupts: history.interrupts,
        records,
        invocations,
        contexts: history.contexts,
        session: history.session,
        runs: history.runs,
        run: history.run,
        before: history.before,
    })
}

async fn load_casting_progress(
    db: &DatabaseConnection,
    session_id: &str,
    invocations: &mut [Invocation],
) -> Result<(), AiError> {
    use crate::database::entity::{ai_interrupt, ai_run};
    use crate::voice_binding::suggest::auditions::APPROVAL_REASON;

    let mut casting: BTreeMap<_, _> = invocations
        .iter_mut()
        .filter(|task| task.name == "casting")
        .map(|task| (task.id.clone(), task))
        .collect();
    if casting.is_empty() {
        return Ok(());
    }
    // An invocation can request another audition batch after a partial failure.
    // Apply approved batches in originating run order so the newest batch wins.
    let receipts = ai_interrupt::Entity::find()
        .inner_join(ai_run::Entity)
        .filter(ai_interrupt::Column::SessionId.eq(session_id))
        .filter(ai_interrupt::Column::InvocationId.is_in(casting.keys().cloned()))
        .filter(ai_interrupt::Column::ConsumedBy.is_not_null())
        .order_by_asc(ai_run::Column::CreatedAt)
        .order_by_asc(ai_run::Column::Id)
        .all(db)
        .await?;
    for row in receipts {
        if row.request["reason"] != APPROVAL_REASON {
            continue;
        }
        if let Some(task) = row
            .invocation_id
            .as_ref()
            .and_then(|id| casting.get_mut(id))
            && let Some(response) = row.response
            && response["castingReceipt"]["decision"] == "approved"
        {
            task.casting_progress = Some(casting_progress(&response)?);
        }
    }
    Ok(())
}

fn casting_progress(response: &Value) -> Result<CastingProgress, AiError> {
    let attempts = response["castingReceipt"]["attempts"]
        .as_array()
        .ok_or(AiError::StorageFailed)?;
    let mut progress = CastingProgress {
        total: attempts.len() as u32,
        finished: 0,
        failed: 0,
    };
    if let Some(previews) = response["castingPreviews"].as_array() {
        for attempt in attempts {
            let Some(preview) = previews
                .iter()
                .find(|preview| preview["id"] == attempt["id"])
            else {
                continue;
            };
            match preview["status"].as_str() {
                Some("available") => progress.finished += 1,
                Some("failed" | "interrupted") => {
                    progress.finished += 1;
                    progress.failed += 1;
                }
                _ => {}
            }
        }
    }
    Ok(progress)
}

pub(crate) fn active(run: &RunInfo) -> bool {
    matches!(
        run.status,
        RunStatus::Queued | RunStatus::Running | RunStatus::Cancelling
    )
}

/// A complete replay boundary for a new reader. It never launches work.
pub(crate) fn restore(page: &AgentPage) -> Result<Vec<Value>, AiError> {
    let mut events = Vec::new();
    if let Some(run) = &page.run {
        events.push(Event::run_started(page.session.id.clone(), run.id.clone()));
    }
    for invocation in &page.invocations {
        events.extend(
            invocation_events(invocation, true, &page.interrupts)
                .into_iter()
                .take(1),
        );
    }
    append_stream(&mut events, None, page);
    append_snapshot(&mut events, page)?;
    for invocation in &page.invocations {
        events.extend(invocation_events(invocation, false, &page.interrupts));
    }
    if let Some(run) = &page.run
        && !active(run)
    {
        events.push(terminal(page, run));
    }
    encode_events(events)
}

pub(crate) fn update(previous: &AgentPage, page: &AgentPage) -> Result<Vec<Value>, AiError> {
    if previous.run.as_ref().map(|run| &run.id) != page.run.as_ref().map(|run| &run.id) {
        return restore(page);
    }
    let mut events = Vec::new();
    for invocation in &page.invocations {
        if !previous
            .invocations
            .iter()
            .any(|old| old.id == invocation.id)
        {
            events.extend(
                invocation_events(invocation, true, &page.interrupts)
                    .into_iter()
                    .take(1),
            );
        }
    }
    append_stream(&mut events, Some(previous), page);
    append_snapshot(&mut events, page)?;
    for invocation in &page.invocations {
        if previous
            .invocations
            .iter()
            .find(|old| old.id == invocation.id)
            .is_none_or(|old| old.status != invocation.status)
        {
            events.extend(invocation_events(invocation, false, &page.interrupts));
        }
    }
    if let Some(run) = &page.run
        && !active(run)
        && previous.run.as_ref().is_some_and(active)
    {
        events.push(terminal(page, run));
    }
    encode_events(events)
}

fn append_snapshot(events: &mut Vec<Event>, page: &AgentPage) -> Result<(), AiError> {
    let messages = page
        .messages
        .iter()
        .cloned()
        .map(serde_json::from_value)
        .collect::<Result<Vec<WireMessage>, _>>()
        .map_err(|_| AiError::StorageFailed)?;
    events.push(Event::messages_snapshot(messages));
    events.push(Event::state_snapshot(json!({
        "tasks": page.invocations,
        "interrupts": page.interrupts,
    })));
    Ok(())
}

// Only runs reachable through spawning tools are nested in the SDK. An
// unanchored stream otherwise creates a root reply without the snapshot's ID.
fn stream_owner<'a>(page: &AgentPage, record: &'a Record) -> Option<&'a str> {
    let owner = record.subagent_run_id.as_deref()?;
    let mut current = owner;
    for _ in &page.invocations {
        let invocation = page.invocations.iter().find(|item| item.id == current)?;
        invocation.tool_call_id.as_ref()?;
        match invocation.parent_id.as_deref() {
            Some(parent) => current = parent,
            None => return Some(owner),
        }
    }
    None
}

fn append_stream(events: &mut Vec<Event>, previous: Option<&AgentPage>, page: &AgentPage) {
    for record in &page.records {
        if record.run_id.as_deref() != page.run.as_ref().map(|run| run.id.as_str()) {
            continue;
        }
        let Some(message) = page
            .messages
            .iter()
            .find(|message| message["id"] == record.id && message["role"] == "assistant")
        else {
            continue;
        };
        let old = previous.and_then(|old| old.messages.iter().find(|item| item["id"] == record.id));
        let old_record =
            previous.and_then(|old| old.records.iter().find(|item| item.id == record.id));
        let closed =
            record.status != "streaming" && old_record.is_none_or(|old| old.status == "streaming");
        let mut owned = Vec::new();
        if old.is_none() {
            owned.push(Event::text_message_start(
                record.id.clone(),
                ag_ui::TextMessageRole::Assistant,
            ));
        }
        // Bind the assistant ID before reasoning or tools can create content
        // in the runtime's current reply.
        append_reasoning(&mut owned, previous, page, &record.id, closed);
        if let Some(delta) = content_delta(old, message) {
            owned.push(Event::text_message_content(record.id.clone(), delta));
        }
        if closed {
            owned.push(Event::text_message_end(record.id.clone()));
        }
        append_tools(&mut owned, previous, page, &record.id, message);
        let owner = stream_owner(page, record);
        events.extend(owned.into_iter().map(|event| match owner {
            Some(id) => event.with_subagent_run_id(id),
            None => event,
        }));
    }
}

fn content_delta<'a>(old: Option<&Value>, message: &'a Value) -> Option<&'a str> {
    let old_text = old
        .and_then(|item| item["content"].as_str())
        .unwrap_or_default();
    message["content"]
        .as_str()?
        .strip_prefix(old_text)
        .filter(|delta| !delta.is_empty())
}

fn append_reasoning(
    events: &mut Vec<Event>,
    previous: Option<&AgentPage>,
    page: &AgentPage,
    message_id: &str,
    closed: bool,
) {
    let id = format!("{message_id}:reasoning");
    let Some(message) = page.messages.iter().find(|message| message["id"] == id) else {
        return;
    };
    let old = previous.and_then(|page| page.messages.iter().find(|message| message["id"] == id));
    if old.is_none() {
        events.extend([
            Event::reasoning_start(id.clone()),
            Event::reasoning_message_start(id.clone()),
        ]);
    }
    if let Some(delta) = content_delta(old, message) {
        events.push(Event::reasoning_message_content(id.clone(), delta));
    }
    if closed {
        events.extend([
            Event::reasoning_message_end(id.clone()),
            Event::reasoning_end(id),
        ]);
    }
}

// The official runtime needs tool lifecycles to bind persisted interrupt
// outcomes to the active reply, including tool-only messages.
fn append_tools(
    events: &mut Vec<Event>,
    previous: Option<&AgentPage>,
    page: &AgentPage,
    message_id: &str,
    message: &Value,
) {
    let Some(calls) = message["toolCalls"].as_array() else {
        return;
    };
    for call in calls {
        let (Some(id), Some(name), Some(arguments)) = (
            call["id"].as_str(),
            call["function"]["name"].as_str(),
            call["function"]["arguments"].as_str(),
        ) else {
            continue;
        };
        let known = previous.is_some_and(|old| {
            old.messages.iter().any(|message| {
                message["toolCalls"]
                    .as_array()
                    .is_some_and(|calls| calls.iter().any(|call| call["id"] == id))
            })
        });
        if !known {
            let mut start = ag_ui::ToolCallStartEvent::new(id, name);
            start.parent_message_id = Some(message_id.into());
            events.extend([
                Event::ToolCallStart(start),
                Event::tool_call_args(id, arguments),
                Event::tool_call_end(id),
            ]);
        }
        if let Some(result) = page
            .messages
            .iter()
            .find(|message| message["role"] == "tool" && message["toolCallId"] == id)
            && !previous.is_some_and(|old| {
                old.messages
                    .iter()
                    .any(|message| message["id"] == result["id"])
            })
            && let (Some(message_id), Some(content)) =
                (result["id"].as_str(), result["content"].as_str())
        {
            events.push(Event::tool_call_result(message_id, id, content));
        }
    }
}

fn invocation_events(invocation: &Invocation, start: bool, interrupts: &[Value]) -> Vec<Event> {
    let mut events = Vec::new();
    if start {
        let mut event =
            ag_ui::SubagentStartedEvent::new(invocation.id.clone(), invocation.name.clone());
        event.parent_subagent_run_id = invocation.parent_id.clone().map(Into::into);
        event.parent_tool_call_id = invocation.tool_call_id.clone().map(Into::into);
        event.parent_message_id = invocation.message_id.clone().map(Into::into);
        events.push(Event::SubagentStarted(event));
    }
    match invocation.status.as_str() {
        "suspended" => events.push(Event::subagent_finished_suspended(
            invocation.id.clone(),
            interrupts
                .iter()
                .filter(|value| value["subagentRunId"].as_str() == Some(&invocation.id))
                .filter_map(|value| value["id"].as_str().map(str::to_owned))
                .collect::<Vec<_>>(),
        )),
        "succeeded" => events.push(Event::subagent_finished_success(invocation.id.clone())),
        "failed" | "cancelled" | "interrupted" => events.push(Event::subagent_error(
            invocation.id.clone(),
            invocation
                .error
                .clone()
                .unwrap_or_else(|| "task_failed".into()),
        )),
        _ => {}
    }
    events
}

fn terminal(page: &AgentPage, run: &RunInfo) -> Event {
    match run.status {
        RunStatus::Interrupted if !page.interrupts.is_empty() => Event::run_finished_interrupt(
            page.session.id.clone(),
            run.id.clone(),
            page.interrupts
                .iter()
                .cloned()
                .filter_map(|value| serde_json::from_value(value).ok())
                .collect::<Vec<ag_ui::Interrupt>>(),
        ),
        RunStatus::Failed | RunStatus::Interrupted => Event::run_error(
            run.error
                .map(|failure| format!("{failure:?}"))
                .unwrap_or_else(|| "task_failed".into()),
        ),
        RunStatus::Cancelled => {
            let mut event = ag_ui::RunFinishedEvent::new(page.session.id.clone(), run.id.clone());
            event.outcome = Some(ag_ui::RunOutcome::Cancelled);
            Event::RunFinished(event)
        }
        _ if !page.interrupts.is_empty() => Event::run_finished_interrupt(
            page.session.id.clone(),
            run.id.clone(),
            page.interrupts
                .iter()
                .cloned()
                .filter_map(|value| serde_json::from_value(value).ok())
                .collect::<Vec<ag_ui::Interrupt>>(),
        ),
        _ => Event::run_finished_success(page.session.id.clone(), run.id.clone()),
    }
}

fn encode_events(events: Vec<Event>) -> Result<Vec<Value>, AiError> {
    events
        .into_iter()
        .map(serde_json::to_value)
        .collect::<Result<_, _>>()
        .map_err(|_| AiError::StorageFailed)
}

#[cfg(test)]
mod tests;
