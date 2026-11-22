use super::*;
use crate::ai::{output::Output, runs, test_support::request};
use crate::database::entity::{ai_run, ai_session};
use sea_orm::{DatabaseConnection, EntityTrait, TransactionTrait};
use std::path::Path;

async fn seeded() -> (tempfile::TempDir, DatabaseConnection, ai::SessionInfo) {
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
            title: "上下文压缩".into(),
        },
    )
    .await
    .unwrap();
    for (user, call, text) in [
        (
            "OLD_USER",
            "old-tool",
            format!("OLD_TEXT {}", "一段可压缩的旧正文。".repeat(950)),
        ),
        ("KEEP_USER", "kept-tool", "KEEP_TEXT".into()),
    ] {
        let run = start(
            &db,
            &session,
            ai::Trigger::Message {
                message: user.into(),
            },
        )
        .await;
        let lease = claim(&db, &run).await;
        let output = Output::new(db.clone(), lease.clone());
        output.start(1).await.unwrap();
        let id = output.id().await.unwrap();
        let tx = db.begin().await.unwrap();
        ai::tools::begin(&tx, &lease, &id, call, "directory", json!({}))
            .await
            .unwrap();
        ai::tools::complete(&tx, &lease, &id, call, json!({"result":call}), false, None)
            .await
            .unwrap();
        runs::commit(tx, &lease).await.unwrap();
        output.text(&text).await.unwrap();
        output.complete().await.unwrap();
        runs::finish(&db, &lease, ai::RunStatus::Succeeded, None)
            .await
            .unwrap();
    }
    (root, db, session)
}

#[tokio::test]
async fn long_transcript_accepts_new_tool_identity_and_rejects_duplicate() {
    use sea_orm::{ConnectionTrait, Statement};

    let (_root, db, session) = seeded().await;
    let run = start(
        &db,
        &session,
        ai::Trigger::Message {
            message: "继续".into(),
        },
    )
    .await;
    let lease = claim(&db, &run).await;
    let output = Output::new(db.clone(), lease.clone());
    output.start(1).await.unwrap();
    let id = output.id().await.unwrap();
    let tx = db.begin().await.unwrap();
    assert!(matches!(
        ai::tools::begin(&tx, &lease, &id, "old-tool", "directory", json!({})).await,
        Err(ai::AiError::Conflict)
    ));
    tx.rollback().await.unwrap();

    // Fill the historical transcript without creating hundreds of model runs.
    db.execute_raw(Statement::from_sql_and_values(
        db.get_database_backend(),
        r#"WITH RECURSIVE lines(i) AS (
             SELECT 1 UNION ALL SELECT i + 1 FROM lines WHERE i < 257
         )
         INSERT INTO ai_messages (id, session_id, ordinal, role, version, parts, status, created_at)
         SELECT 'archived-' || i, ?, 1000 + i, 'user', 1,
                '{"version":1,"parts":[{"type":"text","text":"old"}]}',
                'complete', '2026-11-21'
         FROM lines"#,
        [session.id.as_str().into()],
    ))
    .await
    .unwrap();
    let tx = db.begin().await.unwrap();
    assert!(
        ai::tools::begin(&tx, &lease, &id, "fresh-tool", "directory", json!({}))
            .await
            .unwrap()
    );
    runs::commit(tx, &lease).await.unwrap();
}

async fn start(
    db: &DatabaseConnection,
    session: &ai::SessionInfo,
    trigger: ai::Trigger,
) -> ai::RunInfo {
    let mut request = request(session);
    request.workspace_context = Some(ai::WorkspaceContext {
        action: if matches!(trigger, ai::Trigger::Compact) {
            ai::WorkspaceAction::Compact
        } else {
            ai::WorkspaceAction::Auto
        },
        chapter_id: None,
        analysis_base_revision: None,
    });
    request.trigger = trigger;
    ai::start_run(db, request, None).await.unwrap()
}

