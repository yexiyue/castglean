//! Context boundaries use the real project/session store and native Rig wire format.
use super::*;
use crate::{
    ai::{
        Configuration, CreateSession, RunStatus, StartRun, Trigger, WorkspaceAction,
        WorkspaceContext, dispatch::ToolDispatch, runs::Lease,
    },
    llm::test_support::Fixture,
    project::{store, test_support::fixture},
};
use rig_core::message::UserContent;
use sea_orm::{DatabaseConnection, EntityTrait};
use std::sync::atomic::{AtomicUsize, Ordering};

const OLD_USER: &str = "unrelated-user-context-marker";
const OLD_ASSISTANT: &str = "unrelated-assistant-context-marker";
const OLD_FACT: &str = "unrelated-tool-fact-marker";
const SPLIT_TRIGGER: &str = "请检查分章 split-trigger-marker";

#[tokio::test]
async fn delegated_split_excludes_parent_facts_from_prior_attempts() {
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let session = session(&db).await;
    let first = start(&db, &session, WorkspaceAction::Auto, message(OLD_USER)).await;
    fact(&db, &first, OLD_ASSISTANT, OLD_FACT, false).await;
    finish(&db, &first, RunStatus::Failed).await;
    let retry = start(
        &db,
        &session,
        WorkspaceAction::Auto,
        Trigger::Retry {
            run_id: first.run_id().into(),
        },
    )
    .await;
    let tools = tool_context(root.path(), &db, &retry);
    let output = Output::new(db.clone(), retry.clone());
    output.start(1).await.unwrap();
    let input = json!({"instruction":"独立分章约束：保留序章"});
    tools
        .dispatch
        .begin(
            &output.id().await.unwrap(),
            "delegate",
            "check_splitting",
            input.clone(),
        )
        .await
        .unwrap();
    let accepted = tools
        .run_tool("check_splitting", input.clone())
        .await
        .unwrap();
    assert_eq!(accepted.as_json().unwrap()["status"], "accepted");
    tools
        .dispatch
        .complete(
            "delegate",
            "check_splitting",
            &input,
            accepted.as_json().unwrap().clone(),
            false,
        )
        .await
        .unwrap();
    output.text("父Agent受理后的说明").await.unwrap();
    let child_input = json!({});
    tools
        .dispatch
        .begin(
            &output.id().await.unwrap(),
            "child",
            "directory",
            child_input.clone(),
        )
        .await
        .unwrap();
    tools
        .dispatch
        .complete(
            "child",
            "directory",
            &child_input,
            json!({"child":true}),
            false,
        )
        .await
        .unwrap();
    let projected = ai::task_input(&db, &retry).await.unwrap();
    let wire = serde_json::to_string(&projected).unwrap();
    for marker in [
        OLD_USER,
        OLD_ASSISTANT,
        OLD_FACT,
        "父Agent受理后的说明",
        "check_splitting",
    ] {
        assert!(!wire.contains(marker), "parent context leaked: {marker}");
    }
    assert!(wire.contains("独立分章约束：保留序章"));
    assert!(wire.contains("directory"));
    assert_eq!(projected.len(), 3);
    assert_ui_history(&db, &session).await;
}

async fn session(db: &DatabaseConnection) -> String {
    ai::create_session(
        db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            task_kind: "project_assistant".into(),
            chapter_id: None,
            title: "工程助手上下文回归".into(),
        },
    )
    .await
    .unwrap()
    .id
}

