use super::*;
use crate::ai::{
    self,
    runs::{self, Lease},
    test_support::{fixture, request},
};
use sea_orm::TransactionTrait;

async fn received(subscription: &mut Subscription) -> Arc<StreamEvent> {
    tokio::time::timeout(std::time::Duration::from_secs(2), subscription.next())
        .await
        .unwrap()
        .unwrap()
}
async fn advance(db: &DatabaseConnection, lease: &Lease) {
    let tx = db.begin().await.unwrap();
    runs::commit(tx, lease).await.unwrap();
}
async fn running(db: &DatabaseConnection, session: &SessionInfo, hub: &Arc<Hub>) -> Lease {
    let run = ai::start_run(db, request(session), None).await.unwrap();
    hub.publish(&session.id).await.unwrap();
    let lease = runs::claim(db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap()
        .with_stream(hub.clone());
    hub.publish(&session.id).await.unwrap();
    lease
}

#[tokio::test]
async fn history_to_subscribe_race_and_restart_require_authoritative_resync() {
    let (_root, db, session) = fixture().await;
    let before = ai::history_page(&db, &session.id, None, 10).await.unwrap();
    ai::start_run(&db, request(&session), None).await.unwrap();
    let hub = Hub::new(db.clone());
    let mut subscription = hub
        .subscribe(
            &session.id,
            &uuid::Uuid::new_v4().to_string(),
            before.session.sequence,
        )
        .await
        .unwrap();
    assert!(matches!(
        received(&mut subscription).await.as_ref(),
        StreamEvent::ResyncRequired { sequence: 1, .. }
    ));
    assert!(subscription.next().await.is_none());
    let current = ai::history_page(&db, &session.id, None, 10).await.unwrap();
    let mut restored = hub
        .subscribe(
            &session.id,
            &uuid::Uuid::new_v4().to_string(),
            current.session.sequence,
        )
        .await
        .unwrap();
    assert!(restored.queue.try_recv().is_err());
    assert_eq!(current.messages.len(), 1);
    assert_eq!(current.session.budget.requests, 0);
}

#[tokio::test]
async fn committed_frames_replay_in_order_without_starting_or_duplicating_messages() {
    let (_root, db, session) = fixture().await;
    let hub = Hub::new(db.clone());
    let id = uuid::Uuid::new_v4().to_string();
    let mut first = hub.subscribe(&session.id, &id, 0).await.unwrap();
    let lease = running(&db, &session, &hub).await;
    assert_eq!(received(&mut first).await.sequence(), 1);
    assert_eq!(received(&mut first).await.sequence(), 2);
    hub.unsubscribe(&session.id, &id).await;
    advance(&db, &lease).await;
    advance(&db, &lease).await;
    let id = uuid::Uuid::new_v4().to_string();
    let mut replay = hub.subscribe(&session.id, &id, 2).await.unwrap();
    for sequence in [3, 4] {
        assert_eq!(received(&mut replay).await.sequence(), sequence);
        hub.acknowledge(&session.id, &id, sequence).await.unwrap();
    }
    hub.publish(&session.id).await.unwrap();
    assert!(replay.queue.try_recv().is_err());
    assert!(matches!(
        hub.acknowledge(&session.id, &id, 5).await,
        Err(AiError::InvalidRequest)
    ));
    let history = ai::history_page(&db, &session.id, None, 10).await.unwrap();
    assert_eq!(history.messages.len(), 1);
    assert_eq!(history.session.budget.requests, 0);
}

#[tokio::test]
async fn unicode_text_deltas_use_utf16_offsets_and_duplicate_publications_are_inert() {
    let (_root, db, session) = fixture().await;
    let hub = Hub::new(db.clone());
    let id = uuid::Uuid::new_v4().to_string();
    let mut subscription = hub.subscribe(&session.id, &id, 0).await.unwrap();
    let lease = running(&db, &session, &hub).await;
    for sequence in [1, 2] {
        assert_eq!(received(&mut subscription).await.sequence(), sequence);
        hub.acknowledge(&session.id, &id, sequence).await.unwrap();
    }
    let output = ai::output::Output::new(db.clone(), lease);
    output.start(5).await.unwrap();
    let _ = received(&mut subscription).await;
    hub.acknowledge(&session.id, &id, 3).await.unwrap();
    output.text("🙂").await.unwrap();
    let _ = received(&mut subscription).await;
    hub.acknowledge(&session.id, &id, 4).await.unwrap();
    output.text("中文").await.unwrap();
    let event = received(&mut subscription).await;
    assert!(
        matches!(event.as_ref(),StreamEvent::Update {sequence:5,changes,..} if matches!(&changes[0],StreamChange::TextDelta {offset_utf16:2,text,from_version:2,version:3,..} if text=="中文"))
    );
    hub.publish(&session.id).await.unwrap();
    assert!(subscription.queue.try_recv().is_err());
}

#[tokio::test]
async fn missed_post_commit_notifications_publish_resync_instead_of_inventing_frames() {
    let (_root, db, session) = fixture().await;
    let hub = Hub::new(db.clone());
    let mut subscription = hub
        .subscribe(&session.id, &uuid::Uuid::new_v4().to_string(), 0)
        .await
        .unwrap();
    let run = ai::start_run(&db, request(&session), None).await.unwrap();
    let lease = runs::claim(&db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    advance(&db, &lease).await;
    hub.publish(&session.id).await.unwrap();
    assert!(matches!(
        received(&mut subscription).await.as_ref(),
        StreamEvent::ResyncRequired { sequence: 3, .. }
    ));
    assert_eq!(
        ai::history_page(&db, &session.id, None, 10)
            .await
            .unwrap()
            .session
            .sequence,
        3
    );
}

#[tokio::test]
async fn slow_consumer_is_bounded_and_cannot_block_another_subscriber_or_run_completion() {
    let (_root, db, session) = fixture().await;
    let hub = Hub::new(db.clone());
    let mut slow = hub
        .subscribe(&session.id, &uuid::Uuid::new_v4().to_string(), 0)
        .await
        .unwrap();
    let fast_id = uuid::Uuid::new_v4().to_string();
    let mut fast = hub.subscribe(&session.id, &fast_id, 0).await.unwrap();
    let lease = running(&db, &session, &hub).await;
    for sequence in [1, 2] {
        assert_eq!(received(&mut fast).await.sequence(), sequence);
        hub.acknowledge(&session.id, &fast_id, sequence)
            .await
            .unwrap();
    }
    for sequence in 3..=10 {
        advance(&db, &lease).await;
        assert_eq!(received(&mut fast).await.sequence(), sequence);
        hub.acknowledge(&session.id, &fast_id, sequence)
            .await
            .unwrap();
    }
    assert!(matches!(
        received(&mut slow).await.as_ref(),
        StreamEvent::ResyncRequired { .. }
    ));
    runs::finish(&db, &lease, ai::RunStatus::Succeeded, None)
        .await
        .unwrap();
    assert!(
        matches!(received(&mut fast).await.as_ref(),StreamEvent::Update {run:Some(run),..} if run.status==ai::RunStatus::Succeeded)
    );
    assert!(
        hub.state.lock().await.sessions[&session.id]
            .subscribers
            .len()
            == 1
    );
}

#[tokio::test]
async fn replay_buffer_gaps_are_explicit_and_unsubscribe_does_not_cancel_work() {
    let (_root, db, session) = fixture().await;
    let hub = Hub::new(db.clone());
    let id = uuid::Uuid::new_v4().to_string();
    let _subscription = hub.subscribe(&session.id, &id, 0).await.unwrap();
    hub.unsubscribe(&session.id, &id).await;
    let lease = running(&db, &session, &hub).await;
    for _ in 0..70 {
        advance(&db, &lease).await;
    }
    let mut late = hub
        .subscribe(&session.id, &uuid::Uuid::new_v4().to_string(), 0)
        .await
        .unwrap();
    assert!(matches!(
        received(&mut late).await.as_ref(),
        StreamEvent::ResyncRequired { sequence: 72, .. }
    ));
    let state = hub.state.lock().await;
    let buffer = &state.sessions[&session.id];
    assert!(buffer.frames.len() <= FRAMES && buffer.bytes <= BYTES);
    drop(state);
    assert_eq!(
        ai::history_page(&db, &session.id, None, 10)
            .await
            .unwrap()
            .run
            .unwrap()
            .status,
        ai::RunStatus::Running
    );
}

#[tokio::test]
async fn project_assistant_lists_only_its_own_sessions() {
    let (_root, db, splitting) = fixture().await;
    let assistant = ai::create_session(
        &db,
        ai::CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: splitting.project_id.clone(),
            task_kind: "project_assistant".into(),
            chapter_id: None,
            title: "工程助手".into(),
        },
    )
    .await
    .unwrap();
    let page = history::sessions(&db, &splitting.project_id, "project_assistant", None, None)
        .await
        .unwrap();
    assert_eq!(page.sessions.len(), 1);
    assert_eq!(page.sessions[0].id, assistant.id);
    let splitting_page =
        history::sessions(&db, &splitting.project_id, "chapter_splitting", None, None)
            .await
            .unwrap();
    assert_eq!(splitting_page.sessions[0].id, splitting.id);
}

#[tokio::test]
async fn session_listing_is_paged_and_task_scoped() {
    let (_root, db, session) = fixture().await;
    for _ in 0..35 {
        ai::create_session(
            &db,
            ai::CreateSession {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: session.project_id.clone(),
                task_kind: session.task_kind.clone(),
                chapter_id: None,
                title: "分章".into(),
            },
        )
        .await
        .unwrap();
    }
    ai::create_session(
        &db,
        ai::CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: session.project_id.clone(),
            task_kind: "analysis".into(),
            chapter_id: None,
            title: "其他任务".into(),
        },
    )
    .await
    .unwrap();
    let first = history::sessions(&db, &session.project_id, &session.task_kind, None, None)
        .await
        .unwrap();
    assert_eq!(first.sessions.len(), 32);
    let second = history::sessions(
        &db,
        &session.project_id,
        &session.task_kind,
        None,
        first.before,
    )
    .await
    .unwrap();
    assert_eq!(second.sessions.len(), 4);
    assert!(second.before.is_none());
    let ids: std::collections::HashSet<_> = first
        .sessions
        .iter()
        .chain(&second.sessions)
        .map(|s| &s.id)
        .collect();
    assert_eq!(ids.len(), 36);
    assert_eq!(
        history::sessions(&db, &session.project_id, "analysis", None, None)
            .await
            .unwrap()
            .sessions
            .len(),
        1
    );
    assert!(
        history::sessions(&db, "other", &session.task_kind, None, None)
            .await
            .unwrap()
            .sessions
            .is_empty()
    );
}

