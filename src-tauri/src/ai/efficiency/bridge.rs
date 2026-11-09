//! Explicit native-service evaluation in an isolated temporary project.
use super::*;
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
    let input: Value = serde_json::from_slice(&std::fs::read(&job).unwrap()).unwrap();
    let result = execute(&input, Some(job.with_extension("trace.json"))).await;
    std::fs::write(
        job.with_extension("result.json"),
        serde_json::to_vec(&result).unwrap(),
    )
    .unwrap();
}
fn implementation_hash() -> String {
    project::hash(
        concat!(
            include_str!("../efficiency.rs"),
            include_str!("bridge.rs"),
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
async fn execute(input: &Value, trace_path: Option<PathBuf>) -> Value {
    let profile: Profile = serde_json::from_value(input["profile"].clone()).unwrap();
    let text = input["text"].as_str().unwrap();
    assert_eq!(project::hash(text.as_bytes()), input["sourceHash"]);
    let experiment = Experiment::new(profile, trace_path);
    let started = Instant::now();
    let (model, configuration, _) = match crate::llm::test_support::experiment_model(input) {
        Ok(model) => model,
        Err(error) => {
            return json!({"ok":false,"error":error,"requestsUnknown":true,"profile":profile});
        }
    };
    run_case(input, experiment, model, configuration, started).await
}

async fn run_case(
    input: &Value,
    experiment: Arc<Experiment>,
    model: rig_core::DynModel<rig_core::operation::Completion>,
    configuration: Value,
    started: Instant,
) -> Value {
    let text = input["text"].as_str().unwrap();
    let request = input["request"].as_str().unwrap();
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
    document.project.corrections =
        serde_json::from_value(input.get("corrections").cloned().unwrap_or(json!([]))).unwrap();
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
                selection: serde_json::from_value(input["selection"].clone()).unwrap(),
                revision: configuration["revision"].as_u64().unwrap() as u32,
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
        db: &db,
        root: root.path(),
        lease: &lease,
        token: &token,
        workers: workers.clone(),
    }
    .execute(ai::tasks::Model {
        client: model,
        generation: crate::chapter_analysis::Generation {
            model: serde_json::from_value(configuration["model"].clone()).unwrap(),
            completion_options: serde_json::from_value(configuration["completionOptions"].clone())
                .unwrap(),
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
                tools.push(json!({"name":name,"state":state,"inputHash":project::hash(&serde_json::to_vec(input).unwrap()),"result":result,"error":output.as_ref().and_then(|o|o.get("error"))}));
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
        && after.document.project.sources[0].sha256 == input["sourceHash"];
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
    let chapters = candidate.as_ref().map(|c| c.content.chapters.clone());
    let count = crate::database::entity::split_proposal::Entity::find()
        .filter(crate::database::entity::split_proposal::Column::RunId.eq(&run.id))
        .count(&db)
        .await
        .unwrap();
    let coverage = chapters.as_ref().is_some_and(|chapters| {
        chapters.first().is_some_and(|c| c.start == 0)
            && chapters
                .last()
                .is_some_and(|c| c.end as usize == source_bytes)
            && chapters.windows(2).all(|c| c[0].end == c[1].start)
    });
    json!({"formatVersion":1,"caseId":input["caseId"],"profile":profile,"ok":result.is_ok()&&unchanged&&pending&&coverage&&complete&&assistant_messages==1,
        "error":result.err(),"distinctRuleTrials":rule_trials.len(),"implementationHash":implementation_hash(),"inputHash":project::hash(&serde_json::to_vec(&(text,request,&state.document.project.corrections)).unwrap()),"configuration":configuration,
        "elapsedMs":started.elapsed().as_millis() as u64,"meter":experiment.snapshot(),"tools":tools,"headings":headings,"candidateCount":count,"unchanged":unchanged,"pending":pending,"coverage":coverage,"assistantMessages":assistant_messages,"complete":complete})
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
        let model = crate::llm::configured_model(&connection, None).unwrap();
        let configuration = json!({"model":connection.model,"completionOptions":connection.completion_options().unwrap(),"revision":connection.connection.revision});
        let text = "第一章 开始\n甲。\n第二章 后续\n乙。";
        let input = json!({"text":text,"sourceHash":project::hash(text.as_bytes()),"request":"请检查分章并提交候选","caseId":"fixture","selection":selection});
        let meter = Experiment::new(profile, None);
        let result = run_case(&input, meter, model, configuration, Instant::now()).await;
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
    let model = crate::llm::configured_model(&connection, None).unwrap();
    let config = json!({"model":connection.model,"completionOptions":connection.completion_options().unwrap(),"revision":connection.connection.revision});
    let text = "第一章 标题\n正文。";
    let input = json!({"caseId":"truncated","text":text,"sourceHash":project::hash(text.as_bytes()),"request":"检查分章","selection":selection});
    let result = run_case(
        &input,
        Experiment::new(Profile::Batch, None),
        model,
        config,
        Instant::now(),
    )
    .await;
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
    let model = crate::llm::configured_model(&connection, None).unwrap();
    let config = json!({"model":connection.model,"completionOptions":connection.completion_options().unwrap(),"revision":connection.connection.revision});
    let text = "第一章 标题\n正文。";
    let input = json!({"caseId":"failure","text":text,"sourceHash":project::hash(text.as_bytes()),"request":"检查分章","selection":selection});
    let result = run_case(
        &input,
        Experiment::new(Profile::Batch, None),
        model,
        config,
        Instant::now(),
    )
    .await;
    assert_eq!(result["ok"], false);
    assert_eq!(result["candidateCount"], 0);
    assert_eq!(result["meter"]["requestCount"], 1);
    assert!(result["meter"]["inputTokens"].is_null());
    assert!(result["meter"]["outputTokens"].is_null());
    assert!(!result.to_string().contains("private service detail"));
}
