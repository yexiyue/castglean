use super::super::test_support::{fixture, request, sql};
use super::*;
use serde_json::json;

async fn running(db: &DatabaseConnection, session: &SessionInfo) -> Lease {
    let run = super::super::service::start(db, request(session))
        .await
        .unwrap();
    claim(db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap()
}
fn text(value: &str) -> messages::MessageParts {
    messages::MessageParts::new(vec![messages::MessagePart::Text { text: value.into() }]).unwrap()
}
async fn account(db: &DatabaseConnection, lease: &Lease, value: Charge) -> Result<Budget, AiError> {
    let tx = db.begin().await?;
    let total = charge(&tx, lease, value).await?;
    commit(tx, lease).await?;
    Ok(total)
}

#[tokio::test]
async fn repeated_delivery_has_one_owner_and_terminal_runs_cannot_be_claimed() {
    let (_root, db, session) = fixture().await;
    let run = super::super::service::start(&db, request(&session))
        .await
        .unwrap();
    let a = uuid::Uuid::new_v4().to_string();
    let b = uuid::Uuid::new_v4().to_string();
    let (one, two) = tokio::join!(claim(&db, &run.id, &a), claim(&db, &run.id, &b));
    let one = one.unwrap();
    let two = two.unwrap();
    assert_eq!(usize::from(one.is_some()) + usize::from(two.is_some()), 1);
    let lease = one.or(two).unwrap();
    finish(&db, &lease, RunStatus::Succeeded, None)
        .await
        .unwrap();
    assert!(claim(&db, &run.id, &a).await.unwrap().is_none());
    assert!(matches!(
        finish(&db, &lease, RunStatus::Failed, None).await,
        Err(AiError::Conflict)
    ));
}

#[tokio::test]
async fn generation_and_owner_fence_every_execution_write() {
    let (_root, db, session) = fixture().await;
    let lease = running(&db, &session).await;
    ai_run::Entity::update_many()
        .col_expr(
            ai_run::Column::Generation,
            Expr::value(lease.generation + 1),
        )
        .filter(ai_run::Column::Id.eq(lease.run_id()))
        .exec(&db)
        .await
        .unwrap();
    let tx = db.begin().await.unwrap();
    assert!(matches!(
        message(
            &tx,
            &lease,
            "message",
            None,
            text("late"),
            MessageState::Complete
        )
        .await,
        Err(AiError::Conflict)
    ));
    assert!(matches!(
        charge(&tx, &lease, Charge::Request { input_bytes: 1 }).await,
        Err(AiError::Conflict)
    ));
    assert!(matches!(
        checkpoint(&tx, &lease, json!({"step":"late"})).await,
        Err(AiError::Conflict)
    ));
    tx.rollback().await.unwrap();
    assert!(matches!(
        finish(&db, &lease, RunStatus::Succeeded, None).await,
        Err(AiError::Conflict)
    ));
    ai_run::Entity::update_many()
        .col_expr(ai_run::Column::Generation, Expr::value(lease.generation))
        .col_expr(
            ai_run::Column::OwnerInstance,
            Expr::value(uuid::Uuid::new_v4().to_string()),
        )
        .filter(ai_run::Column::Id.eq(lease.run_id()))
        .exec(&db)
        .await
        .unwrap();
    assert!(matches!(
        account(&db, &lease, Charge::ToolAttempt).await,
        Err(AiError::Conflict)
    ));
}

#[tokio::test]
async fn queued_cancel_prevents_model_claim_and_running_cancel_rejects_late_results() {
    let (_root, db, session) = fixture().await;
    let run = super::super::service::start(&db, request(&session))
        .await
        .unwrap();
    assert_eq!(
        cancel(&db, &run.id).await.unwrap().status,
        RunStatus::Cancelled
    );
    assert!(
        claim(&db, &run.id, &uuid::Uuid::new_v4().to_string())
            .await
            .unwrap()
            .is_none()
    );
    let lease = running(&db, &session).await;
    assert_eq!(
        cancel(&db, lease.run_id()).await.unwrap().status,
        RunStatus::Cancelling
    );
    let tx = db.begin().await.unwrap();
    assert!(matches!(
        message(
            &tx,
            &lease,
            "late",
            None,
            text("late success"),
            MessageState::Complete
        )
        .await,
        Err(AiError::Conflict)
    ));
    tx.rollback().await.unwrap();
    let stopped = finish(&db, &lease, RunStatus::Succeeded, None)
        .await
        .unwrap();
    assert_eq!(stopped.status, RunStatus::Cancelled);
    assert_eq!(
        cancel(&db, lease.run_id()).await.unwrap().status,
        RunStatus::Cancelled
    );
}

#[tokio::test]
async fn messages_have_monotonic_versions_and_completed_facts_cannot_be_overwritten() {
    let (_root, db, session) = fixture().await;
    let lease = running(&db, &session).await;
    let tx = db.begin().await.unwrap();
    message(
        &tx,
        &lease,
        "assistant",
        None,
        text("partial"),
        MessageState::Streaming,
    )
    .await
    .unwrap();
    commit(tx, &lease).await.unwrap();
    let tx = db.begin().await.unwrap();
    assert!(matches!(
        message(
            &tx,
            &lease,
            "assistant",
            Some(9),
            text("stale"),
            MessageState::Complete
        )
        .await,
        Err(AiError::Conflict)
    ));
    tx.rollback().await.unwrap();
    let tx = db.begin().await.unwrap();
    message(
        &tx,
        &lease,
        "assistant",
        Some(1),
        text("done"),
        MessageState::Complete,
    )
    .await
    .unwrap();
    commit(tx, &lease).await.unwrap();
    let tx = db.begin().await.unwrap();
    assert!(matches!(
        message(
            &tx,
            &lease,
            "assistant",
            Some(2),
            text("overwrite"),
            MessageState::Complete
        )
        .await,
        Err(AiError::Conflict)
    ));
    tx.rollback().await.unwrap();
    let page = super::super::history::page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    assert_eq!(page.messages.len(), 2);
    assert_eq!(page.messages[1].version, 2);
    assert_eq!(page.messages[1].parts, text("done"));
}

#[tokio::test]
async fn budget_counters_commit_without_an_audit_copy_and_survive_retry() {
    let (_root, db, session) = fixture().await;
    let lease = running(&db, &session).await;
    account(&db, &lease, Charge::Request { input_bytes: 100 })
        .await
        .unwrap();
    account(&db, &lease, Charge::Wire { input_bytes: 140 })
        .await
        .unwrap();
    assert_eq!(
        account(&db, &lease, Charge::Wire { input_bytes: 140 })
            .await
            .unwrap()
            .input_bytes,
        140
    );
    account(&db, &lease, Charge::ToolAttempt).await.unwrap();
    let total = account(&db, &lease, Charge::ToolOutput { bytes: 50 })
        .await
        .unwrap();
    assert_eq!(
        total,
        Budget {
            requests: 1,
            input_bytes: 140,
            tool_calls: 1,
            tool_bytes: 50
        }
    );
    assert!(matches!(
        account(&db, &lease, Charge::ToolOutput { bytes: 9000 }).await,
        Err(AiError::BudgetExhausted)
    ));
    let saved = finish(&db, &lease, RunStatus::Failed, Some(RunFailure::ToolFailed))
        .await
        .unwrap();
    assert_eq!(saved.budget, total);
    let mut req = request(&session);
    req.trigger = Trigger::Retry {
        run_id: lease.run_id().into(),
    };
    let retried = super::super::service::start(&db, req).await.unwrap();
    assert_eq!(retried.budget, total);
    let lease = claim(&db, &retried.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        account(&db, &lease, Charge::Request { input_bytes: 10 })
            .await
            .unwrap()
            .requests,
        2
    );
}

#[tokio::test]
async fn failed_business_transaction_rolls_back_messages_and_counters_together() {
    let (_root, db, session) = fixture().await;
    let lease = running(&db, &session).await;
    let tx = db.begin().await.unwrap();
    charge(&tx, &lease, Charge::ToolAttempt).await.unwrap();
    message(
        &tx,
        &lease,
        "proposal-result",
        None,
        text("candidate exists"),
        MessageState::Complete,
    )
    .await
    .unwrap();
    tx.rollback().await.unwrap();
    let page = super::super::history::page(&db, &session.id, None, 10)
        .await
        .unwrap();
    assert_eq!(page.messages.len(), 1);
    assert_eq!(page.session.budget.tool_calls, 0);
    assert_eq!(page.run.unwrap().budget.tool_calls, 0);
}

#[tokio::test]
async fn restart_interrupts_inflight_messages_but_never_restarts_the_model() {
    let (_root, db, session) = fixture().await;
    let lease = running(&db, &session).await;
    let parts = messages::MessageParts::new(vec![
        messages::MessagePart::Text {
            text: "partial".into(),
        },
        messages::MessagePart::Tool {
            id: "call".into(),
            name: "scan".into(),
            input: json!({}),
            state: messages::ToolState::Running,
            output: None,
            result: None,
        },
    ])
    .unwrap();
    let tx = db.begin().await.unwrap();
    message(
        &tx,
        &lease,
        "assistant",
        None,
        parts,
        MessageState::Streaming,
    )
    .await
    .unwrap();
    charge(&tx, &lease, Charge::Request { input_bytes: 10 })
        .await
        .unwrap();
    commit(tx, &lease).await.unwrap();
    interrupt_previous(&db, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap();
    let page = super::super::history::page(&db, &session.id, None, 10)
        .await
        .unwrap();
    assert_eq!(page.run.unwrap().status, RunStatus::Interrupted);
    assert_eq!(page.session.budget.requests, 1);
    assert_eq!(page.messages[1].status, "interrupted");
    assert!(matches!(
        &page.messages[1].parts.parts()[1],
        messages::MessagePart::Tool {
            state: messages::ToolState::Interrupted,
            output: None,
            ..
        }
    ));
    assert!(
        claim(&db, lease.run_id(), &uuid::Uuid::new_v4().to_string())
            .await
            .unwrap()
            .is_none()
    );
    assert!(matches!(
        finish(&db, &lease, RunStatus::Succeeded, None).await,
        Err(AiError::Conflict)
    ));
}

#[tokio::test]
async fn old_process_recovery_keeps_queued_intent_and_current_owner_untouched() {
    let (_root, db, session) = fixture().await;
    let queued = super::super::service::start(&db, request(&session))
        .await
        .unwrap();
    interrupt_previous(&db, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let lease = claim(&db, &queued.id, &owner).await.unwrap().unwrap();
    interrupt_previous(&db, &owner).await.unwrap();
    assert!(account(&db, &lease, Charge::ToolAttempt).await.is_ok());
}

#[tokio::test]
async fn exhausted_turn_and_wire_limits_never_reset_the_session_budget() {
    let (_root, db, session) = fixture().await;
    let lease = running(&db, &session).await;
    for _ in 0..8 {
        account(&db, &lease, Charge::Request { input_bytes: 1 })
            .await
            .unwrap();
    }
    assert!(matches!(
        account(&db, &lease, Charge::Request { input_bytes: 1 }).await,
        Err(AiError::BudgetExhausted)
    ));
    assert!(matches!(
        account(
            &db,
            &lease,
            Charge::Wire {
                input_bytes: 128 * 1024 + 1
            }
        )
        .await,
        Err(AiError::BudgetExhausted)
    ));
    assert_eq!(
        finish(
            &db,
            &lease,
            RunStatus::Failed,
            Some(RunFailure::BudgetExhausted)
        )
        .await
        .unwrap()
        .budget
        .requests,
        8
    );
}

#[tokio::test]
async fn persistence_failure_does_not_publish_a_new_cursor_or_message() {
    let (_root, db, session) = fixture().await;
    let lease = running(&db, &session).await;
    let before = super::super::history::page(&db, &session.id, None, 10)
        .await
        .unwrap()
        .session
        .sequence;
    sql(&db, "CREATE TRIGGER reject_assistant BEFORE INSERT ON ai_messages BEGIN SELECT RAISE(ABORT, 'injected failure'); END").await;
    let tx = db.begin().await.unwrap();
    assert!(matches!(
        message(
            &tx,
            &lease,
            "assistant",
            None,
            text("not committed"),
            MessageState::Complete
        )
        .await,
        Err(AiError::StorageFailed)
    ));
    tx.rollback().await.unwrap();
    let page = super::super::history::page(&db, &session.id, None, 10)
        .await
        .unwrap();
    assert_eq!(page.session.sequence, before);
    assert_eq!(page.messages.len(), 1);
}

#[tokio::test]
async fn unknown_ledger_version_is_rejected_without_changing_saved_data() {
    let (_root, db, session) = fixture().await;
    let lease = running(&db, &session).await;
    let row = ai_run::Entity::find_by_id(lease.run_id())
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let mut ledger = row.budget;
    ledger["version"] = json!(999);
    ai_run::Entity::update_many()
        .col_expr(ai_run::Column::Budget, Expr::value(ledger.clone()))
        .filter(ai_run::Column::Id.eq(lease.run_id()))
        .exec(&db)
        .await
        .unwrap();
    assert!(matches!(
        account(&db, &lease, Charge::Request { input_bytes: 10 }).await,
        Err(AiError::StorageFailed)
    ));
    assert_eq!(
        ai_run::Entity::find_by_id(lease.run_id())
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .budget,
        ledger
    );
}
