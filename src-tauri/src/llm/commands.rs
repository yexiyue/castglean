//! Thin IPC commands; credentials and filesystem work never run on the WebView thread.
use super::{LlmState, providers, types::*};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub(crate) struct ProbeTasks(Mutex<HashMap<String, CancellationToken>>);

#[tauri::command]
#[specta::specta]
pub(crate) async fn llm_snapshot(
    state: tauri::State<'_, Arc<LlmState>>,
) -> Result<LlmSnapshot, LlmError> {
    state.snapshot()
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn llm_update_connection(
    state: tauri::State<'_, Arc<LlmState>>,
    change: ConnectionChange,
) -> Result<LlmSnapshot, LlmError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.update(change))
        .await
        .map_err(|_| LlmError::WriteFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn llm_delete_connection(
    state: tauri::State<'_, Arc<LlmState>>,
    id: String,
    revision: u32,
) -> Result<LlmSnapshot, LlmError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.delete(&id, revision))
        .await
        .map_err(|_| LlmError::WriteFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn llm_set_default(
    state: tauri::State<'_, Arc<LlmState>>,
    selected: Option<ModelSelection>,
) -> Result<LlmSnapshot, LlmError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.set_default(selected))
        .await
        .map_err(|_| LlmError::WriteFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn llm_list_remote_models(
    state: tauri::State<'_, Arc<LlmState>>,
    connection_id: Option<String>,
    protocol: LlmProtocol,
    endpoint: String,
    credential: Option<String>,
) -> Result<Vec<ListedModel>, LlmError> {
    let endpoint = super::config::endpoint(&endpoint)?;
    let lease = connection_id
        .as_deref()
        .map(|id| state.acquire_connection(id))
        .transpose()?;
    let key = match credential {
        Some(key) => key,
        None => match &lease {
            Some(lease) => lease.key()?,
            None => String::new(),
        },
    };
    providers::list(protocol, &endpoint, &key).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn llm_probe(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<LlmState>>,
    selected: ModelSelection,
    kind: ProbeKind,
    request_id: String,
) -> Result<LlmSnapshot, LlmError> {
    use tauri::Manager;
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err(LlmError::InvalidConfiguration);
    }
    let lease = state.acquire(&selected)?;
    let token = CancellationToken::new();
    let tasks = app.state::<ProbeTasks>();
    {
        let mut active = tasks.0.lock().map_err(|_| LlmError::ReadFailed)?;
        if active.len() >= 4 || active.contains_key(&request_id) {
            return Err(LlmError::Busy);
        }
        active.insert(request_id.clone(), token.clone());
    }
    let result = providers::probe_cancellable(&lease, kind, &token).await;
    tasks
        .0
        .lock()
        .map_err(|_| LlmError::ReadFailed)?
        .remove(&request_id);
    let probe = ProbeResult {
        model_id: selected.model_id.clone(),
        kind,
        revision: lease.connection.revision,
        tested_at: crate::timestamp::unix_seconds(),
        failure: result.err(),
    };
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.record_probe(&selected, probe))
        .await
        .map_err(|_| LlmError::WriteFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) fn llm_cancel_probe(
    tasks: tauri::State<'_, ProbeTasks>,
    request_id: String,
) -> Result<(), LlmError> {
    if let Some(token) = tasks
        .0
        .lock()
        .map_err(|_| LlmError::ReadFailed)?
        .get(&request_id)
    {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn llm_cleanup_credentials(
    state: tauri::State<'_, Arc<LlmState>>,
) -> Result<LlmSnapshot, LlmError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.cleanup()?;
        state.snapshot()
    })
    .await
    .map_err(|_| LlmError::WriteFailed)?
}
