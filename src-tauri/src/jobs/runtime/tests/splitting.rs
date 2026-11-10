//! Native SSE + SQLite: direct delegation, atomic candidate, and explicit retry.
use super::*;
use crate::{
    ai::messages::{MessagePart, ToolState},
    database::entity::split_proposal,
};
use serde_json::{Value, json};
const TRIGGER: &str = "请检查分章。original-trigger";
const INSTRUCTION: &str = "保留人工修正，提交一个待采用分章候选。durable-instruction";
fn tool_response(index: usize, name: &str, args: Value) -> Vec<u8> {
    let call = if index >= 2 { 0 } else { index };
    let chunk = json!({"id":format!("reply{index}"),"object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":format!("call-{call}"),"type":"function","function":{"name":name,"arguments":args.to_string()}}]},"finish_reason":null}]});
    let end = json!({"id":"end","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]});
    format!("data: {chunk}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes()
}
async fn delegation(fail_child: bool) {
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let server = Fixture::raw(move |index, _, body| {
        observed.fetch_add(1, Ordering::SeqCst);
        let mut names = body["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["function"]["name"].as_str().unwrap())
            .collect::<Vec<_>>();
        names.sort_unstable();
        if index < 2 {
            let mut expected = vec![
                "directory",
                "search_headings",
                "read_context",
                "read_analysis",
                "analyze_chapter",
                "cast_voices",
                "check_splitting",
            ];
            expected.sort_unstable();
            assert_eq!(names, expected);
            assert!(body["messages"].to_string().contains(TRIGGER));
            return (
                200,
                "text/event-stream",
                if index == 0 {
                    tool_response(index, "directory", json!({}))
                } else {
                    tool_response(index, "check_splitting", json!({"instruction":INSTRUCTION}))
                },
            );
        }
        let mut expected = vec![
            "directory",
            "search_headings",
            "read_context",
            "compare_rules",
            "finish_splitting",
        ];
        expected.sort_unstable();
        assert_eq!(names, expected);
        let wire = body["messages"].to_string();
        assert!(wire.contains(INSTRUCTION));
        assert!(!wire.contains(TRIGGER));
        assert!(!wire.contains("check_splitting"));
        assert_eq!(
            body["messages"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|m| m["role"] != "system")
                .count(),
            1
        );
        if fail_child && index == 2 {
            return (
                401,
                "application/json",
                serde_json::to_vec(&json!({"error":{"message":"fixture failure"}})).unwrap(),
            );
        }
        assert_eq!(index, if fail_child { 3 } else { 2 });
        (
            200,
            "text/event-stream",
            tool_response(
                index,
                "finish_splitting",
                json!({"plan":{"kind":"rules","rules":crate::novel_import::heading_rules()}}),
            ),
        )
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
            title: "分章委派".into(),
        },
    )
    .await
    .unwrap();
    let request = StartRun {
        session_id: session.id.clone(),
        request_id: uuid::Uuid::new_v4().to_string(),
        configuration: Configuration {
            reasoning: None,
            selection,
            revision,
        },
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
    let original = ai::start_run(&db, request.clone(), None).await.unwrap();
    super::super::super::setup(&db).await.unwrap();
    let runtime = Runtime::new(
        super::super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    let mut queue = SqliteStorage::new(db.get_sqlite_connection_pool());
    runtime.dispatch(&mut queue).await.unwrap();
    let task = worker(runtime.clone(), queue.clone());
    let first = wait_terminal(&db, &original.id).await;
    wait_idle(&runtime).await;
    assert_eq!(first.workspace_context.as_ref().unwrap()["action"], "split");
    let failed = if fail_child {
        Some(first.clone())
    } else {
        None
    };
    let terminal = if fail_child {
        assert_eq!(first.status, "failed");
        assert_eq!(first.error.as_deref(), Some("configuration_unavailable"));
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert_eq!(split_proposal::Entity::find().count(&db).await.unwrap(), 0);
        let retry = ai::start_run(
            &db,
            StartRun {
                request_id: uuid::Uuid::new_v4().to_string(),
                trigger: Trigger::Retry {
                    run_id: original.id.clone(),
                },
                ..request
            },
            None,
        )
        .await
        .unwrap();
        runtime.dispatch(&mut queue).await.unwrap();
        let terminal = wait_terminal(&db, &retry.id).await;
        wait_idle(&runtime).await;
        assert_eq!(terminal.retry_of.as_deref(), Some(original.id.as_str()));
        assert_eq!(terminal.trigger_message_id, first.trigger_message_id);
        terminal
    } else {
        first
    };
    assert_eq!(terminal.status, "waiting_for_input", "{:?}", terminal.error);
    assert_eq!(calls.load(Ordering::SeqCst), if fail_child { 4 } else { 3 });
    for id in [&original.id, &terminal.id] {
        runtime.handle(RunJob { run_id: id.clone() }).await.unwrap();
    }
    assert_eq!(calls.load(Ordering::SeqCst), if fail_child { 4 } else { 3 });
    let page = ai::history_page(&db, &session.id, None, 100).await.unwrap();
    assert_eq!(page.session.budget.requests, if fail_child { 4 } else { 3 });
    assert_eq!(page.session.budget.tool_calls, 3);
    assert_eq!(
        page.messages
            .iter()
            .filter(|m| m.role == "assistant")
            .count(),
        if fail_child { 2 } else { 1 }
    );
    let completed = page
        .messages
        .iter()
        .find(|m| m.run_id.as_deref() == Some(terminal.id.as_str()) && m.role == "assistant")
        .unwrap();
    assert_eq!(completed.status, "complete");
    let facts = page
        .messages
        .iter()
        .flat_map(|m| m.parts.parts())
        .filter_map(|p| match p {
            MessagePart::Tool {
                id,
                name,
                state,
                result,
                ..
            } => Some((id, name, state, result)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        facts.iter().map(|f| f.1.as_str()).collect::<Vec<_>>(),
        ["directory", "check_splitting", "finish_splitting"]
    );
    assert_eq!(
        facts
            .iter()
            .map(|f| f.0)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        3
    );
    assert!(facts.iter().all(|f| *f.2 == ToolState::Completed));
    let reference = facts.last().unwrap().3.as_ref().unwrap();
    let candidate = crate::novel_import::splitting::store::query(&db, &reference.id)
        .await
        .unwrap();
    assert!(!candidate.stale);
    assert_eq!(
        candidate.status,
        crate::novel_import::splitting::store::ProposalStatus::Pending
    );
    assert_eq!(split_proposal::Entity::find().count(&db).await.unwrap(), 1);
    assert_eq!(
        store::read(&db, root.path(), "project")
            .await
            .unwrap()
            .document
            .project
            .revision,
        1
    );
    if let Some(first) = failed {
        let saved = ai_run::Entity::find_by_id(&first.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.status, "failed");
        assert_eq!(saved.budget, first.budget);
    }
    assert_eq!(ai::active_tasks(&db).await.unwrap(), 0);
    task.abort();
}
#[tokio::test]
async fn natural_language_split_delegates_to_an_isolated_atomic_task() {
    delegation(false).await;
}
#[tokio::test]
async fn accepted_split_retry_skips_parent_and_keeps_failed_cost() {
    delegation(true).await;
}
