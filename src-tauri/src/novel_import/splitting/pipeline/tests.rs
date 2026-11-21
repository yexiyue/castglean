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
async fn checkpoints_enforce_optimistic_version() {
    let (_root, db, _, lease) = fixture_saved().await;
    assert_eq!(advance(&db, &lease, 0, Phase::Prepare).await.unwrap(), 1);
    assert_eq!(
        advance(&db, &lease, 0, Phase::Prepare).await,
        Err(AiError::Conflict)
    );
    assert_eq!(advance(&db, &lease, 1, Phase::Diagnose).await.unwrap(), 2);
}

#[tokio::test]
async fn resumed_committed_diagnosis_reaches_review_without_a_model_step() {
    let (root, db, _, lease) = fixture_saved().await;
    advance(&db, &lease, 0, Phase::Diagnose).await.unwrap();
    let tx = db.begin().await.unwrap();
    tool_committed(&tx, &lease, "message", "completed-call")
        .await
        .unwrap();
    ai::runs::commit(tx, &lease).await.unwrap();
    execute(
        tool_context(root.path(), &db, &lease),
        unavailable_model(),
        None,
        None,
    )
    .await
    .unwrap();
    let row = ai_run::Entity::find_by_id(lease.run_id())
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let checkpoint = decode(row.checkpoint.unwrap()).unwrap();
    assert_eq!(checkpoint.phase, Phase::Review);
    assert_eq!(checkpoint.last_tool.unwrap().call_id, "completed-call");
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
async fn new_turn_after_review_reaches_diagnose_again() {
    let (root, db, _, lease) = fixture_saved().await;
    advance(&db, &lease, 0, Phase::Review).await.unwrap();
    assert!(
        execute(
            tool_context(root.path(), &db, &lease),
            unavailable_model(),
            None,
            None
        )
        .await
        .is_err()
    );
    let row = ai_run::Entity::find_by_id(lease.run_id())
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let checkpoint = decode(row.checkpoint.unwrap()).unwrap();
    assert_eq!(checkpoint.phase, Phase::Diagnose);
    assert_eq!(checkpoint.version, 3);
}

#[tokio::test]
async fn old_graph_checkpoint_stops_before_a_model_request() {
    let (root, db, _, lease) = fixture_saved().await;
    let tx = db.begin().await.unwrap();
    ai::runs::checkpoint(&tx, &lease, json!({"version":1,"session":{"id":lease.session_id(),"graph_id":"chapter-splitting-v1","current_task_id":"validate","version":2},"last_tool":null}))
        .await
        .unwrap();
    ai::runs::commit(tx, &lease).await.unwrap();
    assert_eq!(
        execute(
            tool_context(root.path(), &db, &lease),
            unavailable_model(),
            None,
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
    advance(&db, &lease, 0, Phase::Diagnose).await.unwrap();
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
    db.execute_raw(Statement::from_string(DbBackend::Sqlite,"CREATE TRIGGER reject_checkpoint BEFORE UPDATE OF checkpoint ON ai_runs BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END")).await.unwrap();
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
    assert!(decode(row.checkpoint.unwrap()).unwrap().last_tool.is_none());
}
