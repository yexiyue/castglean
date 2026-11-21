//! Real native Rig/SSE fixtures. No external provider or project adoption.
use super::*;
use crate::ai::messages::{MessagePart, ToolState};
use crate::novel_import::splitting::{
    pipeline,
    test_support::{fixture_saved, tool_context},
};
use serde_json::json;
use std::time::{Duration, Instant};
fn model(endpoint: &str) -> DynModel<Completion> {
    rig_core::providers::openai::OpenAIConfig::new("test")
        .with_base_url(format!("{endpoint}/v1"))
        .connect(crate::llm::TestHttp::new(endpoint).unwrap())
        .chat("test")
        .erase()
}
fn sse(index: usize, delta: Value, tool: bool) -> Vec<u8> {
    let first = json!({"id":format!("reply{index}"),"object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":delta,"finish_reason":null}]});
    let end = json!({"id":format!("reply{index}"),"object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":if tool {"tool_calls"} else {"stop"}}]});
    format!("data: {first}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes()
}
#[tokio::test]
async fn malformed_typed_call_is_failed_counted_and_repair_creates_one_pending_candidate() {
    let fixture = crate::llm::test_support::Fixture::raw(|index, _, body| {
        let (delta, tool) = if index < 2 {
            let args = if index == 0 {
                json!({"plan":{"kind":"rules","rules":"not-an-array"}})
            } else {
                let outputs = body["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|m| m["role"] == "tool")
                    .collect::<Vec<_>>();
                assert_eq!(outputs.len(), 1);
                assert!(
                    outputs[0]["content"]
                        .as_str()
                        .unwrap()
                        .contains("invalid_arguments")
                );
                json!({"plan":{"kind":"rules","rules":crate::novel_import::heading_rules()}})
            };
            (
                json!({"role":"assistant","content":null,"tool_calls":[{"index":0,"id":format!("call{index}"),"type":"function","function":{"name":"finish_splitting","arguments":args.to_string()}}]}),
                true,
            )
        } else {
            assert_eq!(index, 2);
            (json!({"role":"assistant","content":"请审阅候选。"}), false)
        };
        let system = body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["role"] == "system")
            .unwrap();
        // Native OpenAI chat can encode system content as typed blocks.
        assert!(!system["content"].to_string().contains("analyze_chapter"));
        assert!(
            body["tools"]
                .as_array()
                .unwrap()
                .iter()
                .all(|tool| tool["function"]["name"] != "analyze_chapter")
        );
        (200, "text/event-stream", sse(index, delta, tool))
    });
    let (root, db, state, lease) = fixture_saved().await;
    pipeline::execute(
        tool_context(root.path(), &db, &lease),
        model(&fixture.endpoint),
        None,
        None,
    )
    .await
    .unwrap();
    let page = ai::history_page(&db, lease.session_id(), None, 20)
        .await
        .unwrap();
    assert_eq!(page.session.budget.requests, 2);
    assert_eq!(page.session.budget.tool_calls, 2);
    let facts = page
        .messages
        .iter()
        .flat_map(|m| m.parts.parts())
        .filter_map(|p| {
            if let MessagePart::Tool {
                state,
                result,
                output,
                ..
            } = p
            {
                Some((state, result, output))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    assert_eq!(facts.len(), 2);
    assert_eq!(*facts[0].0, ToolState::Failed);
    assert!(facts[0].1.is_none());
    assert_eq!(facts[0].2.as_ref().unwrap()["error"], "invalid_arguments");
    assert_eq!(*facts[1].0, ToolState::Completed);
    assert!(facts[1].1.is_some());
    let latest = crate::project::store::read(&db, root.path(), &state.document.project.id)
        .await
        .unwrap();
    assert_eq!(
        latest.document.project.revision,
        state.document.project.revision
    );
    assert!(ai::model_input(&db, lease.session_id()).await.is_ok());
}
#[tokio::test]
async fn actual_stream_provider_errors_keep_their_safe_categories_and_unknown_usage() {
    for (status, expected) in [
        (401, RunFailure::ConfigurationUnavailable),
        (408, RunFailure::Timeout),
        (429, RunFailure::Unknown),
    ] {
        let fixture = crate::llm::test_support::Fixture::new(move |_, _, _| {
            (
                status,
                json!({"error":{"message":"private provider detail"}}),
            )
        });
        let (root, db, _, lease) = fixture_saved().await;
        assert_eq!(
            pipeline::execute(
                tool_context(root.path(), &db, &lease),
                model(&fixture.endpoint),
                None,
                None
            )
            .await,
            Err(expected)
        );
        let page = ai::history_page(&db, lease.session_id(), None, 20)
            .await
            .unwrap();
        assert_eq!(page.session.budget.requests, 1);
        assert_eq!(page.session.budget.tool_calls, 0);
        assert!(page.messages.iter().all(|m| m.usage.is_none()));
        assert!(
            !serde_json::to_string(&page)
                .unwrap()
                .contains("private provider detail")
        );
    }
}
#[tokio::test]
async fn cancellation_interrupts_a_stream_before_its_next_chunk() {
    let started = Arc::new(tokio::sync::Notify::new());
    let observed = started.clone();
    let fixture = crate::llm::test_support::Fixture::raw(move |_, _, _| {
        observed.notify_one();
        std::thread::sleep(Duration::from_secs(1));
        (
            200,
            "text/event-stream",
            sse(0, json!({"role":"assistant","content":"迟到"}), false),
        )
    });
    let (root, db, _, lease) = fixture_saved().await;
    let tools = tool_context(root.path(), &db, &lease);
    let token = tools.token.clone();
    let cancel = async {
        started.notified().await;
        token.cancel();
        Instant::now()
    };
    let run = pipeline::execute(tools, model(&fixture.endpoint), None, None);
    let (cancelled, result) = tokio::join!(cancel, run);
    assert_eq!(result, Err(RunFailure::Cancelled));
    assert!(cancelled.elapsed() < Duration::from_millis(500));
}

mod context;
mod context_compaction;

#[tokio::test]
async fn committed_tool_survives_process_exit_before_rig_answer() {
    use crate::database::entity::ai_run;
    use sea_orm::{EntityTrait, TransactionTrait};

    for (tool, args, terminal, rejected) in [
        (
            "request_input",
            json!({"message":"选哪一章？"}),
            true,
            false,
        ),
        ("directory", json!({}), false, false),
        ("missing_tool", json!({}), false, true),
    ] {
        let (root, db, saved) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &saved, None)
            .await
            .unwrap();
        let session = ai::create_session(
            &db,
            ai::CreateSession {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: saved.document.project.id.clone(),
                task_kind: "project_assistant".into(),
                chapter_id: None,
                title: "恢复检查".into(),
            },
        )
        .await
        .unwrap();
        let run = ai::start_run(
            &db,
            ai::StartRun {
                resume: Vec::new(),
                workspace_context: Some(ai::WorkspaceContext {
                    action: ai::WorkspaceAction::Auto,
                    chapter_id: None,
                }),
                session_id: session.id.clone(),
                request_id: uuid::Uuid::new_v4().to_string(),
                configuration: ai::Configuration {
                    reasoning: None,
                    selection: crate::llm::ModelSelection {
                        connection_id: "connection".into(),
                        model_id: "model".into(),
                    },
                    revision: 1,
                },
                confirm_rebind: false,
                expected_project_revision: saved.document.project.revision,
                trigger: ai::Trigger::Message {
                    message: "请先查询工程。".into(),
                },
            },
            None,
        )
        .await
        .unwrap();
        let first_fixture = crate::llm::test_support::Fixture::raw(move |_, _, _| {
            let delta = json!({"role":"assistant","tool_calls":[{"index":0,"id":"original_call",
                "type":"function","function":{"name":tool,"arguments":args.to_string()}}]});
            (200, "text/event-stream", sse(0, delta, true))
        });
        let mut child = tokio::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "ai::assistant::tests::assistant_crash_worker",
            ])
            .env("CASTGLEAN_CRASH_FIXTURE_ROOT", root.path())
            .env("CASTGLEAN_CRASH_FIXTURE_RUN", &run.id)
            .env("CASTGLEAN_CRASH_FIXTURE_ENDPOINT", &first_fixture.endpoint)
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let status = tokio::time::timeout(Duration::from_secs(40), child.wait())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            status.code(),
            Some(77),
            "worker did not reach the post-commit crash"
        );
        db.close().await.unwrap();

        let db = crate::database::open(&root.path().join("app.sqlite3"))
            .await
            .unwrap();
        let before = ai::history_page(&db, &session.id, None, 20).await.unwrap();
        let expected_state = if rejected {
            ToolState::Failed
        } else {
            ToolState::Completed
        };
        let receipt = before
            .messages
            .iter()
            .flat_map(|message| message.parts.parts())
            .find(
                |part| matches!(part, MessagePart::Tool { state, .. } if *state == expected_state),
            )
            .expect("tool result must already be committed")
            .clone();
        let gates = ai::interrupts::pending(&db, &session.id).await.unwrap();
        assert_eq!(gates.len(), usize::from(terminal));

        let owner = uuid::Uuid::new_v4().to_string();
        ai::runs::interrupt_previous(&db, &owner).await.unwrap();
        let lease = ai::runs::claim(&db, &run.id, &owner)
            .await
            .unwrap()
            .unwrap();
        let attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let tracker = attempts.clone();
        let second_fixture = crate::llm::test_support::Fixture::raw(move |_, _, body| {
            tracker.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let paired =
                body["messages"].as_array().unwrap().iter().any(|entry| {
                    entry["role"] == "tool" && entry["tool_call_id"] == "original_call"
                });
            if !paired {
                return (400, "text/plain", Vec::new());
            }
            (
                200,
                "text/event-stream",
                sse(
                    1,
                    json!({"role":"assistant","content":"已读取目录。"}),
                    false,
                ),
            )
        });
        let result = pipeline::execute(
            tool_context(root.path(), &db, &lease),
            model(&second_fixture.endpoint),
            None,
            None,
        )
        .await;
        let finished = if rejected {
            assert_eq!(result, Err(RunFailure::ToolFailed));
            ai::runs::finish(
                &db,
                &lease,
                ai::RunStatus::Failed,
                Some(RunFailure::ToolFailed),
            )
        } else {
            result.unwrap();
            ai::runs::finish(&db, &lease, ai::RunStatus::WaitingForInput, None)
        }
        .await
        .unwrap();
        assert_eq!(
            finished.status,
            if rejected {
                ai::RunStatus::Failed
            } else if terminal {
                ai::RunStatus::WaitingForInput
            } else {
                ai::RunStatus::Succeeded
            }
        );
        assert_eq!(
            attempts.load(std::sync::atomic::Ordering::SeqCst),
            usize::from(!terminal && !rejected)
        );

        let after = ai::history_page(&db, &session.id, None, 20).await.unwrap();
        let facts = after
            .messages
            .iter()
            .flat_map(|message| message.parts.parts())
            .filter(|part| matches!(part, MessagePart::Tool { .. }))
            .collect::<Vec<_>>();
        // The same receipt, tool attempt, and interrupt survive a real process exit.
        assert_eq!(facts, vec![&receipt]);
        assert_eq!(after.session.budget.tool_calls, 1);
        assert_eq!(
            after.session.budget.requests,
            if terminal || rejected { 1 } else { 2 }
        );
        let actual_gates = ai::interrupts::pending(&db, &session.id).await.unwrap();
        assert_eq!(actual_gates, gates);
        let saved = ai_run::Entity::find_by_id(&run.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert!(saved.agent_checkpoint.is_none());
        let tx = db.begin().await.unwrap();
        assert!(ai::runs::lock(&tx, &lease, true).await.is_err());
    }
}

