//! Real SQLite worker + native SSE delegation, with no external provider.
use super::*;
use crate::{
    ai::messages::{MessagePart, ToolState},
    database::entity::split_proposal,
};
use serde_json::{Value, json};

const TRIGGER: &str = "请帮我检查这本书的分章。original-user-marker";
const INSTRUCTION: &str =
    "检查整本小说的标题规则，保留人工修正，生成分章候选并提交人工审阅。durable-instruction-marker";
const PARENT: &str = "已受理，接下来检查分章。parent-answer-marker";
const FINAL: &str = "分章候选已生成，尚未采用，请审阅。specialist-final-marker";

fn tool_response(index: usize, name: &str, args: Value) -> Vec<u8> {
    let call_index = if index >= 3 { index - 3 } else { index };
    let chunk = json!({"id":format!("reply-{index}"),"object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":format!("call-{call_index}"),"type":"function","function":{"name":name,"arguments":args.to_string()}}]},"finish_reason":null}]});
    let end = json!({"id":format!("reply-{index}"),"object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]});
    format!("data: {chunk}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes()
}

fn tool_output(body: &Value, id: &str) -> Value {
    let result = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["role"] == "tool" && m["tool_call_id"] == id)
        .unwrap_or_else(|| panic!("missing result for {id}"));
    serde_json::from_str(result["content"].as_str().unwrap()).unwrap()
}

fn assert_tools(body: &Value, expected: &[&str]) {
    let mut names: Vec<_> = body["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["function"]["name"].as_str().unwrap())
        .collect();
    let mut expected = expected.to_vec();
    names.sort_unstable();
    expected.sort_unstable();
    assert_eq!(names, expected, "phase must expose only its intended tools");
}

fn fixture_response(index: usize, body: &Value, fail_parent: bool) -> (u16, &'static str, Vec<u8>) {
    assert_eq!(body["stream"], true);
    if index <= 2 {
        assert_tools(
            body,
            &[
                "directory",
                "search_headings",
                "read_context",
                "read_analysis",
                "analyze_chapter",
                "check_splitting",
            ],
        );
        assert!(body["messages"].to_string().contains(TRIGGER));
        let schema = body["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["function"]["name"] == "check_splitting")
            .unwrap();
        assert!(
            schema["function"]["parameters"]["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "instruction")
        );
    } else {
        assert_tools(
            body,
            &[
                "directory",
                "search_headings",
                "read_context",
                "test_rules",
                "patch_boundaries",
                "submit_proposal",
            ],
        );
        let wire = body["messages"].to_string();
        assert!(wire.contains(INSTRUCTION));
        for excluded in [TRIGGER, PARENT, "check_splitting"] {
            assert!(
                !wire.contains(excluded),
                "specialist leaked parent context {excluded}: {wire}"
            );
        }
        if index == 3 {
            let messages: Vec<_> = body["messages"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|m| m["role"] != "system")
                .collect();
            assert_eq!(
                messages.len(),
                1,
                "specialist starts with only the durable instruction"
            );
            assert_eq!(messages[0]["role"], "user");
            // Rig may encode content as text or typed blocks.
            let content = &messages[0]["content"];
            if let Some(text) = content.as_str() {
                assert_eq!(text, INSTRUCTION);
            } else {
                assert_eq!(content.as_array().unwrap().len(), 1);
                assert_eq!(content[0]["text"], INSTRUCTION);
            }
        }
    }
    let bytes = match index {
        0 => tool_response(index, "directory", json!({})),
        1 => {
            assert!(tool_output(body, "call-0").to_string().contains("source"));
            tool_response(index, "check_splitting", json!({"instruction":INSTRUCTION}))
        }
        2 => {
            let accepted = tool_output(body, "call-1");
            assert_eq!(accepted["status"], "accepted");
            assert_eq!(accepted["published"], false);
            if fail_parent {
                return (
                    401,
                    "application/json",
                    serde_json::to_vec(&json!({"error":{"message":"fixture parent failure"}}))
                        .unwrap(),
                );
            }
            response(PARENT)
        }
        3 => tool_response(
            index,
            "test_rules",
            json!({"rules":crate::novel_import::heading_rules()}),
        ),
        4 => {
            let proposal = tool_output(body, "call-0");
            let id = proposal["proposal_id"]
                .as_str()
                .expect("test_rules must publish a candidate");
            tool_response(index, "submit_proposal", json!({"proposal_id":id}))
        }
        5 => {
            let submitted = tool_output(body, "call-1");
            assert_eq!(submitted["status"], "waiting_for_user");
            assert_eq!(submitted["adopted"], false);
            response(FINAL)
        }
        _ => panic!("duplicate or unexpected model dispatch {index}"),
    };
    (200, "text/event-stream", bytes)
}

fn budget(row: &ai_run::Model) -> ai::Budget {
    serde_json::from_value::<ai::budget::Ledger>(row.budget.clone())
        .unwrap()
        .total()
        .unwrap()
}

async fn delegation(fail_parent: bool) {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = Fixture::raw(move |index, _, body| {
        seen.fetch_add(1, Ordering::SeqCst);
        fixture_response(index, body, fail_parent)
    });
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_config, llm, selection, revision) = configured(&server.endpoint);
    let session = ai::create_session(
        &db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            task_kind: "project_assistant".into(),
            chapter_id: None,
            title: "自然语言分章委派".into(),
        },
    )
    .await
    .unwrap();
    let config = Configuration {
        selection,
        revision,
    };
    let request = StartRun {
        session_id: session.id.clone(),
        request_id: uuid::Uuid::new_v4().to_string(),
        configuration: config.clone(),
        confirm_rebind: false,
        expected_project_revision: 1,
        workspace_context: Some(ai::WorkspaceContext {
            action: ai::WorkspaceAction::Auto,
            chapter_id: Some("chapter".into()),
        }),
        trigger: Trigger::Message {
            message: TRIGGER.into(),
        },
    };
    let original = ai::start_run(&db, request.clone()).await.unwrap();
    super::super::super::setup(&db).await.unwrap();
    let runtime = Runtime::new(
        super::super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
    );
    let mut queue = SqliteStorage::new(db.get_sqlite_connection_pool());
    runtime.dispatch(&mut queue).await.unwrap();
    let task = worker(runtime.clone(), queue.clone());
    let first = wait_terminal(&db, &original.id).await;
    wait_idle(&runtime).await;
    assert_eq!(first.workspace_context.as_ref().unwrap()["action"], "split");
    let mut failed_snapshot = None;
    let mut failed_message = None;
    let final_run = if fail_parent {
        assert_eq!(first.status, "failed", "{:?}", first.error);
        assert_eq!(first.error.as_deref(), Some("configuration_unavailable"));
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        let cost = budget(&first);
        assert_eq!((cost.requests, cost.tool_calls), (3, 2));
        assert!(cost.input_bytes > 0 && cost.tool_bytes > 0);
        assert_eq!(split_proposal::Entity::find().count(&db).await.unwrap(), 0);
        let page = ai::history_page(&db, &session.id, None, 100).await.unwrap();
        let assistant = page
            .messages
            .iter()
            .find(|m| m.role == "assistant")
            .unwrap();
        assert_eq!(assistant.status, "interrupted");
        assert!(assistant.parts.parts().iter().any(|p| matches!(p, MessagePart::Tool {
            name, state: ToolState::Completed, input, output: Some(output), ..
        } if name == "check_splitting" && input["instruction"] == INSTRUCTION && output["status"] == "accepted")));
        failed_message = Some(serde_json::to_value(assistant).unwrap());
        failed_snapshot = Some(first.clone());
        runtime
            .handle(RunJob {
                run_id: original.id.clone(),
            })
            .await
            .unwrap();
        assert_eq!(
            calls.load(Ordering::SeqCst),
            3,
            "failed delivery cannot implicitly retry"
        );
        let retry = ai::start_run(
            &db,
            StartRun {
                request_id: uuid::Uuid::new_v4().to_string(),
                trigger: Trigger::Retry {
                    run_id: original.id.clone(),
                },
                ..request
            },
        )
        .await
        .unwrap();
        assert_ne!(retry.id, original.id);
        runtime.dispatch(&mut queue).await.unwrap();
        let terminal = wait_terminal(&db, &retry.id).await;
        wait_idle(&runtime).await;
        assert_eq!(terminal.retry_of.as_deref(), Some(original.id.as_str()));
        assert_eq!(terminal.trigger_message_id, first.trigger_message_id);
        terminal
    } else {
        first
    };
    assert_eq!(
        final_run.status, "waiting_for_input",
        "{:?}",
        final_run.error
    );
    assert!(final_run.error.is_none());
    assert_eq!(calls.load(Ordering::SeqCst), 6);
    for id in [&original.id, &final_run.id] {
        runtime.handle(RunJob { run_id: id.clone() }).await.unwrap();
    }
    assert_eq!(
        calls.load(Ordering::SeqCst),
        6,
        "redelivery must not repeat either phase"
    );
    let total = budget(&final_run);
    assert_eq!((total.requests, total.tool_calls), (6, 4));
    let page = ai::history_page(&db, &session.id, None, 100).await.unwrap();
    assert_eq!(page.session.budget, total);
    assert_eq!(page.messages.iter().filter(|m| m.role == "user").count(), 1);
    assert_eq!(
        page.messages
            .iter()
            .filter(|m| m.role == "assistant")
            .count(),
        if fail_parent { 2 } else { 1 }
    );
    let completed = page
        .messages
        .iter()
        .find(|m| m.role == "assistant" && m.run_id.as_deref() == Some(final_run.id.as_str()))
        .unwrap();
    assert_eq!(completed.status, "complete");
    let final_text = serde_json::to_string(completed.parts.parts()).unwrap();
    assert!(final_text.contains(FINAL));
    if !fail_parent {
        assert!(
            final_text.contains(PARENT),
            "parent and specialist must share one readable message"
        );
    }
    let facts: Vec<_> = page
        .messages
        .iter()
        .flat_map(|m| m.parts.parts())
        .filter_map(|p| {
            if let MessagePart::Tool {
                name,
                state,
                input,
                output,
                result,
                ..
            } = p
            {
                assert_eq!(*state, ToolState::Completed);
                Some((name.as_str(), input, output.as_ref().unwrap(), result))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        facts.iter().map(|f| f.0).collect::<Vec<_>>(),
        [
            "directory",
            "check_splitting",
            "test_rules",
            "submit_proposal"
        ]
    );
    assert_eq!(facts[1].1["instruction"], INSTRUCTION);
    assert_eq!(facts[1].2["status"], "accepted");
    let proposals = split_proposal::Entity::find().all(&db).await.unwrap();
    assert_eq!(proposals.len(), 1);
    let proposal = &proposals[0];
    assert_eq!(proposal.status, "pending");
    assert_eq!(proposal.run_id, final_run.id);
    assert_eq!(facts[2].2["proposal_id"], proposal.id);
    assert_eq!(facts[2].3.as_ref().unwrap().id, proposal.id);
    assert_eq!(facts[3].1["proposal_id"], proposal.id);
    assert_eq!(facts[3].2["adopted"], false);
    let latest = store::read(&db, root.path(), "project").await.unwrap();
    assert_eq!(
        latest.document.project.revision,
        project.document.project.revision
    );
    assert_eq!(
        serde_json::to_value(&latest.document).unwrap(),
        serde_json::to_value(&project.document).unwrap(),
        "a candidate must not change the saved project"
    );
    if let Some(snapshot) = failed_snapshot {
        let unchanged = ai_run::Entity::find_by_id(&original.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            unchanged, snapshot,
            "retry must preserve original failure and cost ledger"
        );
        let old = page
            .messages
            .iter()
            .find(|m| m.run_id.as_deref() == Some(original.id.as_str()) && m.role == "assistant")
            .unwrap();
        assert_eq!(serde_json::to_value(old).unwrap(), failed_message.unwrap());
        assert!(total.input_bytes > budget(&snapshot).input_bytes);
        assert!(total.tool_bytes > budget(&snapshot).tool_bytes);
    }
    assert_eq!(ai::active_tasks(&db).await.unwrap(), 0);
    task.abort();
}

#[tokio::test]
async fn natural_language_splitting_delegates_isolated_specialist_in_one_worker_run() {
    delegation(false).await;
}

#[tokio::test]
async fn accepted_splitting_survives_parent_failure_and_explicit_retry_without_redelegation() {
    delegation(true).await;
}
