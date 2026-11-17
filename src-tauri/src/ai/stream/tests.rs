use super::*;
use crate::ai::{
    self,
    output::Output,
    runs,
    test_support::{fixture, request},
};
use sea_orm::TransactionTrait;

async fn received(subscription: &mut Subscription) -> Arc<AgentFrame> {
    tokio::time::timeout(std::time::Duration::from_secs(2), subscription.next())
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn snapshot_subscribe_race_restores_a_complete_native_boundary_without_starting_work() {
    let (_root, db, session) = fixture().await;
    let before = ai::history_page(&db, &session.id, None, 20).await.unwrap();
    let run = ai::start_run(&db, request(&session), None).await.unwrap();
    let hub = Hub::new(db.clone());
    let mut subscription = hub
        .subscribe(
            &session.id,
            &uuid::Uuid::new_v4().to_string(),
            before.session.sequence,
        )
        .await
        .unwrap();
    let frame = received(&mut subscription).await;
    let AgentFrame::Events {
        restore,
        events,
        page,
        ..
    } = frame.as_ref()
    else {
        panic!("expected native restore")
    };
    assert!(*restore);
    assert_eq!(events[0]["type"], "RUN_STARTED");
    assert_eq!(events[0]["runId"], run.id);
    assert_eq!(page.messages[0]["role"], "user");
    assert_eq!(page.run.as_ref().unwrap().budget.requests, 0);
    // Rejoining creates no new run and does not issue an LLM request.
    let id = uuid::Uuid::new_v4().to_string();
    let mut rejoined = hub.subscribe(&session.id, &id, 0).await.unwrap();
    assert!(matches!(
        received(&mut rejoined).await.as_ref(),
        AgentFrame::Events { restore: true, .. }
    ));
    assert_eq!(
        ai::history_page(&db, &session.id, None, 20)
            .await
            .unwrap()
            .run
            .unwrap()
            .id,
        run.id
    );
}

#[tokio::test]
async fn committed_unicode_content_and_tool_results_are_native_messages_not_sdk_chunks() {
    let (_root, db, session) = fixture().await;
    let run = ai::start_run(&db, request(&session), None).await.unwrap();
    let hub = Hub::new(db.clone());
    let lease = runs::claim(&db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap()
        .with_stream(hub.clone());
    let id = uuid::Uuid::new_v4().to_string();
    let mut subscription = hub.subscribe(&session.id, &id, 0).await.unwrap();
    let first = received(&mut subscription).await;
    hub.acknowledge(&session.id, &id, first.cursor())
        .await
        .unwrap();
    let output = Output::new(db.clone(), lease.clone());
    output.start(10).await.unwrap();
    let frame = received(&mut subscription).await;
    hub.acknowledge(&session.id, &id, frame.cursor())
        .await
        .unwrap();
    output.text("🙂中文").await.unwrap();
    let frame = received(&mut subscription).await;
    let AgentFrame::Events { events, page, .. } = frame.as_ref() else {
        panic!("expected events")
    };
    let snapshot = events
        .iter()
        .find(|event| event["type"] == "MESSAGES_SNAPSHOT")
        .unwrap();
    assert_eq!(
        snapshot["messages"].as_array().unwrap().last().unwrap()["content"],
        "🙂中文"
    );
    assert_eq!(
        page.records.last().unwrap().run_id.as_deref(),
        Some(run.id.as_str())
    );
    hub.acknowledge(&session.id, &id, frame.cursor())
        .await
        .unwrap();
    hub.publish(&session.id).await.unwrap();
    assert!(subscription.queue.try_recv().is_err());
    output.complete().await.unwrap();
    let frame = received(&mut subscription).await;
    hub.acknowledge(&session.id, &id, frame.cursor())
        .await
        .unwrap();
    runs::finish(&db, &lease, ai::RunStatus::Succeeded, None)
        .await
        .unwrap();
    let frame = received(&mut subscription).await;
    let AgentFrame::Events { events, .. } = frame.as_ref() else {
        panic!("expected terminal")
    };
    assert_eq!(events.last().unwrap()["type"], "RUN_FINISHED");
}

#[tokio::test]
async fn slow_reader_is_reset_without_blocking_fast_reader_or_commits() {
    let (_root, db, session) = fixture().await;
    let run = ai::start_run(&db, request(&session), None).await.unwrap();
    let hub = Hub::new(db.clone());
    let lease = runs::claim(&db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap()
        .with_stream(hub.clone());
    let fast_id = uuid::Uuid::new_v4().to_string();
    let mut fast = hub.subscribe(&session.id, &fast_id, 0).await.unwrap();
    let mut slow = hub
        .subscribe(&session.id, &uuid::Uuid::new_v4().to_string(), 0)
        .await
        .unwrap();
    let frame = received(&mut fast).await;
    hub.acknowledge(&session.id, &fast_id, frame.cursor())
        .await
        .unwrap();
    for _ in 0..12 {
        runs::commit(db.begin().await.unwrap(), &lease)
            .await
            .unwrap();
        let frame = received(&mut fast).await;
        assert!(matches!(frame.as_ref(), AgentFrame::Events { .. }));
        hub.acknowledge(&session.id, &fast_id, frame.cursor())
            .await
            .unwrap();
    }
    assert!(matches!(
        received(&mut slow).await.as_ref(),
        AgentFrame::Reset { .. }
    ));
    assert!(slow.next().await.is_none());
    hub.unsubscribe(&session.id, &fast_id).await;
    runs::finish(&db, &lease, ai::RunStatus::Succeeded, None)
        .await
        .unwrap();
    let mut rejoined = hub
        .subscribe(&session.id, &uuid::Uuid::new_v4().to_string(), 0)
        .await
        .unwrap();
    let frame = received(&mut rejoined).await;
    let AgentFrame::Events { events, .. } = frame.as_ref() else {
        panic!("expected restore")
    };
    assert_eq!(events.first().unwrap()["type"], "RUN_STARTED");
    assert_eq!(events.last().unwrap()["type"], "RUN_FINISHED");
}

#[tokio::test]
async fn professional_lifecycle_and_attribution_survive_an_unsubscribed_completion() {
    let (_root, db, session) = fixture().await;
    let run = ai::start_run(&db, request(&session), None).await.unwrap();
    let hub = Hub::new(db.clone());
    let parent = runs::claim(&db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap()
        .with_stream(hub.clone());
    let child = ai::invocations::begin(&db, &parent, "chapter_splitting")
        .await
        .unwrap();
    let output = Output::new(db.clone(), child.clone());
    output.start(10).await.unwrap();
    output.text("专业任务结果").await.unwrap();
    output.complete().await.unwrap();
    ai::invocations::finish(&db, &child, &Ok(())).await.unwrap();
    runs::finish(&db, &parent, ai::RunStatus::Succeeded, None)
        .await
        .unwrap();
    let mut subscription = hub
        .subscribe(&session.id, &uuid::Uuid::new_v4().to_string(), 0)
        .await
        .unwrap();
    let frame = received(&mut subscription).await;
    let AgentFrame::Events { events, page, .. } = frame.as_ref() else {
        panic!("expected restore")
    };
    assert_eq!(page.invocations.len(), 1);
    let message = page
        .messages
        .iter()
        .find(|message| message["content"] == "专业任务结果")
        .unwrap();
    assert_eq!(message["subagentRunId"], child.invocation().unwrap());
    assert!(
        events
            .iter()
            .any(|event| event["type"] == "SUBAGENT_STARTED")
    );
    assert!(
        events
            .iter()
            .any(|event| event["type"] == "SUBAGENT_FINISHED")
    );
    assert_eq!(events.last().unwrap()["type"], "RUN_FINISHED");
}