#[tokio::test]
#[ignore = "subprocess fixture for the post-tool-commit abrupt exit test"]
async fn assistant_crash_worker() {
    let root = std::path::PathBuf::from(std::env::var_os("CASTGLEAN_CRASH_FIXTURE_ROOT").unwrap());
    let run = std::env::var("CASTGLEAN_CRASH_FIXTURE_RUN").unwrap();
    let endpoint = std::env::var("CASTGLEAN_CRASH_FIXTURE_ENDPOINT").unwrap();
    let db = crate::database::open(&root.join("app.sqlite3"))
        .await
        .unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let lease = ai::runs::claim(&db, &run, &owner).await.unwrap().unwrap();
    if let Ok(value) = std::env::var("CASTGLEAN_CRASH_FIXTURE_CONTEXT_WINDOW") {
        super::compaction::AFTER_COMPACTION
            .scope(
                || std::process::exit(78),
                pipeline::execute(
                    tool_context(&root, &db, &lease),
                    model(&endpoint),
                    None,
                    Some(value.parse().unwrap()),
                ),
            )
            .await
            .unwrap();
        panic!("the context summary was not committed");
    }
    durable::BEFORE_ANSWER
        .scope(
            || std::process::exit(77),
            pipeline::execute(
                tool_context(&root, &db, &lease),
                model(&endpoint),
                None,
                None,
            ),
        )
        .await
        .unwrap();
    panic!("the tool response was not produced");
}
