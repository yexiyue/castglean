//! Plan C adapter: rig-ecs owns the model/tool loop and complete tool feedback.
use anyhow::{Result, bail, ensure};
use rig_core::{
    DynModel,
    catalog::ModelSpec,
    completion::UnsupportedOption,
    effect::{EffectKind, HandlerDescriptor, family},
    operation::Completion,
    serve::{Dispatch, ErasedHandler, Reply, Serve, adapters::ModelAdapter},
    tool::{DynamicTool, Touches},
};
use rig_ecs::{effects::Handler, prelude::*};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{runtime::Handle, task::AbortHandle};

/// Uses the caller's runtime, including while folding a streaming response.
/// Handles are also owned by the run, so cancellation does not have to wait
/// for Bevy's task pool to poll and drop an in-flight handler future.
#[derive(Clone)]
struct RuntimeBridge {
    inner: ErasedHandler,
    runtime: Handle,
    tasks: Arc<Mutex<TaskScope>>,
}

#[derive(Default)]
struct TaskScope {
    closed: bool,
    handles: Vec<AbortHandle>,
}

struct AbortOnDrop(AbortHandle);
impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl Serve for RuntimeBridge {
    type Family = family::Dynamic;

    fn descriptor(&self) -> HandlerDescriptor {
        self.inner.descriptor()
    }

    fn check(&self, kind: &EffectKind) -> Vec<UnsupportedOption> {
        self.inner.check(kind)
    }

    fn footprint(&self, kind: &EffectKind) -> Option<Touches> {
        self.inner.footprint(kind)
    }

    async fn serve(&self, kind: EffectKind, dispatch: Dispatch) -> Reply {
        let inner = self.inner.clone();
        // Spawn and register under the same lock that shutdown uses: no task
        // may slip into the gap after StopTurn and the cancellation sweep.
        let task = {
            let mut tasks = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
            if tasks.closed {
                return Reply::Outcome(Err(rig_core::serve::cancelled()));
            }
            tasks.handles.retain(|task| !task.is_finished());
            let task = self
                .runtime
                .spawn(async move { inner.handle(kind, dispatch).await.into_outcome().await });
            tasks.handles.push(task.abort_handle());
            task
        };
        let _abort = AbortOnDrop(task.abort_handle());
        match task.await {
            Ok(outcome) => Reply::Outcome(outcome),
            Err(_) => Reply::Outcome(Err(rig_core::serve::cancelled())),
        }
    }
}

#[derive(Resource)]
struct Budget {
    finished: Box<dyn Fn() -> bool + Send + Sync>,
    max_turns: usize,
    model_calls: HashSet<Entity>,
    exhausted: bool,
}

// This is only a local dispatch guard; the shared model wrapper remains the
// authority on the request budget, identically for the classic and ECS paths.
fn guard_model_calls(
    mut budget: ResMut<Budget>,
    mut calls: Query<(Entity, &mut Decision), (ReadyToStart, ModelCalls)>,
) {
    for (entity, mut decision) in &mut calls {
        if decision.is_decided() || budget.model_calls.contains(&entity) {
            continue;
        }
        let finished = (budget.finished)();
        if finished || budget.model_calls.len() >= budget.max_turns {
            budget.exhausted |= !finished;
            decision.decide(
                Decider::plugin("plan-c-local-model-guard"),
                Outcome(Err(rig_core::serve::cancelled())),
            );
        } else {
            budget.model_calls.insert(entity);
        }
    }
}

fn no_retries(mut verdicts: Query<&mut RetryVerdict, Without<Settled>>) {
    for mut verdict in &mut verdicts {
        verdict.0 = Verdict::Final;
    }
}

#[derive(Resource, Default)]
struct Observations {
    ended: Option<TurnOutcome>,
    // Sanitized dispatch evidence; never retain source text or tool arguments.
    effects: Vec<serde_json::Value>,
}