async fn claim(db: &DatabaseConnection, run: &ai::RunInfo) -> runs::Lease {
    runs::claim(db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap()
}

fn summary_fixture() -> crate::llm::test_support::Fixture {
    crate::llm::test_support::Fixture::new(|index, _, body| {
        assert_eq!(index, 0);
        assert!(
            body.get("tools")
                .is_none_or(|tools| tools.as_array().is_some_and(Vec::is_empty))
        );
        let messages = body["messages"].to_string();
        assert!(messages.contains("OLD_TEXT"));
        assert!(messages.contains("old-tool"));
        assert!(!messages.contains("KEEP_USER"));
        (
            200,
            json!({"id":"summary", "object":"chat.completion", "model":"test",
            "choices":[{"index":0,"message":{"role":"assistant","content":"SUMMARY_OF_OLD_TEXT"},"finish_reason":"stop"}]}),
        )
    })
}

fn continued_fixture() -> crate::llm::test_support::Fixture {
    crate::llm::test_support::Fixture::raw(|index, _, body| {
        assert_eq!(
            index, 0,
            "committed compaction must not call the summarizer a second time"
        );
        let messages = body["messages"].as_array().unwrap();
        let text = body["messages"].to_string();
        assert!(
            text.contains("SUMMARY_OF_OLD_TEXT")
                && text.contains("KEEP_USER")
                && text.contains("NEXT_USER")
        );
        assert!(!text.contains("OLD_USER"));
        let calls: Vec<_> = messages
            .iter()
            .flat_map(|m| m["tool_calls"].as_array().into_iter().flatten())
            .collect();
        let results: Vec<_> = messages.iter().filter(|m| m["role"] == "tool").collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(results.len(), 1);
        assert_eq!(calls[0]["id"], results[0]["tool_call_id"]);
        assert_eq!(calls[0]["id"], "kept-tool");
        (
            200,
            "text/event-stream",
            sse(1, json!({"role":"assistant","content":"续跑完成。"}), false),
        )
    })
}

async fn continue_run(
    root: &Path,
    db: &DatabaseConnection,
    lease: &runs::Lease,
    window: Option<u32>,
) {
    let fixture = continued_fixture();
    pipeline::execute(
        tool_context(root, db, lease),
        model(&fixture.endpoint),
        None,
        window,
    )
    .await
    .unwrap();
    let run = runs::finish(db, lease, ai::RunStatus::WaitingForInput, None)
        .await
        .unwrap();
    assert_eq!(run.status, ai::RunStatus::Succeeded);
    let page = ai::history_page(db, lease.session_id(), None, 20)
        .await
        .unwrap();
    let full = serde_json::to_string(&page.messages).unwrap();
    assert!(full.contains("OLD_TEXT") && full.contains("old-tool") && full.contains("kept-tool"));
    assert!(!full.contains("SUMMARY_OF_OLD_TEXT"));
    assert_eq!(page.session.budget.tool_calls, 2);
    assert_eq!(page.session.budget.requests, 4);
}

#[tokio::test]
async fn manual_compaction_is_a_host_task_without_chat_messages() {
    let (root, db, session) = seeded().await;
    let before = ai::history_page(&db, &session.id, None, 20).await.unwrap();
    let fixture = summary_fixture();
    let run = start(&db, &session, ai::Trigger::Compact).await;
    let lease = claim(&db, &run).await;
    let tools = tool_context(root.path(), &db, &lease);
    ai::tasks::Execution {
        db: &db,
        lease: &lease,
        root: root.path(),
        token: &tools.token,
        workers: tools.workers.clone(),
        experiment: None,
        catalog: None,
        app: None,
    }
    .execute(ai::tasks::Model {
        client: model(&fixture.endpoint),
        generation: crate::chapter_analysis::Generation {
            model: serde_json::from_value(json!({"id":"model","modelId":"test","name":"test"}))
                .unwrap(),
            completion_options: Default::default(),
        },
    })
    .await
    .unwrap();
    runs::finish(&db, &lease, ai::RunStatus::WaitingForInput, None)
        .await
        .unwrap();
    let after = ai::history_page(&db, &session.id, None, 20).await.unwrap();
    assert_eq!(
        serde_json::to_value(before.messages).unwrap(),
        serde_json::to_value(after.messages).unwrap()
    );
    assert_eq!(after.session.context_compaction_run_id, Some(run.id));
    let next = start(
        &db,
        &session,
        ai::Trigger::Message {
            message: "NEXT_USER".into(),
        },
    )
    .await;
    let lease = claim(&db, &next).await;
    continue_run(root.path(), &db, &lease, None).await;
}

#[tokio::test]
async fn automatic_compaction_and_tool_pairs_survive_process_exit() {
    let (root, db, session) = seeded().await;
    let run = start(
        &db,
        &session,
        ai::Trigger::Message {
            message: "NEXT_USER".into(),
        },
    )
    .await;
    let fixture = summary_fixture();
    let mut child = tokio::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "ai::assistant::tests::assistant_crash_worker",
        ])
        .env("CASTGLEAN_CRASH_FIXTURE_ROOT", root.path())
        .env("CASTGLEAN_CRASH_FIXTURE_RUN", &run.id)
        .env("CASTGLEAN_CRASH_FIXTURE_ENDPOINT", &fixture.endpoint)
        .env("CASTGLEAN_CRASH_FIXTURE_CONTEXT_WINDOW", "4096")
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let status = tokio::time::timeout(Duration::from_secs(40), child.wait())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status.code(), Some(78));
    db.close().await.unwrap();

    let db = crate::database::open(&root.path().join("app.sqlite3"))
        .await
        .unwrap();
    let saved = ai_session::Entity::find_by_id(&session.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.context_summary.unwrap()["runId"], run.id);
    let saved = ai_run::Entity::find_by_id(&run.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert!(saved.agent_checkpoint.is_some());
    let owner = uuid::Uuid::new_v4().to_string();
    runs::interrupt_previous(&db, &owner).await.unwrap();
    let lease = runs::claim(&db, &run.id, &owner).await.unwrap().unwrap();
    continue_run(root.path(), &db, &lease, Some(4096)).await;
}
