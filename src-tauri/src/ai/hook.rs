//! Shared Rig bookkeeping. Policies own redaction, domain checkpoints and stop decisions.
use super::{AiError, RunFailure, agent::valid_response, dispatch::ToolDispatch, output::Output};
use rig_agent::{
    agent::{
        AgentHook, DispatchAction, DispatchEvent, HookContext, OutcomeAction, OutcomeEvent,
        StepEventKind,
    },
    run::policy::{InvalidToolCallAction, InvalidToolCallContext},
};
use rig_core::completion::{CompletionRequest, Usage};
use serde_json::{Value, json};
use std::{
    future::Future,
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub(crate) struct Hook<P> {
    pub policy: P,
    facts: Option<(Output, ToolDispatch)>,
    token: CancellationToken,
    failure: Arc<Mutex<Option<RunFailure>>>,
}

pub(crate) struct ToolOutcome<'a> {
    pub name: &'a str,
    #[cfg(test)]
    pub args: &'a Value,
    pub value: &'a Value,
    pub failed: bool,
    pub transport_failed: bool,
}

pub(crate) trait Policy: Send + Sync {
    fn terminal(&self) -> bool {
        false
    }

    fn count_request(&self) -> bool {
        true
    }

    fn storage_failure(&self, _: AiError) -> RunFailure {
        RunFailure::StorageFailed
    }

    fn tool_name<'a>(&self, name: &'a str) -> Option<&'a str> {
        Some(name)
    }

    fn tool_input(&self, input: &Value) -> Value {
        input.clone()
    }

    fn invalid_input(&self, _: &InvalidToolCallContext) -> Option<Value> {
        None
    }

    fn before_request(
        &self,
        _: &CompletionRequest,
        _: &[u8],
    ) -> impl Future<Output = Result<(), RunFailure>> + Send {
        async { Ok(()) }
    }

    fn dispatched(&self, _: bool) -> impl Future<Output = Result<(), RunFailure>> + Send {
        async { Ok(()) }
    }

    fn completion(&self, _: Usage, _: bool) -> impl Future<Output = ()> + Send {
        async {}
    }

    fn tool_result(&self, outcome: &ToolOutcome<'_>) -> impl Future<Output = (Value, bool)> + Send {
        async { (outcome.value.clone(), outcome.failed) }
    }

    fn recorded(
        &self,
        _: Option<&ToolOutcome<'_>>,
    ) -> impl Future<Output = Result<Option<&'static str>, RunFailure>> + Send {
        async { Ok(None) }
    }
}

impl<P: Policy> Hook<P> {
    pub(crate) fn new(
        policy: P,
        facts: Option<(Output, ToolDispatch)>,
        token: CancellationToken,
    ) -> Self {
        Self {
            policy,
            facts,
            token,
            failure: Arc::new(Mutex::new(None)),
        }
    }

    pub(crate) fn failure(&self) -> Option<RunFailure> {
        self.failure
            .lock()
            .map_or(Some(RunFailure::StorageFailed), |value| *value)
    }

    fn fail(&self, error: RunFailure) {
        if let Ok(mut failure) = self.failure.lock() {
            *failure = Some(error);
        }
    }

    async fn dispatch(&self, event: DispatchEvent<'_>) -> Result<(), RunFailure> {
        let mut tool = false;
        if let Some(request) = event.completion_request()
            && self.policy.count_request()
        {
            let bytes = serde_json::to_vec(request).map_err(|_| RunFailure::InvalidResponse)?;
            self.policy.before_request(request, &bytes).await?;
            if let Some((output, _)) = &self.facts {
                let len = bytes
                    .len()
                    .try_into()
                    .map_err(|_| RunFailure::BudgetExhausted)?;
                output
                    .start(len)
                    .await
                    .map_err(|e| self.policy.storage_failure(e))?;
            }
        } else if let Some(name) = event
            .tool_name()
            .and_then(|name| self.policy.tool_name(name))
        {
            let args = event
                .tool_args()
                .and_then(|args| serde_json::from_str(args).ok())
                .ok_or(RunFailure::ToolFailed)?;
            if let Some((output, dispatch)) = &self.facts {
                let message = output
                    .id()
                    .await
                    .map_err(|e| self.policy.storage_failure(e))?;
                let id = event.call_id.map(ToString::to_string).unwrap_or_default();
                dispatch
                    .begin(&message, &id, name, self.policy.tool_input(&args))
                    .await
                    .map_err(|e| self.policy.storage_failure(e))?;
            }
            tool = true;
        }
        self.policy.dispatched(tool).await
    }