#[tokio::test]
async fn failed_channel_delivery_does_not_change_committed_work_or_prevent_later_recovery() {
    let (_root, db, session) = fixture().await;
    let hub = Hub::new(db.clone());
    let subscription = hub
        .subscribe(&session.id, &uuid::Uuid::new_v4().to_string(), 0)
        .await
        .unwrap();
    drop(subscription);
    let lease = running(&db, &session, &hub).await;
    let output = ai::output::Output::new(db.clone(), lease.clone());
    output.start(5).await.unwrap();
    output.text("已持久化").await.unwrap();
    output.complete().await.unwrap();
    runs::finish(&db, &lease, ai::RunStatus::Succeeded, None)
        .await
        .unwrap();
    let page = ai::history_page(&db, &session.id, None, 10).await.unwrap();
    assert_eq!(page.run.unwrap().status, ai::RunStatus::Succeeded);
    assert_eq!(page.messages.len(), 2);
    assert_eq!(page.messages[1].status, "complete");
    assert!(
        hub.state.lock().await.sessions[&session.id]
            .subscribers
            .is_empty()
    );
    let mut recovery = hub
        .subscribe(
            &session.id,
            &uuid::Uuid::new_v4().to_string(),
            page.session.sequence,
        )
        .await
        .unwrap();
    assert!(recovery.queue.try_recv().is_err());
    assert_eq!(page.session.budget.requests, 1);
}
