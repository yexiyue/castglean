//! Explicit native-service evaluation in an isolated temporary project.
use super::{contract::*, *};
use crate::{
    ai,
    project::{
        self, Chapter, ProjectDocument, Source,
        store::{self, EditState, LocalProject},
    },
};
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter};
use serde_json::{Value, json};

#[tokio::test]
#[ignore = "explicit efficiency job and native model configuration required"]
async fn task_efficiency_bridge() {
    let job = PathBuf::from(std::env::var("CASTGLEAN_EFFICIENCY_JOB").expect("explicit job path"));
    let input: Job = serde_json::from_slice(&std::fs::read(&job).unwrap()).unwrap();
    let result = match execute(&input, Some(job.with_extension("trace.json"))).await {
        Ok(result) => serde_json::to_value(result),
        Err(error) => serde_json::to_value(error),
    }
    .unwrap();
    crate::atomic_json::save(&job.with_extension("result.json"), &result, None).unwrap();
}

fn implementation_hash() -> String {
    project::hash(
        concat!(
            include_str!("../efficiency.rs"),
            include_str!("bridge.rs"),
            include_str!("contract.rs"),
            include_str!("../assistant.rs"),
            include_str!("../assistant/tools.rs"),
            include_str!("../assistant/tools/adapter.rs"),
            include_str!("../assistant/tools/arguments.rs"),
            include_str!("../assistant/tools/read.rs"),
            include_str!("../agent.rs"),
            include_str!("../../chapter_analysis/agent_runtime.rs"),
            include_str!("../tasks.rs"),
            include_str!("../dispatch.rs"),
            include_str!("../history.rs"),
            include_str!("../projection.rs"),
            include_str!("../output.rs"),
            include_str!("../../novel_import/splitting.rs"),
            include_str!("../../novel_import/splitting/graph.rs"),
            include_str!("../../novel_import/splitting/store.rs"),
            include_str!("../../novel_import/partition.rs"),
            include_str!("../../novel_import/detection.rs")
        )
        .as_bytes(),
    )
}
async fn execute(
    input: &Job,
    trace_path: Option<PathBuf>,
) -> Result<EvaluationResult, SetupFailure> {
    assert_eq!(
        project::hash(input.input.text.as_bytes()),
        input.input.source_hash
    );
    let experiment = Experiment::new(input.profile, trace_path);
    let started = Instant::now();
    // The native-model helper owns the open provider configuration boundary.
    let native_input = serde_json::to_value(input).expect("serializable evaluation job");
    let (model, configuration, _) = crate::llm::test_support::experiment_model(&native_input)
        .map_err(|error| SetupFailure {
            ok: false,
            error,
            requests_unknown: true,
            profile: input.profile,
        })?;
    let configuration = serde_json::from_value(configuration).expect("native model identity");
    Ok(run_case(
        &input.input,
        &input.selection,
        experiment,
        model,
        configuration,
        started,
    )
    .await)
}

