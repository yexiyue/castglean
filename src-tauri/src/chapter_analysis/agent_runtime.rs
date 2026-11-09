//! Native Rig execution shared by production and the no-write evaluation entry.
use super::agent_core::{self, SharedDraft};
use crate::ai::{
    RunFailure,
    dispatch::ToolDispatch,
    output::Output,
    runs::{self, Lease},
};
use rig_agent::agent::{
    AgentBuilder, AgentHook, DispatchAction, DispatchEvent, HookContext, OutcomeAction,
    OutcomeEvent,
};
use rig_agent::run::policy::{InvalidToolCallAction, InvalidToolCallContext};
use rig_core::{DynModel, completion::Usage, operation::Completion};
use sea_orm::{
    ActiveModelTrait, DatabaseConnection, EntityTrait, IntoActiveModel, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{sync::Arc, time::Instant};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub(super) struct Persistence {
    pub db: DatabaseConnection,
    pub lease: Lease,
    pub dependencies: super::types::Dependencies,
    pub window_id: String,
    pub output: Output,
    pub dispatch: ToolDispatch,
}
impl Persistence {
    pub async fn update(&self, key: &str, value: Value) -> Result<(), RunFailure> {
        self.patch(json!({key:value})).await
    }
    pub async fn patch(&self, values: Value) -> Result<(), RunFailure> {
        use crate::database::entity::analysis_window;
        let tx = self
            .db
            .begin()
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::lock(&tx, &self.lease, false)
            .await
            .map_err(|_| RunFailure::Cancelled)?;
        super::store::check_dependencies(
            &tx,
            &self.dependencies,
            self.dependencies.analysis_revision != 0,
        )
        .await
        .map_err(super::execution::failure)?;
        let row = analysis_window::Entity::find_by_id(&self.window_id)
            .one(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .ok_or(RunFailure::StorageFailed)?;
        let mut content = row.content.clone();
        for (key, value) in values.as_object().ok_or(RunFailure::InvalidResponse)? {
            content[key] = value.clone();
        }
        let mut row = row.into_active_model();
        row.content = Set(content);
        row.update(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::commit(tx, &self.lease)
            .await
            .map_err(|_| RunFailure::StorageFailed)
    }
    async fn save_trace(&self, trace: &Trace) -> Result<(), RunFailure> {
        // Each attempt gets its own immutable key; retries retain prior costs/failures.
        self.update(
            &format!("trace:{}", trace.id),
            serde_json::to_value(trace).map_err(|_| RunFailure::StorageFailed)?,
        )
        .await
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RequestFact {
    pub input_hash: String,
    pub input_bytes: usize,
    pub tool_schema_hash: String,
    pub offered_tools: usize,
    pub elapsed_ms: Option<u64>,
    pub usage: Option<Usage>,
    pub status: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Trace {
    pub id: String,
    pub protocol: String,
    pub stage: String,
    pub prompt_hash: String,
    pub requests: Vec<RequestFact>,
    pub elapsed_ms: u64,
    pub status: String,
    pub run_id: Option<String>,
    pub started_at_ms: u64,
    pub observed_at_ms: u64,
}
struct State {
    trace: Trace,
    request_started: Option<Instant>,
    tool_started: Option<Instant>,
    failure: Option<RunFailure>,
}
#[derive(Clone)]
struct Hook {
    draft: SharedDraft,
    state: Arc<Mutex<State>>,
    persist: Option<Persistence>,
    token: CancellationToken,
    started: Instant,
}
pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn classify(error: rig_agent::run::PromptError) -> RunFailure {
    use rig_agent::run::PromptError;
    use rig_core::error::{ErrorKind, ProviderError};
    match error {
        PromptError::Provider(e) => {
            super::execution::provider_failure(crate::llm::provider_failure(e))
        }
        PromptError::Report(report) if matches!(report.kind, ErrorKind::Tool(_)) => {
            RunFailure::ToolFailed
        }
        PromptError::Report(report) => super::execution::provider_failure(
            crate::llm::provider_failure(ProviderError::Relayed(Box::new(report))),
        ),
        PromptError::Cancelled { .. } => RunFailure::Cancelled,
        PromptError::MaxTurns { .. } => RunFailure::BudgetExhausted,
        PromptError::Memory { .. } => RunFailure::StorageFailed,
        PromptError::UnknownToolCall { .. } => RunFailure::ToolFailed,
        _ => RunFailure::InvalidResponse,
    }
}
fn safe_tool_name(name: &str) -> &str {
    match name {
        "read_source" | "patch_annotations" | "finish_analysis" => name,
        _ => "invalid_tool",
    }
}
fn summary(value: &Value) -> Value {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    json!({"sha256": crate::project::hash(&bytes),"bytes":bytes.len()})
}
impl Hook {
    async fn save(&self) -> Result<(), RunFailure> {
        let trace = {
            let mut state = self.state.lock().await;
            state.trace.elapsed_ms = self.started.elapsed().as_millis() as u64;
            state.trace.observed_at_ms = now_ms();
            state.trace.clone()
        };
        if let Some(p) = &self.persist {
            p.save_trace(&trace).await?;
        }
        Ok(())
    }
    async fn fail(&self, e: RunFailure) {
        self.state.lock().await.failure = Some(e);
    }
}
impl AgentHook for Hook {
    async fn on_dispatch(&self, _: &HookContext, event: DispatchEvent<'_>) -> DispatchAction {
        if self.token.is_cancelled() {
            return DispatchAction::stop("cancelled");
        }
        if self.draft.lock().is_ok_and(|d| d.terminal()) {
            return DispatchAction::stop("draft_terminal");
        }
        let result: Result<(), RunFailure> = async {
            if let Some(request) = event.completion_request() {
                let bytes = serde_json::to_vec(request).map_err(|_| RunFailure::InvalidResponse)?;
                let tool_bytes =
                    serde_json::to_vec(&request.tools).map_err(|_| RunFailure::InvalidResponse)?;
                if let Some(p) = &self.persist {
                    super::store::check_dependencies(
                        &p.db,
                        &p.dependencies,
                        p.dependencies.analysis_revision != 0,
                    )
                    .await
                    .map_err(super::execution::failure)?;
                    p.output
                        .start(
                            bytes
                                .len()
                                .try_into()
                                .map_err(|_| RunFailure::BudgetExhausted)?,
                        )
                        .await
                        .map_err(|_| RunFailure::StorageFailed)?;
                }
                let mut s = self.state.lock().await;
                s.trace.requests.push(RequestFact {
                    input_hash: crate::project::hash(&bytes),
                    input_bytes: bytes.len(),
                    tool_schema_hash: crate::project::hash(&tool_bytes),
                    offered_tools: request.tools.len(),
                    elapsed_ms: None,
                    usage: None,
                    status: "in_flight".into(),
                });
                s.request_started = Some(Instant::now());
            } else if let Some(name) = event.tool_name() {
                let name = safe_tool_name(name);
                let args: Value = event
                    .tool_args()
                    .and_then(|a| serde_json::from_str(a).ok())
                    .ok_or(RunFailure::ToolFailed)?;
                if let Some(p) = &self.persist {
                    p.dispatch
                        .begin(
                            &p.output.id().await.map_err(|_| RunFailure::StorageFailed)?,
                            &event.call_id.map(ToString::to_string).unwrap_or_default(),
                            name,
                            summary(&args),
                        )
                        .await
                        .map_err(|_| RunFailure::StorageFailed)?;
                }
                self.state.lock().await.tool_started = Some(Instant::now());
            }
            self.save().await
        }
        .await;
        if let Err(e) = result {
            self.fail(e).await;
            DispatchAction::stop("persistence_rejected")
        } else {
            DispatchAction::proceed()
        }
    }
    async fn on_invalid_tool_call(
        &self,
        _: &HookContext,
        event: &InvalidToolCallContext,
    ) -> Option<InvalidToolCallAction> {
        if let Some(p) = &self.persist {
            let name = safe_tool_name(&event.tool_name);
            let id = event
                .tool_call_id
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let args = summary(&json!(event.args));
            let result = async {
                p.dispatch
                    .begin(&p.output.id().await?, &id, name, args.clone())
                    .await?;
                p.dispatch
                    .complete(&id, name, &args, json!({"error":"invalid_tool_call"}), true)
                    .await
            }
            .await;
            if result.is_err() {
                self.fail(RunFailure::StorageFailed).await;
            }
        }
        self.fail(RunFailure::ToolFailed).await;
        Some(InvalidToolCallAction::stop("invalid_tool_call"))
    }
    async fn on_outcome(&self, _: &HookContext, event: OutcomeEvent<'_>) -> OutcomeAction {
        let result: Result<(), RunFailure> = async {
            if let Some(response) = event.completion() {
                if let Some(p) = &self.persist { p.output.usage(&response.usage).await.map_err(|_|RunFailure::StorageFailed)?; }
                let invalid = response.error.is_some() || response.aborted.is_some() || response.finish_reason().is_some_and(|r|r.truncated_output());
                let mut s = self.state.lock().await;
                let elapsed = s.request_started.take().map(|t|t.elapsed().as_millis() as u64);
                if let Some(f) = s.trace.requests.last_mut() { f.elapsed_ms=elapsed; f.usage=Some(response.usage); f.status=if invalid {"invalid_response"} else {"completed"}.into(); }
                if invalid { s.failure=Some(RunFailure::InvalidResponse); }
            }
            if let Some(name) = event.tool_name() {
                let name=safe_tool_name(name);
                let args:Value = event.tool_args().and_then(|a|serde_json::from_str(a).ok()).ok_or(RunFailure::ToolFailed)?;
                let result = event.tool_result();
                let failed = result.is_none_or(|r|r.is_error());
                let value:Value = result.and_then(|r|serde_json::from_str(&r.output().render()).ok()).unwrap_or(Value::Null);
                let elapsed = self.state.lock().await.tool_started.take().map(|t|t.elapsed().as_millis() as u64);
                // Persist only hashes and host-owned feedback codes; read_source text remains in memory.
                let observation = json!({"result":summary(&value),"elapsedMs":elapsed,"ok":value.get("ok"),"error":value.get("error").and_then(Value::as_str).filter(|s|s.len()<100 && s.chars().all(|c|c.is_ascii_alphanumeric() || c=='_'))});
                if let Some(p) = &self.persist {
                    p.dispatch.complete(&event.call_id.map(ToString::to_string).unwrap_or_default(),name,&summary(&args),observation,failed || value.get("ok")==Some(&Value::Bool(false))).await.map_err(|_|RunFailure::StorageFailed)?;
                }
            }
            self.save().await
        }.await;
        if let Err(e) = result {
            self.fail(e).await;
        }
        if self.state.lock().await.failure.is_some()
            || self.draft.lock().is_ok_and(|d| d.terminal())
        {
            OutcomeAction::stop("draft_terminal_or_failure")
        } else {
            OutcomeAction::proceed()
        }
    }
}

pub(super) async fn run(
    model: DynModel<Completion>,
    draft: SharedDraft,
    max_output: Option<u32>,
    token: &CancellationToken,
    persist: Option<Persistence>,
    stage: &str,
) -> (Result<(), RunFailure>, Trace) {
    let start = Instant::now();
    let state = Arc::new(Mutex::new(State {
        trace: Trace {
            id: uuid::Uuid::new_v4().to_string(),
            protocol: "chapter-agent-c7/1".into(),
            stage: stage.into(),
            prompt_hash: crate::project::hash(agent_core::prompt().as_bytes()),
            requests: vec![],
            elapsed_ms: 0,
            status: "running".into(),
            run_id: persist.as_ref().map(|p| p.lease.run_id().to_owned()),
            started_at_ms: now_ms(),
            observed_at_ms: now_ms(),
        },
        request_started: None,
        tool_started: None,
        failure: None,
    }));
    let hook = Hook {
        draft: draft.clone(),
        state: state.clone(),
        persist,
        token: token.clone(),
        started: start,
    };
    let result = async {
        let input=draft.lock().map_err(|_|RunFailure::InvalidResponse)?.input().to_string();
        let tools=agent_core::dynamic_tools(draft.clone()).map_err(|_|RunFailure::ToolFailed)?;
        let mut builder=AgentBuilder::new(model).preamble(agent_core::prompt()).dynamic_tools(tools).record_content_telemetry(false).add_hook(hook.clone());
        if let Some(max)=max_output {builder=builder.max_tokens(u64::from(max));}
        let agent=builder.build();
        // No cumulative-token or chapter wall-clock quota. Core bounds tool/repair loops;
        // a finite turn guard also terminates providers that never call a tool.
        let outcome=tokio::select! {biased; ()=token.cancelled()=>return Err(RunFailure::Cancelled), result=agent.prompt(input).max_turns(40).tool_concurrency(1).max_invalid_tool_call_retries(0).max_consecutive_malformed_tool_calls(Some(0)).run()=>result};
        if let Some(e)=state.lock().await.failure {return Err(e);}
        if token.is_cancelled() {return Err(RunFailure::Cancelled);}
        if draft.lock().is_ok_and(|d|d.finished()) {Ok(())} else if let Err(error)=outcome {Err(classify(error))} else {Err(RunFailure::InvalidResponse)}
    }.await;
    {
        let mut s = state.lock().await;
        s.trace.elapsed_ms = start.elapsed().as_millis() as u64;
        s.trace.status = if result.is_ok() {
            "completed"
        } else {
            "failed"
        }
        .into();
        let elapsed = s
            .request_started
            .take()
            .map(|t| t.elapsed().as_millis() as u64);
        if let Some(f) = s
            .trace
            .requests
            .last_mut()
            .filter(|f| f.status == "in_flight")
        {
            f.status = "failed_or_cancelled".into();
            f.elapsed_ms = elapsed;
        }
    }
    let result = match hook.save().await {
        Ok(()) => result,
        Err(e) => Err(e),
    };
    let trace = state.lock().await.trace.clone();
    (result, trace)
}

#[cfg(test)]
pub(crate) fn fixture_response(body: &Value, index: usize) -> Value {
    let prompt: Value = serde_json::from_str(
        body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .rev()
            .find(|m| m["role"] == "user")
            .unwrap()["content"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert!(body.get("response_format").is_none());
    let review = prompt["evaluationTask"] == "review";
    assert_eq!(
        body["tools"].as_array().unwrap().len(),
        if review { 1 } else { 3 }
    );
    let args = if review {
        json!({"expectedRevision":prompt["revision"],"issues":[]})
    } else {
        json!({"operationId":"finish","expectedRevision":prompt["revision"],"characters":[],"runs":[{"end":prompt["pieceCount"].as_u64().unwrap()-1,"kind":"n","speaker":"narrator"}]})
    };
    json!({"id":"fixture","object":"chat.completion","model":"test","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":format!("call-{index}"),"type":"function","function":{"name":"finish_analysis","arguments":args.to_string()}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn real_agent_keeps_http_error_categories() {
        for (status, expected) in [
            (401, RunFailure::ConfigurationUnavailable),
            (408, RunFailure::Timeout),
            (429, RunFailure::Unknown),
        ] {
            let server = crate::llm::test_support::Fixture::new(move |_, _, _| {
                (status, json!({"error":{"message":"fixture failure"}}))
            });
            let (_dir, state, selection, _) =
                crate::llm::test_support::configured(&server.endpoint);
            let connection = state.acquire_for_run(&selection).unwrap();
            let model = crate::llm::configured_model(&connection, None).unwrap();
            let draft = agent_core::Draft::analysis("公开合成文本。", vec![], Value::Null).unwrap();
            let (result, trace) = run(
                model,
                draft,
                None,
                &CancellationToken::new(),
                None,
                "analysis",
            )
            .await;
            assert_eq!(result.unwrap_err(), expected);
            assert_eq!(trace.requests.len(), 1);
            assert!(trace.requests[0].usage.is_none());
            assert_eq!(trace.status, "failed");
        }
    }
    #[test]
    fn supplier_timeout_and_tool_failures_keep_distinct_categories() {
        use rig_agent::run::PromptError;
        use rig_core::{
            error::{ErrorKind, ErrorReport},
            tool::ToolErrorKind,
        };
        for (kind, status, expected) in [
            (
                ErrorKind::ProviderResponse,
                Some(401),
                RunFailure::ConfigurationUnavailable,
            ),
            (ErrorKind::Timeout, None, RunFailure::Timeout),
            (ErrorKind::Http, None, RunFailure::Unknown),
            (ErrorKind::ProviderResponse, Some(429), RunFailure::Unknown),
            (
                ErrorKind::Tool(ToolErrorKind::Other),
                None,
                RunFailure::ToolFailed,
            ),
        ] {
            let mut report = ErrorReport::new(kind, "private provider body must not be persisted");
            report.http_status = status;
            assert_eq!(classify(PromptError::Report(report)), expected);
        }
    }
}
