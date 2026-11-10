//! IPC validates the current model binding; use cases own persisted state.
use super::*;
use sea_orm::DatabaseConnection;
use tauri::Manager;

#[tauri::command]
#[specta::specta]
pub(crate) async fn ai_sessions(
    db: tauri::State<'_, DatabaseConnection>,
    project_id: String,
    task_kind: String,
    chapter_id: Option<String>,
    before: Option<SessionCursor>,
) -> Result<SessionPage, AiError> {
    history::sessions(
        db.inner(),
        &project_id,
        &task_kind,
        chapter_id.as_deref(),
        before,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn ai_request_status(
    db: tauri::State<'_, DatabaseConnection>,
    request: StartRun,
) -> Result<Option<RunInfo>, AiError> {
    service::replay(db.inner(), &request).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn ai_session_create(
    db: tauri::State<'_, DatabaseConnection>,
    request: CreateSession,
) -> Result<SessionInfo, AiError> {
    create_session(db.inner(), request).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn ai_history(
    db: tauri::State<'_, DatabaseConnection>,
    session_id: String,
    before: Option<u32>,
    limit: u32,
) -> Result<HistoryPage, AiError> {
    history_page(db.inner(), &session_id, before, limit).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn ai_cancel(
    stream: tauri::State<'_, std::sync::Arc<super::stream::Hub>>,
    runtime: tauri::State<'_, std::sync::Arc<crate::jobs::Runtime>>,
    db: tauri::State<'_, DatabaseConnection>,
    run_id: String,
) -> Result<RunInfo, AiError> {
    let result = runs::cancel(db.inner(), &run_id).await?;
    runtime.cancel(&run_id);
    let _ = stream.publish(&result.session_id).await;
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn ai_start(app: tauri::AppHandle, request: StartRun) -> Result<RunInfo, AiError> {
    let db = app.state::<DatabaseConnection>();
    // A lost response must still be recoverable after model settings have changed.
    if let Some(run) = service::replay(db.inner(), &request).await? {
        let _ = app
            .state::<std::sync::Arc<super::stream::Hub>>()
            .publish(&run.session_id)
            .await;
        return Ok(run);
    }
    let configuration = service::run_configuration(db.inner(), &request).await?;
    let llm = app.state::<std::sync::Arc<crate::llm::LlmState>>();
    let lease = llm
        .acquire(&configuration.selection)
        .map_err(|_| AiError::ConfigurationUnavailable)?;
    if lease.connection.revision != configuration.revision {
        return Err(AiError::ConfigurationChanged);
    }
    let casting_catalog = if request
        .workspace_context
        .as_ref()
        .is_some_and(|context| context.action == WorkspaceAction::Cast)
    {
        Some(
            crate::voice_binding::read_catalog(app.clone())
                .await
                .map_err(|_| AiError::StorageFailed)?,
        )
    } else {
        None
    };
    let result = start_run(db.inner(), request, casting_catalog).await?;
    let _ = app
        .state::<std::sync::Arc<super::stream::Hub>>()
        .publish(&result.session_id)
        .await;
    app.state::<std::sync::Arc<crate::jobs::Runtime>>().wake();
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn ai_subscribe(
    stream: tauri::State<'_, std::sync::Arc<super::stream::Hub>>,
    session_id: String,
    subscription_id: String,
    after: u32,
    channel: tauri::ipc::Channel<super::stream::StreamEvent>,
) -> Result<(), AiError> {
    let stream = stream.inner().clone();
    let mut subscription = stream
        .subscribe(&session_id, &subscription_id, after)
        .await?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = subscription.next().await {
            if channel.send(event.as_ref().clone()).is_err() {
                break;
            }
        }
        stream.unsubscribe(&session_id, &subscription_id).await;
    });
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn ai_acknowledge(
    stream: tauri::State<'_, std::sync::Arc<super::stream::Hub>>,
    session_id: String,
    subscription_id: String,
    sequence: u32,
) -> Result<(), AiError> {
    stream
        .acknowledge(&session_id, &subscription_id, sequence)
        .await
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn ai_unsubscribe(
    stream: tauri::State<'_, std::sync::Arc<super::stream::Hub>>,
    session_id: String,
    subscription_id: String,
) -> Result<(), AiError> {
    stream.unsubscribe(&session_id, &subscription_id).await;
    Ok(())
}