fn record_effects(mut events: MessageReader<EffectRecorded>, mut observed: ResMut<Observations>) {
    for EffectRecorded(record) in events.read() {
        observed.effects.push(serde_json::json!({
            "id": record.id.as_u64(),
            "parent": record.parent.map(|id| id.as_u64()),
            "handler": record.key,
            "family": record.kind.family(),
            "startedMs": record.started_ms,
            "finishedMs": record.finished_ms,
            "ok": match &record.outcome {
                Ok(rig_core::effect::Answered::ToolResult { result }) => !result.is_error(),
                other => other.is_ok(),
            },
        }));
    }
}

struct Kernel {
    app: App,
    agent: Entity,
    tasks: Arc<Mutex<TaskScope>>,
    observation_draft: Option<super::tools::SharedDraft>,
}

impl Kernel {
    fn new(
        model: DynModel<Completion>,
        spec: Arc<ModelSpec>,
        finished: impl Fn() -> bool + Send + Sync + 'static,
        tools: Vec<DynamicTool>,
        prompt: &str,
        max_turns: usize,
    ) -> Result<Self> {
        let runtime = anyhow::Context::context(
            Handle::try_current(),
            "ECS adapter requires the caller's Tokio runtime",
        )?;
        let tasks = Arc::new(Mutex::new(TaskScope::default()));
        let bridge = |inner| {
            ErasedHandler::new(RuntimeBridge {
                inner,
                runtime: runtime.clone(),
                tasks: Arc::clone(&tasks),
            })
        };
        let handler = bridge(ErasedHandler::new(ModelAdapter::<Completion>::new(
            spec.reference(),
            model,
        )));
        let mut app = App::new();
        app.add_plugins((TaskPoolPlugin::default(), AgentPlugin))
            .insert_resource(Budget {
                finished: Box::new(finished),
                max_turns,
                model_calls: HashSet::new(),
                exhausted: false,
            })
            .init_resource::<Observations>()
            .add_systems(AgentPass, no_retries.in_set(ReviewSystems::Edit))
            .add_systems(AgentPass, guard_model_calls.in_set(GateSystems::After))
            .add_systems(Last, record_effects)
            .add_observer(
                |event: On<bevy_ecs::lifecycle::Add<Settled>>,
                 turns: Query<(&ForAgent, &TurnOutcome)>,
                 mut observed: ResMut<Observations>| {
                    // TurnOf has already been removed by end_turns.
                    if let Ok((_, outcome)) = turns.get(event.entity) {
                        observed.ended = Some(outcome.clone());
                    }
                },
            );
        let mut names = Vec::new();
        for tool in tools {
            names.push(tool.name().as_str().to_owned());
            let (definition, handler, _) = tool.into_parts();
            // 0.46's registry is ECS tool entities, through WorldToolsExt.
            // A declared footprint overrides even read-only tool hints, so
            // wait_in_order serializes the entire reply's tool batch.
            ensure!(
                app.world_mut()
                    .spawn_tool(
                        definition,
                        bridge(handler),
                        ToolOptions {
                            footprint: Some(Touches::Writes(Scope::Anything)),
                        },
                    )
                    .is_some(),
                "duplicate ECS tool name"
            );
        }
        let agent = app
            .world_mut()
            .spawn((
                Agent,
                Connection {
                    spec,
                    handler: Handler(handler),
                },
                SystemPrompt(prompt.to_owned()),
                ToolAccess::Only(names),
            ))
            .id();
        app.finish();
        app.cleanup();
        Ok(Self {
            app,
            agent,
            tasks,
            observation_draft: None,
        })
    }
}

