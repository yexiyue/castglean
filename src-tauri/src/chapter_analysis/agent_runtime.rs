//! Native Rig execution shared by production and the no-write evaluation entry.
use super::agent_core::{self, SharedDraft};
use crate::ai::{
    RunFailure,
    agent::{Role, Subagent},
    dispatch::ToolDispatch,
    hook::{Hook, Policy, ToolOutcome},
    output::Output,
    runs::Lease,
};
use rig_agent::{agent::AgentBuilder, run::policy::InvalidToolCallContext};
use rig_core::{
    DynModel,
    completion::{CompletionRequest, Usage},
    operation::Completion,
};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{sync::Arc, time::Instant};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub(super) const PROTOCOL: &str = "chapter-attribution/1";

#[derive(Clone)]
pub(super) struct Persistence {
    pub db: DatabaseConnection,
    pub lease: Lease,
    pub dependencies: super::types::Dependencies,
    pub output: Output,
    pub dispatch: ToolDispatch,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum RequestStatus {
    InFlight,
    Completed,
    InvalidResponse,
    FailedOrCancelled,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum TraceStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RequestFact {
    pub input_hash: String,
    pub input_bytes: usize,
    pub tool_schema_hash: String,
    pub offered_tools: usize,
    pub elapsed_ms: Option<u64>,
    pub usage: Option<Usage>,
    pub status: RequestStatus,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Trace {
    pub id: String,
    pub protocol: String,
    pub stage: String,
    pub prompt_hash: String,
    pub requests: Vec<RequestFact>,
    pub elapsed_ms: u64,
    pub status: TraceStatus,
    pub run_id: Option<String>,
    pub started_at_ms: u64,
    pub observed_at_ms: u64,
}
struct State {
    trace: Trace,
    request_started: Option<Instant>,
    tool_started: Option<Instant>,
}
#[derive(Clone)]
struct AnalysisPolicy {
    draft: SharedDraft,
    state: Arc<Mutex<State>>,
    persist: Option<Persistence>,
}
pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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
impl Policy for AnalysisPolicy {
    fn terminal(&self) -> bool {
        self.draft.lock().is_ok_and(|draft| draft.terminal())
    }

    fn tool_name<'a>(&self, name: &'a str) -> Option<&'a str> {
        Some(safe_tool_name(name))
    }

    fn tool_input(&self, input: &Value) -> Value {
        summary(input)
    }

    fn invalid_input(&self, event: &InvalidToolCallContext) -> Option<Value> {
        Some(summary(&json!(event.args)))
    }

    async fn before_request(
        &self,
        request: &CompletionRequest,
        bytes: &[u8],
    ) -> Result<(), RunFailure> {
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
        }
        let mut state = self.state.lock().await;
        state.trace.requests.push(RequestFact {
            input_hash: crate::project::hash(bytes),
            input_bytes: bytes.len(),
            tool_schema_hash: crate::project::hash(&tool_bytes),
            offered_tools: request.tools.len(),
            elapsed_ms: None,
            usage: None,
            status: RequestStatus::InFlight,
        });
        state.request_started = Some(Instant::now());
        Ok(())
    }

    async fn dispatched(&self, tool: bool) -> Result<(), RunFailure> {
        if tool {
            self.state.lock().await.tool_started = Some(Instant::now());
        }
        Ok(())
    }

    async fn completion(&self, usage: Usage, invalid: bool) {
        let mut state = self.state.lock().await;
        let elapsed = state
            .request_started
            .take()
            .map(|t| t.elapsed().as_millis() as u64);
        if let Some(request) = state.trace.requests.last_mut() {
            request.elapsed_ms = elapsed;
            request.usage = Some(usage);
            request.status = if invalid {
                RequestStatus::InvalidResponse
            } else {
                RequestStatus::Completed
            };
        }
    }

