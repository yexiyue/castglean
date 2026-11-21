//! Drives the root conversation at restartable model and tool boundaries.
use super::{
    AssistantPolicy, Scope, WorkspaceTools,
    compaction::{self, Compactor, Summary},
};
use crate::ai::{
    RunFailure,
    agent::valid_response,
    failure,
    hook::{Policy, ToolOutcome},
    output::{Cursor, Output},
    runs,
};
use crate::database::entity::ai_run;
use futures_util::StreamExt;
use rig_agent::run::{
    AgentRun, AgentRunStep, ExecCall, ModelTurn, ModelTurnOutcome, PendingToolCall,
    prepare::{PreparedRequest, prepare_request},
    spec::RunSpec,
};
use rig_core::{
    DynModel,
    completion::{CompletionRequest, CompletionResponse},
    message::Message,
    operation::Completion,
    streaming::{Item, StreamEvent},
    tool::{ToolContext, ToolOutput, ToolResult},
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, TransactionTrait, sea_query::Expr};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Deserialize, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum Checkpoint<R, P> {
    Running {
        run: R,
        preamble: P,
        rewind: Option<Cursor>,
    },
    RejectedTool {
        name: String,
        identity: String,
        input: Value,
    },
    Finished,
}

pub(super) struct Driver<'a> {
    tools: &'a WorkspaceTools,
    output: &'a Output,
    model: DynModel<Completion>,
    policy: AssistantPolicy,
    context_window: Option<u32>,
    #[cfg(test)]
    probe: Option<crate::ai::efficiency::Probe>,
}

impl<'a> Driver<'a> {
    pub(super) fn new(
        tools: &'a WorkspaceTools,
        output: &'a Output,
        model: DynModel<Completion>,
        policy: AssistantPolicy,
        context_window: Option<u32>,
    ) -> Self {
        Self {
            tools,
            output,
            model,
            policy,
            context_window,
            #[cfg(test)]
            probe: tools.experiment.as_ref().map(|e| e.hook("assistant")),
        }
    }

    pub(super) async fn start(
        self,
        spec: RunSpec,
        prompt: Message,
        history: Vec<Message>,
    ) -> Result<(), RunFailure> {
        let history = history.into_iter().map(Arc::new).collect();
        let run = AgentRun::from_spec(&spec, prompt, Some(history));
        self.drive(run, spec).await
    }

    pub(super) async fn resume(
        self,
        value: &str,
        max_output_tokens: Option<u32>,
    ) -> Result<(), RunFailure> {
        match serde_json::from_str::<Checkpoint<Box<AgentRun>, String>>(value)
            .map_err(|_| RunFailure::StorageFailed)?
        {
            Checkpoint::Finished => self
                .output
                .complete()
                .await
                .map_err(|e| self.policy.storage_failure(e)),
            Checkpoint::RejectedTool {
                name,
                identity,
                input,
            } => self.record_invalid_tool(&name, &identity, input).await,
            Checkpoint::Running {
                run,
                preamble,
                rewind,
            } => {
                if let Some(cursor) = rewind {
                    self.output
                        .rewind(cursor)
                        .await
                        .map_err(|e| self.policy.storage_failure(e))?;
                }
                let spec = spec(preamble, max_output_tokens);
                self.drive(*run, spec).await
            }
        }
    }