async fn start(
    db: &DatabaseConnection,
    session: &str,
    action: WorkspaceAction,
    trigger: Trigger,
) -> Lease {
    let run = ai::start_run(
        db,
        StartRun {
            session_id: session.into(),
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: Configuration {
                selection: crate::llm::ModelSelection {
                    connection_id: "connection".into(),
                    model_id: "model".into(),
                },
                revision: 1,
            },
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger,
            workspace_context: Some(WorkspaceContext {
                action,
                chapter_id: Some("chapter".into()),
            }),
        },
    )
    .await
    .unwrap();
    ai::runs::claim(db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap()
}

fn message(text: &str) -> Trigger {
    Trigger::Message {
        message: text.into(),
    }
}

async fn finish(db: &DatabaseConnection, lease: &Lease, status: RunStatus) {
    ai::runs::finish(db, lease, status, None).await.unwrap();
}

// Persist facts through the same leased Output/dispatch APIs as the native hook.
// No model request is needed to arrange history for the boundary under test.
async fn fact(
    db: &DatabaseConnection,
    lease: &Lease,
    text: &str,
    marker: &str,
    complete: bool,
) -> String {
    let output = Output::new(db.clone(), lease.clone());
    output.start(1).await.unwrap();
    output.text(text).await.unwrap();
    let dispatch = ToolDispatch::new(db.clone(), lease.clone());
    let input = json!({"page":0});
    dispatch
        .begin(
            &output.id().await.unwrap(),
            marker,
            "directory",
            input.clone(),
        )
        .await
        .unwrap();
    let id = dispatch.accepted("directory", &input).await.unwrap().id;
    dispatch
        .complete(marker, "directory", &input, json!({"marker":marker}), false)
        .await
        .unwrap();
    if complete {
        output.complete().await.unwrap();
    }
    id
}

async fn prior_history(db: &DatabaseConnection, session: &str) -> String {
    let lease = start(db, session, WorkspaceAction::Auto, message(OLD_USER)).await;
    let id = fact(db, &lease, OLD_ASSISTANT, OLD_FACT, true).await;
    finish(db, &lease, RunStatus::WaitingForInput).await;
    id
}

async fn assert_ui_history(db: &DatabaseConnection, session: &str) {
    let page = ai::history_page(db, session, None, 100).await.unwrap();
    assert_eq!(page.session.task_kind, "project_assistant");
    assert!(page.before.is_none());
    for (role, marker) in [("user", OLD_USER), ("assistant", OLD_ASSISTANT)] {
        assert!(
            page.messages.iter().any(|m| {
                m.role == role
                    && m.parts
                        .parts()
                        .iter()
                        .any(|p| matches!(p, MessagePart::Text { text } if text == marker))
            }),
            "UI history lost {marker}"
        );
    }
    assert!(page.messages.iter().flat_map(|m| m.parts.parts()).any(|p| {
        matches!(p, MessagePart::Tool {
            name, state: ToolState::Completed, output: Some(value), ..
        } if name == "directory" && value["marker"] == OLD_FACT)
    }));
}

#[tokio::test]
async fn explicit_split_excludes_unrelated_history_and_analysis_tools_on_every_request() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = Fixture::raw(move |index, _, body| {
        seen.fetch_add(1, Ordering::SeqCst);
        assert_eq!(body["stream"], true);
        let wire = body["messages"].to_string();
        assert!(wire.contains(SPLIT_TRIGGER));
        for marker in [OLD_USER, OLD_ASSISTANT, OLD_FACT] {
            assert!(!wire.contains(marker), "split leaked {marker}: {wire}");
        }
        let tools = body["tools"].as_array().unwrap();
        assert!(tools.iter().any(|t| t["function"]["name"] == "directory"));
        assert!(
            tools
                .iter()
                .all(|t| t["function"]["name"] != "analyze_chapter")
        );
        let (delta, tool) = match index {
            0 => {
                assert_eq!(
                    body["messages"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|m| m["role"] != "system")
                        .count(),
                    1
                );
                (
                    json!({"role":"assistant","tool_calls":[{"index":0,"id":"current-directory","type":"function","function":{"name":"directory","arguments":"{}"}}]}),
                    true,
                )
            }
            1 => {
                let results: Vec<_> = body["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|m| m["role"] == "tool")
                    .collect();
                assert_eq!(results.len(), 1);
                assert_eq!(results[0]["tool_call_id"], "current-directory");
                assert!(results[0]["content"].to_string().contains("source"));
                (
                    json!({"role":"assistant","content":"目录已检查，等待讨论。"}),
                    false,
                )
            }
            _ => panic!("unexpected extra split request"),
        };
        (200, "text/event-stream", sse(index, delta, tool))
    });
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let session = session(&db).await;
    prior_history(&db, &session).await;
    let before = ai::history_page(&db, &session, None, 100).await.unwrap();
    let lease = start(
        &db,
        &session,
        WorkspaceAction::Split,
        message(SPLIT_TRIGGER),
    )
    .await;
    execute(
        tool_context(root.path(), &db, &lease),
        model(&server.endpoint),
        None,
    )
    .await
    .unwrap();
    finish(&db, &lease, RunStatus::WaitingForInput).await;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_ui_history(&db, &session).await;
    let after = ai::history_page(&db, &session, None, 100).await.unwrap();
    assert_eq!(after.messages.len(), before.messages.len() + 2);
    // Isolating model input must not rewrite or remove visible earlier messages.
    assert_eq!(
        serde_json::to_value(&after.messages[..before.messages.len()]).unwrap(),
        serde_json::to_value(&before.messages).unwrap()
    );
}

#[tokio::test]
async fn auto_conversation_keeps_prior_user_assistant_and_tool_history() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = Fixture::raw(move |index, _, body| {
        seen.fetch_add(1, Ordering::SeqCst);
        assert_eq!(index, 0);
        assert_eq!(body["stream"], true);
        let messages = body["messages"].as_array().unwrap();
        for (role, marker) in [
            ("user", OLD_USER),
            ("assistant", OLD_ASSISTANT),
            ("tool", OLD_FACT),
            ("user", "auto-followup-marker"),
        ] {
            assert!(
                messages
                    .iter()
                    .any(|m| m["role"] == role && m["content"].to_string().contains(marker)),
                "Auto lost {role} history: {marker}"
            );
        }
        let tool = messages.iter().find(|m| m["role"] == "tool").unwrap();
        assert!(
            messages
                .iter()
                .filter_map(|m| m["tool_calls"].as_array())
                .flatten()
                .any(|call| call["id"] == tool["tool_call_id"]
                    && call["function"]["name"] == "directory")
        );
        assert!(
            body["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["function"]["name"] == "analyze_chapter")
        );
        (
            200,
            "text/event-stream",
            sse(
                index,
                json!({"role":"assistant","content":"我能看到先前的讨论。"}),
                false,
            ),
        )
    });
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let session = session(&db).await;
    prior_history(&db, &session).await;
    let lease = start(
        &db,
        &session,
        WorkspaceAction::Auto,
        message("auto-followup-marker"),
    )
    .await;
    execute(
        tool_context(root.path(), &db, &lease),
        model(&server.endpoint),
        None,
    )
    .await
    .unwrap();
    finish(&db, &lease, RunStatus::WaitingForInput).await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_ui_history(&db, &session).await;
}

#[tokio::test]
async fn split_retry_projects_all_same_trigger_attempts_with_complete_tool_pairs_only() {
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let session = session(&db).await;
    prior_history(&db, &session).await;
    let first = start(
        &db,
        &session,
        WorkspaceAction::Split,
        message(SPLIT_TRIGGER),
    )
    .await;
    let first_id = fact(
        &db,
        &first,
        "partial-first-attempt",
        "first-task-fact",
        false,
    )
    .await;
    finish(&db, &first, RunStatus::Failed).await;

    // Interleave a different professional task in the SAME session. Filtering by
    // session, action, or an ordinal range would incorrectly retain this task.
    let other = start(
        &db,
        &session,
        WorkspaceAction::Split,
        message("other-task-trigger"),
    )
    .await;
    fact(&db, &other, "other-task-answer", "other-task-fact", true).await;
    finish(&db, &other, RunStatus::WaitingForInput).await;

    let retry = start(
        &db,
        &session,
        WorkspaceAction::Auto,
        Trigger::Retry {
            run_id: first.run_id().into(),
        },
    )
    .await;
    let retry_id = fact(
        &db,
        &retry,
        "partial-retry-attempt",
        "retry-task-fact",
        false,
    )
    .await;
    finish(&db, &retry, RunStatus::Failed).await;
    let current = start(
        &db,
        &session,
        WorkspaceAction::Auto,
        Trigger::Retry {
            run_id: retry.run_id().into(),
        },
    )
    .await;
    let rows = [first.run_id(), retry.run_id(), current.run_id()];
    let mut trigger = None;
    for id in rows {
        let run = crate::database::entity::ai_run::Entity::find_by_id(id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.workspace_context.as_ref().unwrap()["action"], "split");
        if let Some(expected) = &trigger {
            assert_eq!(&run.trigger_message_id, expected);
        } else {
            trigger = Some(run.trigger_message_id);
        }
    }
    let projected = ai::task_input(&db, &current).await.unwrap();
    assert_eq!(
        projected.len(),
        5,
        "one trigger plus two completed call/result pairs"
    );
    let Message::User { content } = &projected[0] else {
        panic!("missing immutable trigger")
    };
    let UserContent::Text(text) = &content[0] else {
        panic!("trigger must remain text")
    };
    assert_eq!(text.text, SPLIT_TRIGGER);
    for (pair, (id, marker)) in projected[1..]
        .as_chunks::<2>()
        .0
        .iter()
        .zip([(first_id, "first-task-fact"), (retry_id, "retry-task-fact")])
    {
        let Message::Assistant(turn) = &pair[0] else {
            panic!("missing tool call")
        };
        assert_eq!(turn.tool_calls().count(), 1);
        let call = turn.tool_calls().next().unwrap();
        let Message::User { content } = &pair[1] else {
            panic!("missing tool result")
        };
        assert_eq!(content.len(), 1);
        let UserContent::ToolResult(result) = &content[0] else {
            panic!("unpaired tool result")
        };
        assert_eq!(call.id.to_string(), id);
        assert_eq!(result.call, call.id);
        assert!(!result.is_error);
        assert!(serde_json::to_string(result).unwrap().contains(marker));
    }
    let wire = serde_json::to_string(&projected).unwrap();
    for marker in [
        OLD_USER,
        OLD_ASSISTANT,
        OLD_FACT,
        "other-task-trigger",
        "other-task-answer",
        "other-task-fact",
        "partial-first-attempt",
        "partial-retry-attempt",
    ] {
        assert!(!wire.contains(marker), "retry leaked {marker}");
    }
    assert_ui_history(&db, &session).await;
    let page = ai::history_page(&db, &session, None, 100).await.unwrap();
    assert_eq!(
        page.messages.len(),
        7,
        "retry must reuse its original user message"
    );
    let visible = serde_json::to_string(&page.messages).unwrap();
    for marker in [
        "other-task-trigger",
        "other-task-answer",
        "other-task-fact",
        "partial-first-attempt",
        "partial-retry-attempt",
    ] {
        assert!(visible.contains(marker), "UI lost {marker}");
    }
}
