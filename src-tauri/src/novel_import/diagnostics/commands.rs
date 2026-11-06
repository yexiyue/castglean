//! User commands are the only way to start model work or adopt a proposal.
use super::*;
use crate::{
    llm::{LlmError, LlmState},
    novel_import::ImportState,
    project::ProjectError,
};
use std::sync::Arc;
use tauri::Manager;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod tests;

fn validate_binding(
    previous: Option<&DiagnosticRecord>,
    selected: &ModelSelection,
    revision: u32,
    expected_revision: u32,
    confirm_rebind: bool,
) -> Result<(), LlmError> {
    if revision != expected_revision
        || previous.is_some_and(|d| {
            (d.selection != *selected || d.configuration_revision != revision) && !confirm_rebind
        })
    {
        return Err(LlmError::Conflict);
    }
    Ok(())
}

fn mark_cancelling(d: &mut DiagnosticRecord, run: &str) -> Result<bool, ProjectError> {
    if d.run_id != run {
        return Err(ProjectError::Conflict);
    }
    if !matches!(
        d.status,
        DiagnosticStatus::Running | DiagnosticStatus::Cancelling
    ) {
        return Ok(false);
    }
    d.status = DiagnosticStatus::Cancelling;
    Ok(true)
}

fn cancel_run(
    state: &ImportState,
    draft: &str,
    session: &str,
    run: &str,
) -> Result<(), ProjectError> {
    // Keep startup from replacing the draft's token until publication and cancellation finish.
    let running = state.running.lock().map_err(|_| ProjectError::Busy)?;
    let Some(token) = running.get(draft) else {
        return Ok(());
    };
    let published = state.update(draft, None, |r| {
        mark_cancelling(record_mut(r, session)?, run)
    });
    match published {
        Ok(false) => Ok(()),
        Err(error @ (ProjectError::Conflict | ProjectError::NotFound)) => Err(error),
        result => {
            // A storage failure must not prevent stopping the matching local run.
            token.cancel();
            result.map(|_| ())
        }
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "domain", content = "error", rename_all = "snake_case")]
pub(crate) enum DiagnosticError {
    Project(ProjectError),
    Llm(LlmError),
}
impl From<ProjectError> for DiagnosticError {
    fn from(e: ProjectError) -> Self {
        Self::Project(e)
    }
}
impl From<LlmError> for DiagnosticError {
    fn from(e: LlmError) -> Self {
        Self::Llm(e)
    }
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiagnosticStartRequest {
    draft_id: String,
    session_id: Option<String>,
    selected: ModelSelection,
    expected_configuration_revision: u32,
    confirm_rebind: bool,
    message: String,
    request_id: String,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn diagnostic_start(
    app: tauri::AppHandle,
    request: DiagnosticStartRequest,
) -> Result<DiagnosticSnapshot, DiagnosticError> {
    let DiagnosticStartRequest {
        draft_id,
        session_id,
        selected,
        expected_configuration_revision,
        confirm_rebind,
        message,
        request_id,
    } = request;
    let state = app.state::<Arc<ImportState>>().inner().clone();
    let llm = app.state::<Arc<LlmState>>().inner().clone();
    uuid::Uuid::parse_str(&request_id).map_err(|_| ProjectError::InvalidProject)?;
    if message.trim().is_empty() || message.len() > 8192 {
        return Err(ProjectError::TooLarge.into());
    }
    let replay = {
        let state = state.clone();
        let draft = draft_id.clone();
        let request = request_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let recovery = state.read(&draft)?;
            recovery
                .diagnostic_commands
                .get(&request)
                .map(|session| state.diagnostic_snapshot(&draft, session))
                .transpose()
        })
        .await
        .map_err(|_| ProjectError::ReadFailed)??
    };
    if let Some(snapshot) = replay {
        return Ok(snapshot);
    }
    if state
        .cancelled_starts
        .lock()
        .map_err(|_| ProjectError::Busy)?
        .contains(&request_id)
    {
        return Err(ProjectError::Cancelled.into());
    }
    let lease = llm.acquire(&selected)?;
    {
        let state = state.clone();
        let draft = draft_id.clone();
        let session = session_id.clone();
        let selected = selected.clone();
        let revision = lease.connection.revision;
        tauri::async_runtime::spawn_blocking(move || {
            let recovery = state.read(&draft)?;
            validate_binding(
                session
                    .as_ref()
                    .and_then(|id| recovery.diagnostics.iter().find(|d| &d.id == id)),
                &selected,
                revision,
                expected_configuration_revision,
                confirm_rebind,
            )?;
            Ok::<_, DiagnosticError>(())
        })
        .await
        .map_err(|_| ProjectError::ReadFailed)??;
    }
    for kind in [
        crate::llm::ProbeKind::Connection,
        crate::llm::ProbeKind::Tools,
    ] {
        if !lease.connection.probes.iter().any(|p| {
            p.model_id == selected.model_id
                && p.kind == kind
                && p.revision == lease.connection.revision
                && p.failure.is_none()
        }) {
            return Err(LlmError::CapabilityUnavailable.into());
        }
    }
    let token = CancellationToken::new();
    {
        let mut running = state.running.lock().map_err(|_| ProjectError::Busy)?;
        if running.contains_key(&draft_id) || running.len() >= 2 {
            return Err(ProjectError::Busy.into());
        }
        running.insert(draft_id.clone(), token.clone());
    }
    let session = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let initialize = {
        let state = state.clone();
        let draft = draft_id.clone();
        let session = session.clone();
        let selected = selected.clone();
        let run = request_id.clone();
        let revision = lease.connection.revision;
        tauri::async_runtime::spawn_blocking(move || {
            let mut binding_error = None;
            let result = state.update(&draft, None, |r| {
                r.document.validate()?;
                if r.diagnostic_commands.contains_key(&run) {
                    return Err(ProjectError::Conflict);
                }
                let base_revision = r.document.project.revision;
                let hashes = current_hashes(r);
                let index = r.diagnostics.iter().position(|d| d.id == session);
                if let Err(error) = validate_binding(
                    index.map(|i| &r.diagnostics[i]),
                    &selected,
                    revision,
                    expected_configuration_revision,
                    confirm_rebind,
                ) {
                    binding_error = Some(error);
                    return Err(ProjectError::Conflict);
                }
                if index.is_none() {
                    if r.diagnostics.len() >= 32 {
                        return Err(ProjectError::TooLarge);
                    }
                    r.diagnostics.push(DiagnosticRecord {
                        id: session.clone(),
                        run_id: run.clone(),
                        graph_version: 1,
                        selection: selected.clone(),
                        configuration_revision: revision,
                        base_revision,
                        hashes: hashes.clone(),
                        status: DiagnosticStatus::Running,
                        messages: Vec::new(),
                        proposals: Vec::new(),
                        calls: Vec::new(),
                        requests: 0,
                        turn_requests: 0,
                        tool_calls: 0,
                        input_bytes: 0,
                        tool_bytes: 0,
                        in_flight: false,
                        error: None,
                        started_at: crate::timestamp::unix_seconds(),
                        input_tokens: None,
                        output_tokens: None,
                        graph: None,
                    });
                }
                let d = record_mut(r, &session)?;
                if d.requests >= 64 || d.graph_version != 1 || d.messages.len() >= 128 {
                    return Err(ProjectError::TooLarge);
                }
                if d.hashes != hashes {
                    return Err(ProjectError::Conflict);
                }
                d.base_revision = base_revision;
                d.selection = selected;
                d.configuration_revision = revision;
                d.run_id = run.clone();
                d.turn_requests = 0;
                d.tool_calls = 0;
                d.input_bytes = 0;
                d.tool_bytes = 0;
                d.in_flight = false;
                d.error = None;
                d.status = DiagnosticStatus::Running;
                d.started_at = crate::timestamp::unix_seconds();
                d.messages.push(DiagnosticMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    role: "user".into(),
                    parts: vec![DiagnosticPart::Text { text: message }],
                    interrupted: false,
                });
                d.messages.push(DiagnosticMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    role: "assistant".into(),
                    parts: Vec::new(),
                    interrupted: false,
                });
                d.graph = Some(
                    graph_flow::Session::new_from_task(session.clone(), "prepare")
                        .with_graph_id("chapter-splitting-v1"),
                );
                r.diagnostic_commands.insert(run, session.clone());
                Ok(())
            });
            result.map_err(|error| match binding_error {
                Some(error) => DiagnosticError::Llm(error),
                None => DiagnosticError::Project(error),
            })
        })
        .await
        .map_err(|_| ProjectError::WriteFailed)?
    };
    if let Err(error) = initialize {
        state
            .running
            .lock()
            .map_err(|_| ProjectError::Busy)?
            .remove(&draft_id);
        return Err(error);
    }
    let wire_account = {
        let state = state.clone();
        let draft = draft_id.clone();
        let session = session.clone();
        let run = request_id.clone();
        let token = token.clone();
        Arc::new(move |bytes: usize| {
            state
                .update(&draft, None, |r| {
                    let d = record_mut(r, &session)?;
                    if token.is_cancelled()
                        || d.run_id != run
                        || d.status != DiagnosticStatus::Running
                    {
                        return Err(ProjectError::Cancelled);
                    }
                    super::budget::account_wire(d, bytes)?;
                    Ok(())
                })
                .map_err(|_| LlmError::TooLarge)
        })
    };
    let configured = tauri::async_runtime::spawn_blocking(move || {
        crate::llm::configured_model(&lease, Some(wire_account)).map(|model| (lease, model))
    })
    .await
    .map_err(|_| LlmError::CredentialUnavailable)?;
    let (lease, model) = match configured {
        Ok(value) => value,
        Err(error) => {
            let state = state.clone();
            let draft = draft_id.clone();
            let session = session.clone();
            tauri::async_runtime::spawn_blocking(move || {
                state
                    .running
                    .lock()
                    .map_err(|_| ProjectError::Busy)?
                    .remove(&draft);
                state.update(&draft, None, |r| {
                    let d = record_mut(r, &session)?;
                    d.status = DiagnosticStatus::Failed;
                    d.error = Some(error.to_string());
                    Ok(())
                })
            })
            .await
            .map_err(|_| ProjectError::WriteFailed)??;
            return Err(error.into());
        }
    };
    if state
        .cancelled_starts
        .lock()
        .map_err(|_| ProjectError::Busy)?
        .contains(&request_id)
    {
        token.cancel();
    }
    let context = execution::RunContext {
        state: state.clone(),
        draft: draft_id.clone(),
        session: session.clone(),
        run: request_id,
        token,
        workers: Arc::new(tokio::sync::Semaphore::new(1)),
        model,
    };
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        execution::execute(context).await;
    });
    tauri::async_runtime::spawn_blocking(move || state.diagnostic_snapshot(&draft_id, &session))
        .await
        .map_err(|_| ProjectError::ReadFailed)?
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn diagnostic_snapshot(
    state: tauri::State<'_, Arc<ImportState>>,
    draft_id: String,
    session_id: Option<String>,
) -> Result<Option<DiagnosticSnapshot>, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let r = state.read(&draft_id)?;
        let Some(id) = session_id.or_else(|| r.diagnostics.last().map(|d| d.id.clone())) else {
            return Ok(None);
        };
        // Only this process's active registry establishes that an old running record is live.
        if r.diagnostics.iter().any(|d| {
            matches!(
                d.status,
                DiagnosticStatus::Running | DiagnosticStatus::Cancelling
            )
        }) && !state
            .running
            .lock()
            .map_err(|_| ProjectError::Busy)?
            .contains_key(&draft_id)
        {
            state.update(&draft_id, None, |r| {
                for d in &mut r.diagnostics {
                    if matches!(
                        d.status,
                        DiagnosticStatus::Running | DiagnosticStatus::Cancelling
                    ) {
                        d.status = DiagnosticStatus::Interrupted;
                        d.in_flight = false;
                        d.interrupt_tools();
                        for call in &mut d.calls {
                            if call.status == ModelCallStatus::Started {
                                call.status = ModelCallStatus::Interrupted;
                            }
                        }
                        d.error = Some("interrupted".into());
                        if let Some(message) = d.messages.last_mut() {
                            message.interrupted = true;
                        }
                    }
                }
                Ok(())
            })?;
        }
        state.diagnostic_snapshot(&draft_id, &id).map(Some)
    })
    .await
    .map_err(|_| ProjectError::ReadFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn diagnostic_cancel(
    state: tauri::State<'_, Arc<ImportState>>,
    draft_id: String,
    session_id: String,
) -> Result<(), ProjectError> {
    // Also accepts a start request ID, so Stop works before startup returns a session ID.
    uuid::Uuid::parse_str(&session_id).map_err(|_| ProjectError::InvalidProject)?;
    {
        let mut cancelled = state
            .cancelled_starts
            .lock()
            .map_err(|_| ProjectError::Busy)?;
        if cancelled.len() >= 4096 && !cancelled.contains(&session_id) {
            return Err(ProjectError::TooLarge);
        }
        cancelled.insert(session_id.clone());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let record = state.read(&draft_id)?;
        let Some(diagnostic) = record
            .diagnostics
            .iter()
            .find(|d| d.id == session_id || d.run_id == session_id)
        else {
            return Ok(());
        };
        // Resolved commands have durable identity; only unresolved startup races
        // need to retain a tombstone for the later initialization check.
        state
            .cancelled_starts
            .lock()
            .map_err(|_| ProjectError::Busy)?
            .remove(&session_id);
        if !matches!(
            diagnostic.status,
            DiagnosticStatus::Running | DiagnosticStatus::Cancelling
        ) {
            return Ok(());
        }
        cancel_run(&state, &draft_id, &diagnostic.id, &diagnostic.run_id)?;
        state.notify(&draft_id, &diagnostic.id);
        Ok::<_, ProjectError>(())
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)??;
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn diagnostic_adopt(
    state: tauri::State<'_, Arc<ImportState>>,
    draft_id: String,
    session_id: String,
    proposal_id: String,
    request_id: String,
) -> Result<crate::novel_import::ImportSnapshot, ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.adopt(&draft_id, &session_id, &proposal_id, &request_id)
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn diagnostic_subscribe(
    state: tauri::State<'_, Arc<ImportState>>,
    draft_id: String,
    session_id: String,
    subscription_id: String,
    channel: tauri::ipc::Channel<DiagnosticSnapshot>,
) -> Result<(), ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        uuid::Uuid::parse_str(&subscription_id).map_err(|_| ProjectError::InvalidProject)?;
        // Register under the stream lock, then send the authoritative snapshot under that same lock.
        let mut subscribers = state
            .subscribers
            .lock()
            .map_err(|_| ProjectError::ReadFailed)?;
        channel
            .send(state.diagnostic_snapshot(&draft_id, &session_id)?)
            .map_err(|_| ProjectError::ReadFailed)?;
        subscribers.insert(
            format!("{draft_id}:{session_id}:{subscription_id}"),
            channel,
        );
        Ok::<_, ProjectError>(())
    })
    .await
    .map_err(|_| ProjectError::ReadFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) fn diagnostic_unsubscribe(
    state: tauri::State<'_, Arc<ImportState>>,
    draft_id: String,
    session_id: String,
    subscription_id: String,
) -> Result<(), ProjectError> {
    state
        .subscribers
        .lock()
        .map_err(|_| ProjectError::ReadFailed)?
        .remove(&format!("{draft_id}:{session_id}:{subscription_id}"));
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn diagnostic_discard_proposal(
    state: tauri::State<'_, Arc<ImportState>>,
    draft_id: String,
    session_id: String,
    proposal_id: String,
) -> Result<(), ProjectError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.discard_proposal(&draft_id, &session_id, &proposal_id)
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}
