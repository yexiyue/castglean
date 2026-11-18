//! Independent Rig runs. Domain hooks retain accounting, checkpoints and publication.
use super::{RunFailure, failure, output::Output};
use futures_util::StreamExt;
use rig_agent::agent::{Agent, AgentBuilder, AgentRunner, MultiTurnStreamItem};
use rig_core::{
    completion::CompletionResponse,
    message::Message,
    streaming::{Item, StreamEvent},
};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

/// These are execution roles, not separate conversations or background workers.
#[derive(Clone, Copy)]
pub(crate) enum Role {
    Assistant,
    Splitting,
    Attribution,
    Casting,
    Review,
}

pub(crate) struct Subagent {
    agent: Agent,
    role: Role,
}
impl Subagent {
    pub(crate) fn new(builder: AgentBuilder, role: Role, max_output: Option<u32>) -> Self {
        let builder = builder.record_content_telemetry(false);
        let builder = match max_output {
            Some(tokens) => builder.max_tokens(u64::from(tokens)),
            None => builder,
        };
        Self {
            agent: builder.build(),
            role,
        }
    }

    fn runner(&self, prompt: impl Into<Message>, history: Vec<Message>) -> AgentRunner {
        let runner = self
            .agent
            .prompt(prompt)
            .history(history)
            .tool_concurrency(1)
            .max_invalid_tool_call_retries(0);
        match self.role {
            Role::Assistant | Role::Splitting => runner.max_turns(usize::MAX),
            // Domain draft tools also enforce their own tool/repair bounds.
            Role::Attribution | Role::Casting | Role::Review => runner
                .max_turns(40)
                .max_consecutive_malformed_tool_calls(Some(0)),
        }
    }

    pub(crate) async fn run(
        &self,
        prompt: impl Into<Message>,
        token: &CancellationToken,
    ) -> Result<(), RunFailure> {
        self.run_with_history(prompt, vec![], token).await
    }

    pub(crate) async fn run_with_history(
        &self,
        prompt: impl Into<Message>,
        history: Vec<Message>,
        token: &CancellationToken,
    ) -> Result<(), RunFailure> {
        tokio::select! {
            biased;
            () = token.cancelled() => Err(RunFailure::Cancelled),
            result = self.runner(prompt, history).run() => result.map(|_| ()).map_err(failure::prompt),
        }
    }

    /// Persists visible text only. The task owner decides when a reply is complete.
    pub(crate) async fn stream(
        &self,
        prompt: impl Into<Message>,
        history: Vec<Message>,
        output: &Output,
        token: &CancellationToken,
    ) -> Result<(), RunFailure> {
        let mut stream = self.runner(prompt, history).stream();
        let mut buffer = String::new();
        let mut reasoning = String::new();
        let mut flushed = Instant::now();
        let mut finalized = false;
        loop {
            let item = tokio::select! {
                biased;
                () = token.cancelled() => return Err(RunFailure::Cancelled),
                item = stream.next() => item,
            };
            let Some(item) = item else { break };
            match item.map_err(failure::prompt)? {
                MultiTurnStreamItem::StreamAssistantItem(Item::Event(StreamEvent::Text {
                    text,
                    ..
                })) => {
                    buffer.push_str(&text);
                    if buffer.len() >= 4096 || flushed.elapsed() >= Duration::from_millis(100) {
                        output
                            .text(&std::mem::take(&mut buffer))
                            .await
                            .map_err(|_| RunFailure::StorageFailed)?;
                        flushed = Instant::now();
                    }
                }
                MultiTurnStreamItem::StreamAssistantItem(Item::Event(StreamEvent::Reasoning {
                    text,
                    ..
                })) => {
                    reasoning.push_str(&text);
                    if reasoning.len() >= 4096 || flushed.elapsed() >= Duration::from_millis(100) {
                        output
                            .reasoning(&std::mem::take(&mut reasoning))
                            .await
                            .map_err(|_| RunFailure::StorageFailed)?;
                        flushed = Instant::now();
                    }
                }
                MultiTurnStreamItem::StreamAssistantItem(Item::Event(StreamEvent::End {
                    ..
                })) => {
                    output
                        .reasoning(&std::mem::take(&mut reasoning))
                        .await
                        .map_err(|_| RunFailure::StorageFailed)?;
                    output
                        .text(&std::mem::take(&mut buffer))
                        .await
                        .map_err(|_| RunFailure::StorageFailed)?;
                }
                MultiTurnStreamItem::FinalResponse(_) => finalized = true,
                _ => {}
            }
        }
        if token.is_cancelled() {
            return Err(RunFailure::Cancelled);
        }
        if !finalized {
            return Err(RunFailure::InvalidResponse);
        }
        output
            .reasoning(&reasoning)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        output
            .text(&buffer)
            .await
            .map_err(|_| RunFailure::StorageFailed)
    }
}

pub(crate) fn valid_response(response: &CompletionResponse) -> bool {
    response.error.is_none()
        && response.aborted.is_none()
        && !response
            .finish_reason()
            .is_some_and(|reason| reason.truncated_output())
}

#[cfg(test)]
mod tests {
    use rig_agent::{agent::AgentBuilder, handlers::Handlers};
    use rig_cassette::{
        agent::{AgentReplayExt, replay::register_all},
        effect_log::{EffectLog, EffectLogRecorder},
    };
    use rig_core::test_utils::MockCompletionModel;

    #[tokio::test]
    async fn synthetic_agent_run_can_be_replayed_without_a_live_model() {
        let recorder = EffectLogRecorder::new();
        let model = MockCompletionModel::text("synthetic preview");
        let agent = AgentBuilder::new(model.clone().erase())
            .record_content_telemetry(false)
            .record_to(recorder.clone())
            .build();
        let prompt = "Describe a synthetic preview.";
        let original = agent.prompt(prompt).await.unwrap();
        let log = agent.stamp(recorder.take());
        let serialized = serde_json::to_vec(&log).unwrap();
        let restored: EffectLog = serde_json::from_slice(&serialized).unwrap();

        let handlers = Handlers::default();
        register_all(&restored, &handlers).unwrap();
        let replay = AgentBuilder::over_handlers(
            handlers,
            "casting-cassette-replay",
            agent.model_key().raw().clone(),
        )
        .record_content_telemetry(false)
        .build();
        replay.check_replayable(&restored).unwrap();
        let replayed = replay.prompt(prompt).await.unwrap();
        assert_eq!(replayed.output(), original.output());
        assert_eq!(model.request_count(), 1);
    }
}