async fn run_case(
    input: &CaseInput,
    selection: &crate::llm::ModelSelection,
    experiment: Arc<Experiment>,
    model: rig_core::DynModel<rig_core::operation::Completion>,
    configuration: ModelContext,
    started: Instant,
) -> EvaluationResult {
    let text = input.text.as_str();
    let request = input.request.as_str();
    let profile = experiment.profile;
    let root = tempfile::tempdir().unwrap();
    let db = crate::database::open(&root.path().join("experiment.sqlite3"))
        .await
        .unwrap();
    let source = Source {
        id: "source".into(),
        filename: "experiment.txt".into(),
        encoding: "utf-8".into(),
        raw_sha256: project::hash(text.as_bytes()),
        sha256: project::hash(text.as_bytes()),
        text: text.into(),
    };
    project::publish_source(root.path(), &source, text.as_bytes()).unwrap();
    let mut document = ProjectDocument::new("project".into(), "分章效率实验".into(), String::new());
    document.project.chapters.push(Chapter {
        id: "chapter".into(),
        source_id: source.id.clone(),
        title: "待检查目录".into(),
        start: 0,
        end: text.len() as u32,
        heading: None,
        volume_id: None,
        predecessor_ids: vec![],
    });
    document.project.sources.push(source);
    document.project.corrections = input.corrections.clone();
    let state = LocalProject {
        document,
        edit: EditState {
            rules: json!([]),
            issues: json!([]),
            single_chapter_sources: json!([]),
            undo: None,
        },
    };
    state.document.validate().unwrap();
    store::save(&db, root.path(), &state, None).await.unwrap();
    let session = ai::create_session(
        &db,
        ai::CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            task_kind: "project_assistant".into(),
            chapter_id: None,
            title: "效率实验".into(),
        },
    )
    .await
    .unwrap();
    let run = ai::start_run(
        &db,
        ai::StartRun {
            session_id: session.id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: ai::Configuration {
                reasoning: None,
                selection: selection.clone(),
                revision: configuration.revision,
            },
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger: ai::Trigger::Message {
                message: request.into(),
            },
            workspace_context: Some(ai::WorkspaceContext {
                action: ai::WorkspaceAction::Auto,
                chapter_id: Some("chapter".into()),
            }),
        },
        None,
    )
    .await
    .unwrap();
    let lease = ai::runs::claim(&db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    let token = tokio_util::sync::CancellationToken::new();
    let workers = Arc::new(tokio::sync::Semaphore::new(1));
    let execution = ai::tasks::Execution {
        experiment: Some(experiment.clone()),
        catalog: None,
        db: &db,
        root: root.path(),
        lease: &lease,
        token: &token,
        workers: workers.clone(),
    }
    .execute(ai::tasks::Model {
        client: model,
        generation: crate::chapter_analysis::Generation {
            model: configuration.model.clone(),
            completion_options: configuration.completion_options.clone(),
        },
    });
    let result = super::CURRENT.scope(experiment.clone(), execution).await;
    token.cancel();
    let _drained = workers.acquire().await.unwrap();
    ai::runs::finish(
        &db,
        &lease,
        if result.is_ok() {
            ai::RunStatus::WaitingForInput
        } else {
            ai::RunStatus::Failed
        },
        result.err(),
    )
    .await
    .unwrap();
    let history = ai::history_page(&db, &session.id, None, 100).await.unwrap();
    let mut final_id = None;
    let mut rule_trials = std::collections::HashSet::new();
    let mut tools = Vec::new();
    for message in &history.messages {
        for part in message.parts.parts() {
            if let ai::messages::MessagePart::Tool {
                name,
                input,
                state,
                output,
                result,
                ..
            } = part
            {
                tools.push(ToolAudit {
                    name: name.clone(),
                    state: *state,
                    input_hash: project::hash(&serde_json::to_vec(input).unwrap()),
                    result: result.clone(),
                    error: output
                        .as_ref()
                        .and_then(|value| value.get("error"))
                        .cloned(),
                });
                if *state == ai::messages::ToolState::Completed {
                    if name == "compare_rules" {
                        for variant in input["variants"].as_array().into_iter().flatten() {
                            let valid = output.as_ref().and_then(Value::as_array).is_some_and(
                                |summaries| {
                                    summaries.iter().any(|s| {
                                        s["label"] == variant["label"] && s["summary"].is_object()
                                    })
                                },
                            );
                            if valid {
                                rule_trials.insert(project::hash(
                                    &serde_json::to_vec(&variant["rules"]).unwrap(),
                                ));
                            }
                        }
                    }
                    if name == "finish_splitting" {
                        final_id = output
                            .as_ref()
                            .and_then(|o| o["proposal_id"].as_str())
                            .map(str::to_owned);
                    }
                }
            }
        }
    }
    let candidate = if let Some(id) = final_id {
        Some(
            crate::novel_import::splitting::store::query(&db, &id)
                .await
                .unwrap(),
        )
    } else {
        None
    };
    let after = store::read(&db, root.path(), "project").await.unwrap();
    let unchanged = after.document.project.revision == 1
        && serde_json::to_value(&after.document.project.corrections).unwrap()
            == serde_json::to_value(&state.document.project.corrections).unwrap()
        && after.document.project.sources[0].sha256 == input.source_hash;
    let pending = candidate.as_ref().is_some_and(|c| {
        c.status == crate::novel_import::splitting::store::ProposalStatus::Pending && !c.stale
    });
    let assistant_messages = history
        .messages
        .iter()
        .filter(|m| m.role == "assistant")
        .count();
    let complete = history
        .messages
        .iter()
        .filter(|m| m.role == "assistant")
        .all(|m| m.status == "complete");
    let source_bytes = text.len();
    let headings = candidate.as_ref().map(|c| {
        c.content
            .chapters
            .iter()
            .filter_map(|c| c.heading)
            .collect::<Vec<_>>()
    });
    let count = crate::database::entity::split_proposal::Entity::find()
        .filter(crate::database::entity::split_proposal::Column::RunId.eq(&run.id))
        .count(&db)
        .await
        .unwrap();
    let coverage = candidate.as_ref().is_some_and(|candidate| {
        let chapters = &candidate.content.chapters;
        chapters.first().is_some_and(|c| c.start == 0)
            && chapters
                .last()
                .is_some_and(|c| c.end as usize == source_bytes)
            && chapters.windows(2).all(|c| c[0].end == c[1].start)
    });
    EvaluationResult {
        format_version: 1,
        case_id: input.case_id.clone(),
        profile,
        ok: result.is_ok()
            && unchanged
            && pending
            && coverage
            && complete
            && assistant_messages == 1,
        error: result.err(),
        distinct_rule_trials: rule_trials.len(),
        implementation_hash: implementation_hash(),
        input_hash: input.input_hash(),
        configuration,
        elapsed_ms: started.elapsed().as_millis() as u64,
        meter: experiment.snapshot(),
        tools,
        headings,
        candidate_count: count,
        unchanged,
        pending,
        coverage,
        assistant_messages,
        complete,
    }
}

