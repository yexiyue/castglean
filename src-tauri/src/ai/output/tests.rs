use super::*;
use crate::ai::{
    self,
    test_support::{fixture, request},
};

#[tokio::test]
async fn latest_request_usage_is_persisted_versioned_and_not_accumulated() {
    let (root, db, session) = fixture().await;
    let run = ai::start_run(&db, request(&session)).await.unwrap();
    let lease = runs::claim(&db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    let output = Output::new(db.clone(), lease);
    output.start(100).await.unwrap();
    let mut usage = rig_core::completion::Usage::default();
    usage.input_tokens = Some(1000);
    usage.output_tokens = Some(100);
    usage.cached_input_tokens = Some(400);
    output.usage(&usage).await.unwrap();
    let page = ai::history_page(&db, &session.id, None, 20).await.unwrap();
    let message = page.messages.last().unwrap();
    assert_eq!(message.usage.as_ref().unwrap().input_tokens, Some(1000));
    let version = message.version;
    output.start(200).await.unwrap();
    let page = ai::history_page(&db, &session.id, None, 20).await.unwrap();
    assert!(page.messages.last().unwrap().usage.is_none());
    assert!(page.messages.last().unwrap().version > version);
    usage.input_tokens = Some(2000);
    usage.output_tokens = Some(50);
    output.usage(&usage).await.unwrap();
    output.complete().await.unwrap();
    let restored = crate::database::open(&root.path().join("app.sqlite3"))
        .await
        .unwrap();
    let page = ai::history_page(&restored, &session.id, None, 20)
        .await
        .unwrap();
    let saved = page.messages.last().unwrap().usage.as_ref().unwrap();
    assert_eq!(saved.input_tokens, Some(2000));
    assert_eq!(saved.output_tokens, Some(50));
    assert_eq!(saved.cached_input_tokens, Some(400));
}

#[tokio::test]
async fn absent_usage_does_not_turn_into_zero_or_reuse_previous_values() {
    let (_root, db, session) = fixture().await;
    let run = ai::start_run(&db, request(&session)).await.unwrap();
    let lease = runs::claim(&db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    let output = Output::new(db.clone(), lease);
    output.start(100).await.unwrap();
    let mut usage = rig_core::completion::Usage::default();
    usage.input_tokens = Some(0);
    output.usage(&usage).await.unwrap();
    let page = ai::history_page(&db, &session.id, None, 20).await.unwrap();
    assert_eq!(
        page.messages
            .last()
            .unwrap()
            .usage
            .as_ref()
            .unwrap()
            .input_tokens,
        Some(0)
    );
    output
        .usage(&rig_core::completion::Usage::default())
        .await
        .unwrap();
    let page = ai::history_page(&db, &session.id, None, 20).await.unwrap();
    assert!(page.messages.last().unwrap().usage.is_none());
}
