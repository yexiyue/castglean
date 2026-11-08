//! Classic Rig agent over the same bounded native model used by ECS.
use anyhow::{Result, ensure};
use rig_agent::agent::{AgentBuilder, AgentHook, HookContext, OutcomeAction, OutcomeEvent};
use rig_core::{
    DynModel,
    catalog::ModelSpec,
    completion::{Effort, GenerationOptions},
    operation::Completion,
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

struct StopWhenFinished {
    draft: super::tools::SharedDraft,
    stopped: Arc<AtomicBool>,
}
impl AgentHook for StopWhenFinished {
    async fn on_outcome(&self, _: &HookContext, _: OutcomeEvent<'_>) -> OutcomeAction {
        if self.draft.lock().is_ok_and(|d| d.finished()) {
            self.stopped.store(true, Ordering::SeqCst);
            OutcomeAction::stop("analysis_finished")
        } else {
            OutcomeAction::proceed()
        }
    }
}

pub(super) async fn run(
    model: DynModel<Completion>,
    spec: Arc<ModelSpec>,
    draft: super::tools::SharedDraft,
    prompt: &str,
    input: String,
    max_turns: usize,
) -> Result<()> {
    ensure!((1..=16).contains(&max_turns), "classic_invalid_turn_budget");
    ensure!(
        model.id().is_none_or(|id| id == spec.id.as_str()),
        "classic_model_spec_mismatch"
    );
    let stopped = Arc::new(AtomicBool::new(false));
    let agent = AgentBuilder::new(model)
        .preamble(prompt)
        .dynamic_tools(super::tools::dynamic_tools(draft.clone())?)
        .default_max_turns(max_turns)
        .max_tokens(4096)
        .options(GenerationOptions::default().reasoning(Effort::Low))
        .record_content_telemetry(false)
        .add_hook(StopWhenFinished {
            draft: draft.clone(),
            stopped: stopped.clone(),
        })
        .build();
    // Provider failures propagate immediately; malformed tool calls get no repair retry.
    let outcome = agent
        .prompt(input)
        .max_turns(max_turns)
        .tool_concurrency(1)
        .max_invalid_tool_call_retries(0)
        .max_consecutive_malformed_tool_calls(Some(0))
        .run()
        .await;
    if outcome.is_err() && !stopped.load(Ordering::SeqCst) {
        anyhow::bail!("classic_agent_failed");
    }
    ensure!(
        draft
            .lock()
            .map_err(|_| anyhow::anyhow!("classic_draft_lock"))?
            .finished(),
        "classic_draft_unfinished"
    );
    Ok(())
}