    async fn save(&self, checkpoint: Checkpoint<&AgentRun, &str>) -> Result<(), RunFailure> {
        let value = serde_json::to_string(&checkpoint).map_err(|_| RunFailure::StorageFailed)?;
        if value.len() > 64 * 1024 * 1024 {
            return Err(RunFailure::BudgetExhausted);
        }
        let tx = self
            .tools
            .db
            .begin()
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::lock(&tx, &self.tools.lease, false)
            .await
            .map_err(|e| self.policy.storage_failure(e))?;
        ai_run::Entity::update_many()
            .col_expr(ai_run::Column::AgentCheckpoint, Expr::value(value))
            .filter(ai_run::Column::Id.eq(self.tools.lease.run_id()))
            .exec(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        tx.commit().await.map_err(|_| RunFailure::StorageFailed)
    }

    async fn save_run(
        &self,
        run: &AgentRun,
        preamble: &str,
        rewind: Option<Cursor>,
    ) -> Result<(), RunFailure> {
        self.save(Checkpoint::Running {
            run,
            preamble,
            rewind,
        })
        .await
    }

    async fn drive(&self, mut run: AgentRun, spec: RunSpec) -> Result<(), RunFailure> {
        let server = self.tools.tool_server(Some(Scope::Project));
        let toolset = server.toolset();
        let definitions = server.snapshot();
        let preamble = spec.preamble.as_deref().unwrap_or_default();
        let mut summary = Summary::load(&self.tools.db, &self.tools.lease).await?;
        let compactor = Compactor {
            db: &self.tools.db,
            lease: &self.tools.lease,
            model: &self.model,
            token: &self.tools.token,
            window: self.context_window,
            #[cfg(test)]
            probe: self.probe.as_ref(),
        };
        let mut automatic = true;
        loop {
            if self.tools.token.is_cancelled() {
                return Err(RunFailure::Cancelled);
            }
            match run.next_step().map_err(failure::prompt)? {
                AgentRunStep::CallModel {
                    prompt,
                    history,
                    turn,
                } => {
                    let prepare =
                        |summary: Option<&Summary>| -> Result<PreparedRequest, RunFailure> {
                            let projected = summary
                                .map(|state| state.project(&history, &prompt))
                                .transpose()?;
                            prepare_request(
                                &spec,
                                &self.model.capabilities().completion,
                                (*prompt).clone(),
                                projected.as_deref().unwrap_or(&history),
                                definitions.definitions().to_vec(),
                                None,
                                None,
                            )
                            .map_err(|e| failure::provider(crate::llm::provider_failure(e)))
                        };
                    let mut prepared = prepare(summary.as_ref())?;
                    run.advertise_tools(turn, prepared.request.tools.clone());
                    let cursor = self
                        .output
                        .cursor()
                        .await
                        .map_err(|e| self.policy.storage_failure(e))?;
                    self.save_run(&run, preamble, Some(cursor)).await?;
                    if automatic
                        && let Some(window) = self.context_window
                        && compaction::should_compact(&prepared.request, window, spec.max_tokens)
                    {
                        match compactor
                            .compact(run.input_chat_history(), summary.as_ref(), false)
                            .await
                        {
                            Ok(Some(updated)) => {
                                summary = Some(updated);
                                prepared = prepare(summary.as_ref())?;
                            }
                            Ok(None)
                            | Err(
                                RunFailure::InvalidResponse
                                | RunFailure::Timeout
                                | RunFailure::Unknown,
                            ) => {
                                automatic = false;
                            }
                            Err(error) => return Err(error),
                        }
                    }
                    let PreparedRequest {
                        request, policy, ..
                    } = prepared;
                    let response = self.complete_model(request).await?;
                    let mut model_turn = ModelTurn::from_policy(&response, policy);
                    // The canonical message and normalized identity suffice for replay.
                    model_turn.raw = Value::Null;
                    match run.model_response(model_turn).map_err(failure::prompt)? {
                        ModelTurnOutcome::Continue { .. } => {}
                        ModelTurnOutcome::NeedsResolution(invalid) => {
                            return self.invalid_tool(&invalid, turn).await;
                        }
                        ModelTurnOutcome::TurnRetried => return Err(RunFailure::InvalidResponse),
                    }
                    self.save_run(&run, preamble, None).await?;
                }
                AgentRunStep::CallTools { calls } => {
                    for pending in calls {
                        let call = match pending {
                            PendingToolCall::Execute(call) => call,
                            PendingToolCall::Malformed(call) => {
                                let invalid = run.malformed_context(&call, true);
                                return self.invalid_tool(&invalid, run.turn()).await;
                            }
                            _ => return Err(RunFailure::ToolFailed),
                        };
                        let name = call.name().to_string();
                        #[cfg(test)]
                        let args = call.arguments();
                        let (value, failed) = self.tool(&toolset, &call, run.turn()).await?;
                        let stop = self
                            .policy
                            .recorded(Some(&ToolOutcome {
                                name: &name,
                                #[cfg(test)]
                                args: &args,
                                value: &value,
                                failed,
                                transport_failed: false,
                            }))
                            .await?
                            .is_some();
                        run.answer(call.answer(ToolResult::success(ToolOutput::json(value))))
                            .map_err(failure::prompt)?;
                        if stop {
                            return self.finish().await;
                        }
                        self.save_run(&run, preamble, None).await?;
                    }
                }
                AgentRunStep::Done(_) => return self.finish().await,
            }
        }
    }

    async fn finish(&self) -> Result<(), RunFailure> {
        self.save(Checkpoint::Finished).await?;
        self.output
            .complete()
            .await
            .map_err(|e| self.policy.storage_failure(e))
    }

    async fn invalid_tool(
        &self,
        invalid: &rig_agent::run::policy::InvalidToolCallContext,
        turn: usize,
    ) -> Result<(), RunFailure> {
        let name = super::tools::safe_name(&invalid.tool_name);
        let provider_id = invalid.tool_call_id.as_ref().map(ToString::to_string);
        let identity = tool_identity(turn, provider_id.as_deref().unwrap_or("invalid"));
        let input = self
            .policy
            .invalid_input(invalid)
            .ok_or(RunFailure::ToolFailed)?;
        // Persist the decision before reserving the receipt so recovery cannot
        // rewind to the model call after the rejected attempt has been charged.
        self.save(Checkpoint::RejectedTool {
            name: name.to_owned(),
            identity: identity.clone(),
            input: input.clone(),
        })
        .await?;
        self.record_invalid_tool(name, &identity, input).await
    }

    async fn record_invalid_tool(
        &self,
        name: &str,
        identity: &str,
        input: Value,
    ) -> Result<(), RunFailure> {
        let message_id = self
            .output
            .id()
            .await
            .map_err(|e| self.policy.storage_failure(e))?;
        let dispatch = &self.tools.dispatch;
        if dispatch
            .begin_or_replay(&message_id, identity, name, input.clone())
            .await
            .map_err(|e| self.policy.storage_failure(e))?
            .is_none()
        {
            dispatch
                .complete(
                    identity,
                    name,
                    &input,
                    json!({"error":"invalid_tool_call"}),
                    true,
                )
                .await
                .map_err(|e| self.policy.storage_failure(e))?;
        }
        #[cfg(test)]
        let _ = BEFORE_ANSWER.try_with(|failpoint| failpoint());
        Err(RunFailure::ToolFailed)
    }

    async fn tool(
        &self,
        toolset: &rig_agent::tool::ToolSet,
        call: &ExecCall,
        turn: usize,
    ) -> Result<(Value, bool), RunFailure> {
        if self.tools.token.is_cancelled() {
            return Err(RunFailure::Cancelled);
        }
        let name = call.name().as_str();
        let args = call.arguments();
        let identity = tool_identity(turn, &call.tool_call().id.to_string());
        let message_id = self
            .output
            .id()
            .await
            .map_err(|e| self.policy.storage_failure(e))?;
        let dispatch = &self.tools.dispatch;
        if let Some(saved) = dispatch
            .begin_or_replay(&message_id, &identity, name, args.clone())
            .await
            .map_err(|e| self.policy.storage_failure(e))?
        {
            return Ok(saved);
        }
        let tool = toolset.get(name).ok_or(RunFailure::ToolFailed)?;
        let result = tool
            .execute(args.to_string(), &mut ToolContext::default())
            .await;
        let (value, failed) = match result.output().as_json().filter(|_| !result.is_error()) {
            Some(value) => (value.clone(), value["ok"] == false),
            None => (json!({"error":"tool_failed"}), true),
        };
        dispatch
            .complete(&identity, name, &args, value.clone(), failed)
            .await
            .map_err(|e| self.policy.storage_failure(e))?;
        #[cfg(test)]
        let _ = BEFORE_ANSWER.try_with(|failpoint| failpoint());
        Ok((value, failed))
    }

    async fn complete_model(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, RunFailure> {
        #[cfg(test)]
        if let Some(probe) = &self.probe {
            probe.started(&request).await?;
        }
        let bytes = serde_json::to_vec(&request).map_err(|_| RunFailure::InvalidResponse)?;
        self.output
            .start(
                bytes
                    .len()
                    .try_into()
                    .map_err(|_| RunFailure::BudgetExhausted)?,
            )
            .await
            .map_err(|e| self.policy.storage_failure(e))?;
        let result = self.stream(request).await;
        #[cfg(test)]
        if let Some(probe) = &self.probe {
            probe.completed(result.as_ref().ok()).await?;
        }
        let response = result?;
        self.output
            .usage(&response.usage)
            .await
            .map_err(|e| self.policy.storage_failure(e))?;
        if !valid_response(&response) || response.cut_off_calls().next().is_some() {
            return Err(RunFailure::InvalidResponse);
        }
        Ok(response)
    }

    async fn stream(&self, request: CompletionRequest) -> Result<CompletionResponse, RunFailure> {
        let provider_failure = |e| failure::provider(crate::llm::provider_failure(e));
        let mut stream = self.model.stream(request).map_err(provider_failure)?;
        let mut text = String::new();
        let mut reasoning = String::new();
        let mut flushed = Instant::now();
        loop {
            let item = tokio::select! {
                biased;
                () = self.tools.token.cancelled() => return Err(RunFailure::Cancelled),
                item = stream.next() => item,
            };
            match item.transpose().map_err(provider_failure)? {
                Some(Item::Event(StreamEvent::Text { text: delta, .. })) => text.push_str(&delta),
                Some(Item::Event(StreamEvent::Reasoning { text: delta, .. })) => {
                    reasoning.push_str(&delta)
                }
                Some(_) => {}
                None => break,
            }
            if text.len() + reasoning.len() >= 4096
                || flushed.elapsed() >= Duration::from_millis(100)
            {
                self.flush(&reasoning, &text).await?;
                text.clear();
                reasoning.clear();
                flushed = Instant::now();
            }
        }
        self.flush(&reasoning, &text).await?;
        tokio::select! {
            biased;
            () = self.tools.token.cancelled() => Err(RunFailure::Cancelled),
            response = stream.finish() => response.map_err(provider_failure),
        }
    }

    async fn flush(&self, reasoning: &str, text: &str) -> Result<(), RunFailure> {
        self.output
            .reasoning(reasoning)
            .await
            .map_err(|e| self.policy.storage_failure(e))?;
        self.output
            .text(text)
            .await
            .map_err(|e| self.policy.storage_failure(e))
    }
}

fn tool_identity(turn: usize, call_id: &str) -> String {
    format!("{turn}:{}", crate::project::hash(call_id.as_bytes()))
}

pub(super) fn spec(preamble: String, max_output_tokens: Option<u32>) -> RunSpec {
    let mut spec = RunSpec::new();
    spec.preamble = Some(preamble);
    spec.max_tokens = max_output_tokens.map(u64::from);
    spec.max_turns = Some(usize::MAX);
    spec
}

#[cfg(test)]
tokio::task_local! {
    pub(super) static BEFORE_ANSWER: fn();
}
