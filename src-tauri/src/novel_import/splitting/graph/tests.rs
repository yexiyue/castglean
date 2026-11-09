use super::super::{
    ProposalAction, propose,
    test_support::{fixture_saved, tool_context},
};
use super::*;
use crate::ai::messages::{MessagePart, ToolState};
use sea_orm::{ConnectionTrait, DbBackend, PaginatorTrait, Statement};
use serde_json::json;

fn unavailable_model() -> DynModel<Completion> {
    rig_core::providers::openai::OpenAIConfig::new("unused")
        .with_base_url("http://127.0.0.1:1/v1")
        .connect(crate::llm::TestHttp::new("http://127.0.0.1:1").unwrap())
        .chat("unused")
        .erase()
}

#[tokio::test]
async fn checkpoints_enforce_graph_identity_and_optimistic_version() {
    let (_root, db, _, lease) = fixture_saved().await;
    let storage = Storage {
        db: db.clone(),
        lease: lease.clone(),
    };
    let initial = Session::new_from_task(lease.session_id().into(), "prepare").with_graph_id(GRAPH);
    storage.save(initial.clone()).await.unwrap();
    assert!(storage.save(initial).await.is_err());
    assert!(storage.get("foreign").await.is_err());
    let mut next = storage.get(lease.session_id()).await.unwrap().unwrap();
    assert_eq!(next.version, 1);
    next.current_task_id = "validate".into();
    storage.save(next).await.unwrap();
    assert_eq!(
        storage
            .get(lease.session_id())
            .await
            .unwrap()
            .unwrap()
            .version,
        2
    );
    assert!(storage.delete(lease.session_id()).await.is_err());
}

#[tokio::test]
async fn resumed_validate_reaches_review_without_repeating_a_model_step() {
    let (root, db, _, lease) = fixture_saved().await;
    let storage = Storage {
        db: db.clone(),
        lease: lease.clone(),
    };
    storage
        .save(Session::new_from_task(lease.session_id().into(), "validate").with_graph_id(GRAPH))
        .await
        .unwrap();
    execute(
        tool_context(root.path(), &db, &lease),
        unavailable_model(),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        storage
            .get(lease.session_id())
            .await
            .unwrap()
            .unwrap()
            .current_task_id,
        "review"
    );
    assert_eq!(
        ai::history_page(&db, lease.session_id(), None, 10)
            .await
            .unwrap()
            .session
            .budget
            .requests,
        0
    );
}

#[tokio::test]
async fn unknown_checkpoint_version_stops_before_a_model_request() {
    let (root, db, _, lease) = fixture_saved().await;
    let tx = db.begin().await.unwrap();
    ai::runs::checkpoint(&tx, &lease, json!({"version":99}))
        .await
        .unwrap();
    ai::runs::commit(tx, &lease).await.unwrap();
    assert_eq!(
        execute(
            tool_context(root.path(), &db, &lease),
            unavailable_model(),
            None
        )
        .await,
        Err(RunFailure::InvalidResponse)
    );
    assert_eq!(
        ai::history_page(&db, lease.session_id(), None, 10)
            .await
            .unwrap()
            .session
            .budget
            .requests,
        0
    );
}

#[tokio::test]
async fn checkpoint_failure_rolls_back_candidate_and_success_fact_together() {
    let (_root, db, state, lease) = fixture_saved().await;
    let storage = Storage {
        db: db.clone(),
        lease: lease.clone(),
    };
    storage
        .save(Session::new_from_task(lease.session_id().into(), "diagnose").with_graph_id(GRAPH))
        .await
        .unwrap();
    let proposed = propose(
        &state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &tokio_util::sync::CancellationToken::new(),
    )
    .unwrap();
    let tx = db.begin().await.unwrap();
    ai::tools::begin(
        &tx,
        &lease,
        "assistant",
        "call",
        "finish_splitting",
        json!({"plan":{"kind":"rules","rules":crate::novel_import::heading_rules()}}),
    )
    .await
    .unwrap();
    ai::runs::commit(tx, &lease).await.unwrap();
    db.execute_raw(Statement::from_string(DbBackend::Sqlite,"CREATE TRIGGER reject_graph BEFORE UPDATE OF checkpoint ON ai_runs BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END")).await.unwrap();
    assert!(
        super::super::store::publish(&db, &lease, "assistant", "call", proposed)
            .await
            .is_err()
    );
    assert_eq!(
        crate::database::entity::split_proposal::Entity::find()
            .count(&db)
            .await
            .unwrap(),
        0
    );
    let page = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    assert!(matches!(
        &page.messages[1].parts.parts()[0],
        MessagePart::Tool {
            state: ToolState::Running,
            result: None,
            ..
        }
    ));
    assert_eq!(page.session.budget.tool_bytes, 0);
    let row = ai_run::Entity::find_by_id(lease.run_id())
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        decode(row.checkpoint.unwrap(), lease.session_id())
            .unwrap()
            .last_tool
            .is_none()
    );
}