    async fn outcome(&self, event: OutcomeEvent<'_>) -> Result<Option<&'static str>, RunFailure> {
        let mut invalid = false;
        if let Some(response) = event.completion() {
            if let Some((output, _)) = &self.facts {
                output
                    .usage(&response.usage)
                    .await
                    .map_err(|e| self.policy.storage_failure(e))?;
            }
            invalid = !valid_response(response);
            self.policy.completion(response.usage, invalid).await;
        }
        let tool_stop = if let Some(name) = event
            .tool_name()
            .and_then(|name| self.policy.tool_name(name))
        {
            let args = event
                .tool_args()
                .and_then(|args| serde_json::from_str(args).ok())
                .ok_or(RunFailure::ToolFailed)?;
            let result = event.tool_result();
            let transport_failed = result.is_none_or(|result| result.is_error());
            let value = result
                .and_then(|result| result.output().as_json())
                .unwrap_or(&Value::Null);
            let failed = transport_failed || value["ok"] == false;
            let outcome = ToolOutcome {
                name,
                #[cfg(test)]
                args: &args,
                value,
                failed,
                transport_failed,
            };
            let (output, failed) = self.policy.tool_result(&outcome).await;
            if let Some((_, dispatch)) = &self.facts {
                let id = event.call_id.map(ToString::to_string).unwrap_or_default();
                dispatch
                    .complete(&id, name, &self.policy.tool_input(&args), output, failed)
                    .await
                    .map_err(|e| self.policy.storage_failure(e))?;
            }
            self.policy.recorded(Some(&outcome)).await?
        } else {
            self.policy.recorded(None).await?
        };
        if invalid {
            return Err(RunFailure::InvalidResponse);
        }
        Ok(tool_stop.or_else(|| self.policy.terminal().then_some("domain_terminal")))
    }
}

impl<P: Policy> AgentHook for Hook<P> {
    fn observes(&self, kind: StepEventKind) -> bool {
        matches!(
            kind,
            StepEventKind::CompletionDispatch
                | StepEventKind::ToolDispatch
                | StepEventKind::InvalidToolCall
        )
    }

    async fn on_dispatch(&self, _: &HookContext, event: DispatchEvent<'_>) -> DispatchAction {
        if self.token.is_cancelled() {
            return DispatchAction::stop("cancelled");
        }
        if self.policy.terminal() {
            return DispatchAction::stop("domain_terminal");
        }
        match self.dispatch(event).await {
            Ok(()) => DispatchAction::proceed(),
            Err(error) => {
                self.fail(error);
                DispatchAction::stop("execution_rejected")
            }
        }
    }

    async fn on_invalid_tool_call(
        &self,
        _: &HookContext,
        event: &InvalidToolCallContext,
    ) -> Option<InvalidToolCallAction> {
        let input = self.policy.invalid_input(event)?;
        let result = async {
            if let Some((output, dispatch)) = &self.facts {
                let name = self
                    .policy
                    .tool_name(&event.tool_name)
                    .ok_or(AiError::InvalidRequest)?;
                let id = event
                    .tool_call_id
                    .as_ref()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                dispatch
                    .begin(&output.id().await?, &id, name, input.clone())
                    .await?;
                dispatch
                    .complete(
                        &id,
                        name,
                        &input,
                        json!({"error":"invalid_tool_call"}),
                        true,
                    )
                    .await?;
            }
            Ok::<(), AiError>(())
        }
        .await;
        self.fail(
            result
                .err()
                .map_or(RunFailure::ToolFailed, |e| self.policy.storage_failure(e)),
        );
        Some(InvalidToolCallAction::stop("invalid_tool_call"))
    }

    async fn on_outcome(&self, _: &HookContext, event: OutcomeEvent<'_>) -> OutcomeAction {
        match self.outcome(event).await {
            Ok(Some(reason)) => OutcomeAction::stop(reason),
            Ok(None) => OutcomeAction::proceed(),
            Err(error) => {
                self.fail(error);
                OutcomeAction::stop("outcome_rejected")
            }
        }
    }
}