impl Drop for Kernel {
    fn drop(&mut self) {
        {
            let mut tasks = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
            tasks.closed = true;
            for task in tasks.handles.drain(..) {
                task.abort();
            }
        }
        self.app.world_mut().trigger(StopTurn::new(self.agent));
        self.app.update();
        let observed = self.app.world().resource::<Observations>();
        // The public runner discards stderr. Save only dispatch metadata in
        // shared state, on success, error and parent timeout/drop alike.
        if let Some(draft) = &self.observation_draft {
            draft
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .runtime_observations
                .push(serde_json::json!({
                "event": "plan_c_ecs_observation",
                "agent": format!("{:?}", self.agent),
                "modelCalls": self.app.world().resource::<Budget>().model_calls.len(),
                "effects": observed.effects,
                }));
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
    ensure!(max_turns > 0, "ECS max_turns must be positive");
    let tools = super::tools::dynamic_tools(draft.clone())?;
    let observed_draft = draft.clone();
    let mut kernel = Kernel::new(
        model,
        spec,
        move || {
            observed_draft
                .lock()
                .map(|draft| draft.terminal())
                .unwrap_or(true)
        },
        tools,
        prompt,
        max_turns,
    )?;
    kernel.observation_draft = Some(draft.clone());
    kernel
        .app
        .world_mut()
        .trigger(Deliver::new(kernel.agent, input, DeliveryMode::Queue));
    loop {
        kernel.app.update();
        let finished = draft
            .lock()
            .map_err(|_| anyhow::anyhow!("draft lock poisoned"))?
            .finished();
        // A tool can set finished before its future is collected by ECS.
        // Let the kernel settle the entire batch (and record its feedback),
        // while guard_model_calls prevents any post-finish network request.
        if kernel.app.world().resource::<Budget>().exhausted {
            bail!("ECS local model request limit reached ({max_turns}) before finish");
        }
        if let Some(outcome) = kernel
            .app
            .world_mut()
            .resource_mut::<Observations>()
            .ended
            .take()
        {
            if finished {
                return Ok(());
            }
            match outcome {
                TurnOutcome::Answered(_) => bail!("ECS agent answered without finishing the draft"),
                TurnOutcome::Failed(why) => bail!("ECS agent failed: {why}"),
                TurnOutcome::Stopped(why) => bail!(
                    "ECS agent stopped: {}",
                    why.as_deref().unwrap_or("cancelled")
                ),
            }
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig_core::{
        catalog::Catalog,
        completion::Usage,
        message::ToolName,
        test_utils::{MockCompletionModel, MockError, MockStreamEvent},
        tool::{ToolExecutionError, ToolOutput},
    };
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    fn call(id: &str, n: usize) -> MockStreamEvent {
        MockStreamEvent::tool_call(id, "edit", serde_json::json!({"n": n}))
    }

    fn turn(events: Vec<MockStreamEvent>) -> Vec<MockStreamEvent> {
        let mut events = events;
        events.push(MockStreamEvent::final_response(Usage::new()));
        events
    }

    fn kernel(model: MockCompletionModel, tools: Vec<DynamicTool>, max: usize) -> Kernel {
        let spec = Catalog::builtin()
            .resolve("deepseek/deepseek-flash")
            .unwrap()
            .shared();
        Kernel::new(model.into(), spec, || false, tools, "Use the tools.", max).unwrap()
    }

    async fn drive(kernel: &mut Kernel) {
        kernel
            .app
            .world_mut()
            .trigger(Deliver::new(kernel.agent, "edit", DeliveryMode::Queue));
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                kernel.app.update();
                if kernel
                    .app
                    .world()
                    .resource::<Observations>()
                    .ended
                    .is_some()
                {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("offline ECS turn stalled");
    }

    #[tokio::test]
    async fn shared_draft_check_missing_patch_repair_and_finish_use_real_ecs() {
        use super::super::tools::{self, Draft, SharedDraft};
        use crate::contract::{Case, Source, hash};
        use serde_json::{Value, json};

        // Read the feedback from the actual request sent after check_draft,
        // including when the message encoding stores JSON as tool-result text.
        fn incomplete_feedback(value: &Value) -> Option<Value> {
            match value {
                Value::Object(fields) => {
                    if fields.get("error").and_then(Value::as_str) == Some("incomplete_draft")
                        && fields.contains_key("missingIds")
                    {
                        Some(value.clone())
                    } else {
                        fields.values().find_map(incomplete_feedback)
                    }
                }
                Value::Array(values) => values.iter().find_map(incomplete_feedback),
                Value::String(text) => serde_json::from_str::<Value>(text)
                    .ok()
                    .and_then(|value| incomplete_feedback(&value)),
                _ => None,
            }
        }

        let text = "风起。灯灭。";
        let draft: SharedDraft = Arc::new(Mutex::new(
            Draft::new(
                Case {
                    version: 1,
                    evaluation_task: "analysis".into(),
                    case_id: "ecs-shared-draft-repair".into(),
                    source: Source {
                        text: text.into(),
                        sha256: hash(text.as_bytes()),
                    },
                    characters: vec![],
                    review_input: None,
                },
                false,
            )
            .unwrap(),
        ));
        assert_eq!(draft.lock().unwrap().pieces.len(), 2);
        let input = draft.lock().unwrap().input().to_string();
        let patch = |piece: &str, revision: u64, operation: &str| {
            json!({
                "operationId": operation, "expectedRevision": revision,
                "segments": [{
                    "pieces": [piece], "kind": "narration", "speaker": "narrator",
                    "evidence": [piece], "reason": "受控原文依据，不得进入运行时观察记录"
                }]
            })
        };
        let request = |id: &str, tool: &str, args: Value| {
            turn(vec![MockStreamEvent::tool_call(id, tool, args)])
        };
        let model = MockCompletionModel::from_stream_turns([
            request("partial", "patch_annotations", patch("p0", 0, "initial")),
            request("check", "check_draft", json!({})),
            request("repair", "patch_annotations", patch("p1", 1, "repair")),
            request("finish", "finish_analysis", json!({"expectedRevision": 2})),
            turn(vec![MockStreamEvent::text("must not request after finish")]),
        ]);
        let spec = Catalog::builtin()
            .resolve("deepseek/deepseek-flash")
            .unwrap()
            .shared();
        tokio::time::timeout(
            Duration::from_secs(5),
            run(
                model.clone().into(),
                spec,
                draft.clone(),
                tools::PROMPT,
                input.clone(),
                4,
            ),
        )
        .await
        .expect("shared-draft ECS loop stalled")
        .expect("repair must finish");

        assert_eq!(model.request_count(), 4);
        let requests = model.requests();
        for request in &requests {
            assert_eq!(request.system_instructions(), Some(tools::PROMPT));
        }
        assert!(
            serde_json::to_string(&requests[0].chat_history)
                .unwrap()
                .contains("风起。")
        );
        // The third request really carries the check result; the model's
        // scripted next patch uses exactly that missing ID and revision.
        let feedback = incomplete_feedback(&serde_json::to_value(&requests[2]).unwrap())
            .expect("full check_draft feedback must reach the next model request");
        assert_eq!(
            feedback,
            json!({
                "ok": false, "revision": 1, "missingIds": ["p1"],
                "repairRounds": 1, "segmentCount": 1, "error": "incomplete_draft",
                "missingCount": 1, "offendingIds": [], "unknownIds": [],
                "missingRanges":[{"from":"p1","to":"p1","count":1}],"missingIdsTruncated":false,
                "validPieceRange": {"from":"p0","to":"p1","count":2},
                "hint": "Assign explicit pieces for all missingIds (up to 512); missingRanges describe every gap even if missingIdsTruncated is true. Plan the complete repair before checking again, then finish separately."
            })
        );
        let mut expected_tools = tools::dynamic_tools(draft.clone())
            .unwrap()
            .into_iter()
            .map(|tool| tool.definition())
            .collect::<Vec<_>>();
        expected_tools.sort_by(|left, right| left.name.as_str().cmp(right.name.as_str()));
        assert_eq!(
            serde_json::to_value(&requests[0].tools).unwrap(),
            serde_json::to_value(expected_tools).unwrap()
        );

        let draft = draft.lock().unwrap();
        assert!(draft.finished());
        assert_eq!(draft.revision, 2);
        assert_eq!(draft.first_check_valid, Some(false));
        assert_eq!(draft.repair_rounds, 1);
        assert_eq!(draft.calls, 4);
        assert_eq!(draft.case.source.text, text);
        let segments = draft.segments();
        draft
            .case
            .validate_segments(
                &segments,
                crate::contract::Range {
                    start: 0,
                    end: text.len(),
                },
            )
            .unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(
            draft
                .logs
                .iter()
                .map(|log| (
                    log["tool"].as_str().unwrap(),
                    log["status"].as_str().unwrap()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("patch_annotations", "completed"),
                ("check_draft", "rejected"),
                ("patch_annotations", "completed"),
                ("finish_analysis", "completed")
            ]
        );
        assert_eq!(draft.runtime_observations.len(), 1);
        let observed = &draft.runtime_observations[0];
        assert_eq!(observed["modelCalls"], 4);
        let effects = observed["effects"].as_array().unwrap();
        assert_eq!(
            effects
                .iter()
                .filter(|effect| effect["family"] == "completion" && !effect["startedMs"].is_null())
                .count(),
            4
        );
        assert_eq!(
            effects
                .iter()
                .filter(|effect| effect["family"] == "tool")
                .map(|effect| effect["handler"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![
                "tool:patch_annotations",
                "tool:check_draft",
                "tool:patch_annotations",
                "tool:finish_analysis"
            ]
        );
        let sanitized = observed.to_string();
        for private in [
            text,
            "受控原文依据",
            "missingIds",
            "arguments",
            "chat_history",
        ] {
            assert!(
                !sanitized.contains(private),
                "runtime observation leaked {private}"
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shared_native_model_buffers_unary_tool_response_for_ecs_stream_api() {
        use super::super::{model, tools};
        use crate::contract::{Case, Source, hash};
        use rig_core::{
            completion::CompletionResponse,
            message::{Origin, ToolFunction},
        };
        use serde_json::{Value, json};
        use std::{fs, os::unix::fs::PermissionsExt};

        let root = tempfile::tempdir().unwrap();
        let helper = root.path().join("helper");
        let reply = root.path().join("reply.json");
        let observed = root.path().join("observed.json");
        // A local file-copy helper only: no credentials, network client or
        // real provider. This exercises the production shared model boundary.
        fs::write(&helper, format!(
            "#!/bin/sh\nset -eu\ncp '{}' \"${{CASTGLEAN_EXPERIMENT_JOB%.json}}.result.json\"\ncp \"$CASTGLEAN_EXPERIMENT_JOB\" '{}'\n",
            reply.display(), observed.display(),
        )).unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        let config = root.path().join("llm.json");
        fs::write(&config, serde_json::to_vec(&json!({
            "version": 1, "connections": [{"connection": {
                "id": "connection", "revision": 1, "protocol": "openai",
                "endpoint": "http://unreachable.invalid/v1",
                "models": [{"id": "model", "modelId": "test", "contextWindow": 128000, "maxOutputTokens": 8192}]
            }}]
        })).unwrap()).unwrap();
        let native = root.path().join("native.json");
        fs::write(
            &native,
            serde_json::to_vec(&json!({
                "bridgeBinary": helper, "configPath": config,
                "selection": {"connectionId": "connection", "modelId": "model"},
                "controlledHelper": true
            }))
            .unwrap(),
        )
        .unwrap();
        let text = "风起。灯灭。";
        let source_hash = hash(text.as_bytes());
        let draft = Arc::new(Mutex::new(
            tools::Draft::new(
                Case {
                    version: 1,
                    evaluation_task: "analysis".into(),
                    case_id: "ecs-native-stream-adapter".into(),
                    source: Source {
                        text: text.into(),
                        sha256: source_hash.clone(),
                    },
                    characters: vec![],
                    review_input: None,
                },
                false,
            )
            .unwrap(),
        ));
        let input = draft.lock().unwrap().input().to_string();
        let boundary = model::build(
            &native,
            &root.path().join("jobs"),
            "ecs",
            "controlled",
            &source_hash,
        )
        .unwrap();
        let tool_call = |id: &str, name: &str, arguments| {
            AssistantContent::ToolCall(ToolCall::from_wire(
                id,
                ToolFunction::new(ToolName::new(name).unwrap(), arguments),
            ))
        };
        // Both calls arrive in one buffered unary response; ECS must decode
        // them through its stream API, then serialize the revision-sensitive batch.
        let response = CompletionResponse::new(
            vec![
                tool_call(
                    "patch",
                    "patch_annotations",
                    json!({
                        "operationId": "whole", "expectedRevision": 0,
                        "segments": [{"pieces": ["p0","p1"], "kind": "narration", "speaker": "narrator", "evidence": ["p0"], "reason": "受控原文依据"}]
                    }),
                ),
                tool_call("finish", "finish_analysis", json!({"expectedRevision": 1})),
            ],
            Usage::new()
                .input_tokens(11)
                .output_tokens(7)
                .total_tokens(18),
            Origin::new("openai.chat", "openai", "test"),
            Value::Null,
        );
        fs::write(
            reply,
            serde_json::to_vec(&json!({
                "ok": true, "configurationHash": boundary.configuration_hash,
                "model": boundary.model_id, "response": response
            }))
            .unwrap(),
        )
        .unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            run(
                boundary.model.clone(),
                boundary.spec.clone(),
                draft.clone(),
                tools::PROMPT,
                input,
                2,
            ),
        )
        .await;
        boundary.drain().await.unwrap();
        result
            .expect("controlled helper ECS run stalled")
            .expect("unary relay must support ECS streaming completion");
        assert!(
            observed.exists(),
            "ECS must actually launch the controlled native helper"
        );
        let job: Value = serde_json::from_slice(&fs::read(observed).unwrap()).unwrap();
        let carried: rig_core::completion::CompletionRequest =
            serde_json::from_value(job["request"].clone()).unwrap();
        assert_eq!(carried.system_instructions(), Some(tools::PROMPT));
        assert_eq!(carried.tools.len(), 5);
        assert_eq!(
            boundary.traces().len(),
            1,
            "finish must prevent a second native request"
        );
        assert_eq!(boundary.usage().total_tokens, Some(18));
        let draft = draft.lock().unwrap();
        assert!(draft.finished());
        assert_eq!(draft.revision, 1);
        assert_eq!(draft.calls, 2);
        assert_eq!(draft.logs[0]["status"], "completed");
        assert_eq!(draft.logs[1]["status"], "completed");
        assert_eq!(draft.runtime_observations.len(), 1);
        let effects = draft.runtime_observations[0]["effects"].as_array().unwrap();
        assert!(effects.iter().any(|effect| effect["family"] == "completion"
            && effect["ok"] == true
            && !effect["startedMs"].is_null()));
        assert_eq!(
            effects
                .iter()
                .filter(|effect| effect["family"] == "tool" && effect["ok"] == true)
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn complete_validation_feedback_and_serial_tool_batch_use_real_ecs() {
        let model = MockCompletionModel::from_stream_turns([
            turn(vec![call("invalid", 0)]),
            turn(vec![call("fix", 1), call("next", 2)]),
            turn(vec![MockStreamEvent::text("done")]),
        ]);
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let order = Arc::new(Mutex::new(Vec::new()));
        let tool = DynamicTool::new(
            ToolName::new("edit").unwrap(),
            "Edit",
            serde_json::json!({"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}),
            {
                let (active, peak, order) = (active.clone(), peak.clone(), order.clone());
                move |args| {
                    let (active, peak, order) = (active.clone(), peak.clone(), order.clone());
                    Box::pin(async move {
                        let n = args["n"].as_u64().unwrap();
                        let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(count, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        order.lock().unwrap().push(n);
                        active.fetch_sub(1, Ordering::SeqCst);
                        if n == 0 {
                            Err(ToolExecutionError::invalid_args(
                                "FULL_VALIDATION: missing [4,8); fix exactly this range",
                            ))
                        } else {
                            Ok(ToolOutput::json(serde_json::json!({"accepted":n})))
                        }
                    })
                }
            },
        );
        let mut kernel = kernel(model.clone(), vec![tool], 3);
        drive(&mut kernel).await;
        assert_eq!(model.request_count(), 3);
        assert_eq!(peak.load(Ordering::SeqCst), 1);
        assert_eq!(*order.lock().unwrap(), vec![0, 1, 2]);
        let requests = model.requests();
        let feedback = serde_json::to_string(&requests[1]).unwrap();
        assert!(feedback.contains("FULL_VALIDATION: missing [4,8); fix exactly this range"));
        let next = serde_json::to_string(&requests[2]).unwrap();
        assert!(next.contains("accepted") && next.contains("fix") && next.contains("next"));
        let observed = kernel.app.world().resource::<Observations>();
        // Deliver itself is an effect, besides three model and three tool calls.
        assert_eq!(observed.effects.len(), 7);
        assert!(
            observed
                .effects
                .iter()
                .any(|effect| effect["handler"] == "tool:edit")
        );
    }

    #[tokio::test]
    async fn local_budget_stops_before_next_model_request() {
        let model = MockCompletionModel::from_stream_turns([
            turn(vec![call("unknown", 0)]),
            turn(vec![MockStreamEvent::text("must not run")]),
        ]);
        let mut kernel = kernel(model.clone(), vec![], 1);
        drive(&mut kernel).await;
        assert!(kernel.app.world().resource::<Budget>().exhausted);
        assert_eq!(model.request_count(), 1);
    }

    #[tokio::test]
    async fn finished_draft_prevents_an_extra_model_request() {
        let finished = Arc::new(AtomicBool::new(false));
        let tool = DynamicTool::new(
            ToolName::new("edit").unwrap(),
            "Finish",
            serde_json::json!({}),
            {
                let finished = finished.clone();
                move |_| {
                    let finished = finished.clone();
                    Box::pin(async move {
                        finished.store(true, Ordering::SeqCst);
                        Ok(ToolOutput::text("finished"))
                    })
                }
            },
        );
        let model = MockCompletionModel::from_stream_turns([
            turn(vec![call("finish", 1)]),
            turn(vec![MockStreamEvent::text("must not run after finish")]),
        ]);
        let spec = Catalog::builtin()
            .resolve("deepseek/deepseek-flash")
            .unwrap()
            .shared();
        let mut kernel = Kernel::new(
            model.clone().into(),
            spec,
            {
                let finished = finished.clone();
                move || finished.load(Ordering::SeqCst)
            },
            vec![tool],
            "Finish with the tool.",
            2,
        )
        .unwrap();
        drive(&mut kernel).await;
        assert!(finished.load(Ordering::SeqCst));
        assert_eq!(model.request_count(), 1);
        assert!(!kernel.app.world().resource::<Budget>().exhausted);
    }

    #[tokio::test]
    async fn transient_model_failure_has_no_kernel_retry() {
        let model = MockCompletionModel::from_stream_turns([
            vec![MockStreamEvent::Error(MockError::Stalled(
                Duration::from_secs(1),
            ))],
            turn(vec![MockStreamEvent::text("must not retry")]),
        ]);
        let mut kernel = kernel(model.clone(), vec![], 5);
        drive(&mut kernel).await;
        assert_eq!(model.request_count(), 1);
        assert!(matches!(
            kernel.app.world().resource::<Observations>().ended,
            Some(TurnOutcome::Failed(_))
        ));
    }

    #[tokio::test]
    async fn dropping_kernel_cancels_started_tool_and_closes_dispatch_scope() {
        struct Active(Arc<AtomicBool>);
        impl Drop for Active {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let active = Arc::new(AtomicBool::new(false));
        let tool = DynamicTool::new(
            ToolName::new("edit").unwrap(),
            "Edit",
            serde_json::json!({}),
            {
                let active = active.clone();
                move |_| {
                    let active = active.clone();
                    Box::pin(async move {
                        active.store(true, Ordering::SeqCst);
                        let _active = Active(active);
                        std::future::pending::<()>().await;
                        Ok(ToolOutput::text("unreachable"))
                    })
                }
            },
        );
        let model = MockCompletionModel::from_stream_turns([turn(vec![call("pending", 1)])]);
        let mut kernel = kernel(model, vec![tool], 2);
        kernel
            .app
            .world_mut()
            .trigger(Deliver::new(kernel.agent, "edit", DeliveryMode::Queue));
        tokio::time::timeout(Duration::from_secs(5), async {
            while !active.load(Ordering::SeqCst) {
                kernel.app.update();
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let scope = kernel.tasks.clone();
        drop(kernel);
        assert!(scope.lock().unwrap().closed);
        tokio::time::timeout(Duration::from_secs(1), async {
            while active.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("cancelled tool still running");
    }
}