#[tokio::test]
async fn new_profiles_use_real_tasks_preserve_candidates_and_meter_every_request() {
    for (profile, expected) in [(Profile::Atomic, 5), (Profile::Batch, 4)] {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = calls.clone();
        let server = crate::llm::test_support::Fixture::raw(move |index, _, body| {
            observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let tools = body["tools"].as_array().unwrap();
            let project = tools
                .iter()
                .any(|t| t["function"]["name"] == "check_splitting");
            let results = body["messages"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|m| m["role"] == "tool")
                .collect::<Vec<_>>();
            let rules = json!([{"name":"chapter","pattern":"^第[一二三四五六七八九十]+章(?:\\s|$)","kind":"chapter"}]);
            let action = if project {
                if results.is_empty() {
                    Some((
                        "check_splitting",
                        json!({"instruction":"实际比较两套不同标题规则并提交待采用候选"}),
                    ))
                } else {
                    None
                }
            } else if results.is_empty() {
                Some(("directory", json!({})))
            } else if profile == Profile::Atomic && results.len() <= 2 {
                let rule = if results.len() == 1 {
                    rules.clone()
                } else {
                    json!([{"name":"broad","pattern":"^第.*章","kind":"chapter"}])
                };
                Some((
                    "compare_rules",
                    json!({"variants":[{"label":format!("v{}",results.len()),"rules":rule}]}),
                ))
            } else if profile == Profile::Batch && results.len() == 1 {
                Some((
                    "compare_rules",
                    json!({"variants":[{"label":"a","rules":rules},{"label":"broad","rules":[{"name":"broad","pattern":"^第.*章","kind":"chapter"}]},{"label":"bad","rules":[{"name":"bad","pattern":"[","kind":"chapter"}]}]}),
                ))
            } else {
                Some((
                    "finish_splitting",
                    json!({"plan":{"kind":"rules","rules":rules}}),
                ))
            };
            let (delta, finish) = if let Some((name, args)) = action {
                (
                    json!({"role":"assistant","tool_calls":[{"index":0,"id":format!("call-{index}"),"type":"function","function":{"name":name,"arguments":args.to_string()}}]}),
                    "tool_calls",
                )
            } else {
                (
                    json!({"role":"assistant","content":"已受理或提交，未采用。"}),
                    "stop",
                )
            };
            let chunk = json!({"id":"fixture","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":delta,"finish_reason":null}]});
            let end = json!({"id":"fixture","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":finish}],"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":110,"prompt_tokens_details":{"cached_tokens":20}}});
            (
                200,
                "text/event-stream",
                format!("data: {chunk}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes(),
            )
        });
        let (_config, state, selection, _) = crate::llm::test_support::configured(&server.endpoint);
        let connection = state.acquire_for_run(&selection).unwrap();
        let model = crate::llm::configured_model(&connection, None, None).unwrap();
        let configuration: ModelContext = serde_json::from_value(json!({"model":connection.model,"completionOptions":connection.completion_options_with(None).unwrap(),"revision":connection.connection.revision,"modelId":connection.model.model_id,"reasoning":connection.model.reasoning,"configurationSnapshotHash":"fixture"})).unwrap();
        let text = "第一章 开始\n甲。\n第二章 后续\n乙。";
        let input: CaseInput = serde_json::from_value(json!({"text":text,"sourceHash":project::hash(text.as_bytes()),"request":"请检查分章并提交候选","caseId":"fixture","selection":selection})).unwrap();
        let meter = Experiment::new(profile, None);
        let result = serde_json::to_value(
            run_case(
                &input,
                &selection,
                meter,
                model,
                configuration,
                Instant::now(),
            )
            .await,
        )
        .unwrap();
        assert_eq!(result["ok"], true, "{result}");
        assert_eq!(result["headings"], json!([0, 2]));
        assert_eq!(result["candidateCount"], 1);
        assert_eq!(result["distinctRuleTrials"], 2);
        assert_eq!(result["meter"]["requestCount"], expected);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), expected);
        assert_eq!(result["meter"]["inputTokens"], expected * 100);
        assert_eq!(result["meter"]["outputTokens"], expected * 10);
        assert_eq!(
            result["meter"]["continuations"].as_array().unwrap().len(),
            2
        );
    }
}

