//! Test-only, explicit task-efficiency experiments. No application defaults or user database writes.
use super::RunFailure;
use rig_agent::agent::{
    AgentHook, DispatchAction, DispatchEvent, HookContext, OutcomeAction, OutcomeEvent,
};
use rig_core::completion::Usage;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Profile {
    Atomic,
    #[default]
    Batch,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    stage: &'static str,
    input_hash: String,
    tool_schema_hash: String,
    input_bytes: usize,
    elapsed_ms: Option<u64>,
    usage: Option<Usage>,
    complete: bool,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct State {
    requests: Vec<Request>,
    continuations: Vec<Continuation>,
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Continuation {
    stage: &'static str,
    reason: &'static str,
    run_id: String,
    tool: String,
    input_hash: String,
}
pub(crate) struct Experiment {
    pub profile: Profile,
    state: Mutex<State>,
    path: Option<PathBuf>,
}
impl Experiment {
    pub fn new(profile: Profile, path: Option<PathBuf>) -> Arc<Self> {
        Arc::new(Self {
            profile,
            state: Mutex::new(State::default()),
            path,
        })
    }
    pub fn snapshot(&self) -> serde_json::Value {
        let s = self.state.lock().unwrap();
        let total = |field: fn(&Usage) -> Option<u64>| {
            s.requests
                .iter()
                .try_fold(0u64, |sum, r| sum.checked_add(field(r.usage.as_ref()?)?))
        };
        serde_json::json!({"profile":self.profile,"requests":s.requests,"continuations":s.continuations,
            "error":s.error,"requestCount":s.requests.len(),"inputTokens":total(|u|u.input_tokens),
            "outputTokens":total(|u|u.output_tokens),"cachedInputTokens":total(|u|u.cached_input_tokens)})
    }
    fn save(&self) -> Result<(), RunFailure> {
        if let Some(path) = &self.path {
            crate::atomic_json::save(path, &self.snapshot(), Some(4 * 1024 * 1024))
                .map_err(|_| RunFailure::StorageFailed)?;
        }
        Ok(())
    }
    pub fn continuation(
        &self,
        stage: &'static str,
        reason: &'static str,
        run_id: &str,
        tool: &str,
        args: &serde_json::Value,
    ) -> Result<(), RunFailure> {
        self.state.lock().unwrap().continuations.push(Continuation {
            stage,
            reason,
            run_id: run_id.into(),
            tool: tool.into(),
            input_hash: crate::project::hash(
                &serde_json::to_vec(args).map_err(|_| RunFailure::InvalidResponse)?,
            ),
        });
        self.save()
    }
    pub fn hook(self: &Arc<Self>, stage: &'static str) -> Probe {
        Probe {
            experiment: self.clone(),
            stage,
            request: Arc::new(Mutex::new(None)),
        }
    }
}
#[derive(Clone)]
pub(crate) struct Probe {
    experiment: Arc<Experiment>,
    stage: &'static str,
    request: Arc<Mutex<Option<(usize, Instant)>>>,
}
impl AgentHook for Probe {
    async fn on_dispatch(&self, _: &HookContext, event: DispatchEvent<'_>) -> DispatchAction {
        if let Some(request) = event.completion_request() {
            let Ok(bytes) = serde_json::to_vec(request) else {
                return DispatchAction::stop("experiment_encoding");
            };
            let Ok(tools) = serde_json::to_vec(&request.tools) else {
                return DispatchAction::stop("experiment_encoding");
            };
            let mut state = self.experiment.state.lock().unwrap();
            // Common experimental request guard; never a token limit or a successful delivery.
            if state.requests.len() >= 24 {
                state.error = Some("experimental_request_guard".into());
                return DispatchAction::stop("experimental_request_guard");
            }
            let index = state.requests.len();
            state.requests.push(Request {
                stage: self.stage,
                input_hash: crate::project::hash(&bytes),
                tool_schema_hash: crate::project::hash(&tools),
                input_bytes: bytes.len(),
                elapsed_ms: None,
                usage: None,
                complete: false,
            });
            *self.request.lock().unwrap() = Some((index, Instant::now()));
            drop(state);
            if self.experiment.save().is_err() {
                return DispatchAction::stop("experiment_storage");
            }
        }
        DispatchAction::proceed()
    }
    async fn on_outcome(&self, _: &HookContext, event: OutcomeEvent<'_>) -> OutcomeAction {
        if event.tool_name().is_none() {
            if let Some((index, start)) = self.request.lock().unwrap().take() {
                let mut state = self.experiment.state.lock().unwrap();
                let r = &mut state.requests[index];
                r.elapsed_ms = Some(start.elapsed().as_millis() as u64);
                r.usage = event.completion().map(|r| r.usage);
                r.complete = event.completion().is_some_and(super::agent::valid_response);
            }
            if self.experiment.save().is_err() {
                return OutcomeAction::stop("experiment_storage");
            }
        }
        OutcomeAction::proceed()
    }
}
tokio::task_local! { pub(crate) static CURRENT: Arc<Experiment>; }
mod bridge;