    async fn tool_result(&self, outcome: &ToolOutcome<'_>) -> (Value, bool) {
        let elapsed = self
            .state
            .lock()
            .await
            .tool_started
            .take()
            .map(|t| t.elapsed().as_millis() as u64);
        let value = outcome.value;
        let error = value.get("error").and_then(Value::as_str).filter(|code| {
            code.len() < 100 && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        });
        // Keep raw source text in the model loop, outside persisted observations.
        let observation = json!({
            "result": summary(value), "elapsedMs": elapsed, "ok": value.get("ok"), "error": error,
        });
        (observation, outcome.failed)
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
    let mut invocation = None;
    let mut setup_failed = false;
    let persist = if stage == "review" {
        if let Some(mut persistence) = persist {
            match crate::ai::invocations::begin(&persistence.db, &persistence.lease, "review").await
            {
                Ok(lease) => {
                    persistence.lease = lease.clone();
                    match Output::resume(persistence.db.clone(), lease.clone()).await {
                        Ok(output) => persistence.output = output,
                        Err(_) => setup_failed = true,
                    }
                    persistence.dispatch = ToolDispatch::new(persistence.db.clone(), lease.clone());
                    invocation = Some((persistence.db.clone(), lease));
                }
                Err(_) => setup_failed = true,
            }
            Some(persistence)
        } else {
            None
        }
    } else {
        persist
    };
    let persist = persist.map(|mut persistence| {
        persistence.dispatch = persistence.dispatch.for_agent();
        persistence
    });
    let start = Instant::now();
    let state = Arc::new(Mutex::new(State {
        trace: Trace {
            id: uuid::Uuid::new_v4().to_string(),
            protocol: PROTOCOL.into(),
            stage: stage.into(),
            prompt_hash: crate::project::hash(agent_core::prompt().as_bytes()),
            requests: vec![],
            elapsed_ms: 0,
            status: TraceStatus::Running,
            run_id: persist.as_ref().map(|p| p.lease.run_id().to_owned()),
            started_at_ms: now_ms(),
            observed_at_ms: now_ms(),
        },
        request_started: None,
        tool_started: None,
    }));
    let facts = persist
        .as_ref()
        .map(|p| (p.output.clone(), p.dispatch.clone()));
    let output = facts.as_ref().map(|(output, _)| output.clone());
    let hook = Hook::new(
        AnalysisPolicy {
            draft: draft.clone(),
            state: state.clone(),
            persist,
        },
        facts,
        token.clone(),
    );
    let result = async {
        if setup_failed {
            return Err(RunFailure::StorageFailed);
        }
        let input = draft
            .lock()
            .map_err(|_| RunFailure::InvalidResponse)?
            .input()
            .to_string();
        let builder = AgentBuilder::new(model).preamble(agent_core::prompt());
        #[cfg(test)]
        let builder = if let Ok(experiment) = crate::ai::efficiency::CURRENT.try_with(Arc::clone) {
            builder.add_hook(experiment.hook(if stage == "review" {
                "review"
            } else {
                "attribution"
            }))
        } else {
            builder
        };
        let builder = agent_core::register_tools(builder.add_hook(hook.clone()), draft.clone())
            .map_err(|_| RunFailure::ToolFailed)?;
        let role = if stage == "review" {
            Role::Review
        } else {
            Role::Attribution
        };
        let agent = Subagent::new(builder, role, max_output);
        let outcome = match &output {
            Some(output) => agent.stream(input, vec![], output, token).await,
            None => agent.run(input, token).await,
        };
        if let Some(error) = hook.failure() {
            return Err(error);
        }
        if token.is_cancelled() {
            return Err(RunFailure::Cancelled);
        }
        outcome?;
        if draft.lock().is_ok_and(|d| d.finished()) {
            Ok(())
        } else {
            Err(RunFailure::InvalidResponse)
        }
    }
    .await;
    {
        let mut s = state.lock().await;
        s.trace.elapsed_ms = start.elapsed().as_millis() as u64;
        s.trace.status = if result.is_ok() {
            TraceStatus::Completed
        } else {
            TraceStatus::Failed
        };
        let elapsed = s
            .request_started
            .take()
            .map(|t| t.elapsed().as_millis() as u64);
        if let Some(f) = s
            .trace
            .requests
            .last_mut()
            .filter(|f| f.status == RequestStatus::InFlight)
        {
            f.status = RequestStatus::FailedOrCancelled;
            f.elapsed_ms = elapsed;
        }
    }
    let result = if let Some((db, lease)) = invocation {
        match crate::ai::invocations::finish(&db, &lease, &result).await {
            Ok(()) => result,
            Err(_) => Err(RunFailure::StorageFailed),
        }
    } else {
        result
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
            let model = crate::llm::configured_model(&connection, None, None).unwrap();
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
            assert_eq!(trace.status, TraceStatus::Failed);
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
            assert_eq!(
                crate::ai::failure::prompt(PromptError::Report(report)),
                expected
            );
        }
    }
}