#[tokio::test]
async fn truncated_native_response_retains_known_usage_before_domain_rejection() {
    let server = crate::llm::test_support::Fixture::raw(|_, _, _| {
        let end = json!({"id":"truncated","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"content":"unfinished"},"finish_reason":"length"}],"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":110,"prompt_tokens_details":{"cached_tokens":20}}});
        (
            200,
            "text/event-stream",
            format!("data: {end}\n\ndata: [DONE]\n\n").into_bytes(),
        )
    });
    let (_dir, state, selection, _) = crate::llm::test_support::configured(&server.endpoint);
    let connection = state.acquire_for_run(&selection).unwrap();
    let model = crate::llm::configured_model(&connection, None, None).unwrap();
    let config: ModelContext = serde_json::from_value(json!({"model":connection.model,"completionOptions":connection.completion_options_with(None).unwrap(),"revision":connection.connection.revision,"modelId":connection.model.model_id,"reasoning":connection.model.reasoning,"configurationSnapshotHash":"fixture"})).unwrap();
    let text = "第一章 标题\n正文。";
    let input: CaseInput = serde_json::from_value(json!({"caseId":"truncated","text":text,"sourceHash":project::hash(text.as_bytes()),"request":"检查分章","selection":selection})).unwrap();
    let result = serde_json::to_value(
        run_case(
            &input,
            &selection,
            Experiment::new(Profile::Batch, None),
            model,
            config,
            Instant::now(),
        )
        .await,
    )
    .unwrap();
    assert_eq!(result["ok"], false);
    assert_eq!(result["meter"]["requestCount"], 1);
    assert_eq!(result["meter"]["inputTokens"], 100);
    assert_eq!(result["meter"]["outputTokens"], 10);
    assert_eq!(result["meter"]["cachedInputTokens"], 20);
    assert_eq!(result["meter"]["requests"][0]["complete"], false);
}

#[tokio::test]
async fn failed_native_call_retains_request_and_unknown_tokens() {
    let server = crate::llm::test_support::Fixture::new(|_, _, _| {
        (401, json!({"error":{"message":"private service detail"}}))
    });
    let (_dir, state, selection, _) = crate::llm::test_support::configured(&server.endpoint);
    let connection = state.acquire_for_run(&selection).unwrap();
    let model = crate::llm::configured_model(&connection, None, None).unwrap();
    let config: ModelContext = serde_json::from_value(json!({"model":connection.model,"completionOptions":connection.completion_options_with(None).unwrap(),"revision":connection.connection.revision,"modelId":connection.model.model_id,"reasoning":connection.model.reasoning,"configurationSnapshotHash":"fixture"})).unwrap();
    let text = "第一章 标题\n正文。";
    let input: CaseInput = serde_json::from_value(json!({"caseId":"failure","text":text,"sourceHash":project::hash(text.as_bytes()),"request":"检查分章","selection":selection})).unwrap();
    let result = serde_json::to_value(
        run_case(
            &input,
            &selection,
            Experiment::new(Profile::Batch, None),
            model,
            config,
            Instant::now(),
        )
        .await,
    )
    .unwrap();
    assert_eq!(result["ok"], false);
    assert_eq!(result["candidateCount"], 0);
    assert_eq!(result["meter"]["requestCount"], 1);
    assert!(result["meter"]["inputTokens"].is_null());
    assert!(result["meter"]["outputTokens"].is_null());
    assert!(!result.to_string().contains("private service detail"));
}

#[tokio::test]
async fn request_guard_persists_failure_without_dispatching_an_extra_request() {
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let observed = calls.clone();
    let server = crate::llm::test_support::Fixture::raw(move |index, _, _| {
        observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let chunk = json!({"id":"fixture","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":format!("call-{index}"),"type":"function","function":{"name":"directory","arguments":"{}"}}]},"finish_reason":null}]});
        let end = json!({"id":"fixture","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":110}});
        (
            200,
            "text/event-stream",
            format!("data: {chunk}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes(),
        )
    });
    let (_dir, state, selection, _) = crate::llm::test_support::configured(&server.endpoint);
    let connection = state.acquire_for_run(&selection).unwrap();
    let model = crate::llm::configured_model(&connection, None, None).unwrap();
    let config: ModelContext = serde_json::from_value(json!({
        "model":connection.model,"completionOptions":connection.completion_options_with(None).unwrap(),
        "revision":connection.connection.revision,"modelId":connection.model.model_id,
        "reasoning":connection.model.reasoning,"configurationSnapshotHash":"fixture"
    }))
    .unwrap();
    let text = "第一章 标题\n正文。";
    let input = CaseInput {
        case_id: "guard".into(),
        text: text.into(),
        source_hash: project::hash(text.as_bytes()),
        request: "检查分章".into(),
        corrections: vec![],
    };
    let output = tempfile::tempdir().unwrap();
    let trace = output.path().join("trace.json");
    let result = run_case(
        &input,
        &selection,
        Experiment::new(Profile::Batch, Some(trace.clone())),
        model,
        config,
        Instant::now(),
    )
    .await;
    assert!(!result.ok);
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 24);
    let persisted: Value = serde_json::from_slice(&std::fs::read(trace).unwrap()).unwrap();
    assert_eq!(persisted["requestCount"], 24);
    assert_eq!(persisted["inputTokens"], 2400);
    assert_eq!(persisted["error"], "experimental_request_guard");
}
