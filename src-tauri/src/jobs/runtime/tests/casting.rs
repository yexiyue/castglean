//! Native assistant SSE, isolated casting completion, publication and immutable retry.
use super::*;
use crate::{
    ai::messages::{MessagePart, ToolState},
    database::entity::{casting_input, casting_suggestion},
    voice_binding::CatalogSnapshot,
};
use serde_json::{Value, json};

const REQUIREMENTS: &str = "只为旁白配音，保留原音色。frozen-casting-requirements";

fn delegate_response() -> Vec<u8> {
    let chunk = json!({"id":"parent","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"casting-call","type":"function","function":{"name":"cast_voices","arguments":json!({"requirements":REQUIREMENTS}).to_string()}}]},"finish_reason":null}]});
    let end = json!({"id":"parent","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]});
    format!("data: {chunk}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes()
}

fn finish_response() -> Vec<u8> {
    serde_json::to_vec(&json!({
        "id":"child", "object":"chat.completion", "model":"test",
        "choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{
            "id":"casting-call","type":"function","function":{"name":"finish_casting","arguments":json!({
                "targets":[{"target":"narrator","profile":"清晰自然的旁白",
                    "voiceCandidates":[{"voice":{"kind":"library","id":"voice-a"},"reason":"原目录中明确描述的旁白音色"}]}]
            }).to_string()}
        }]},"finish_reason":"tool_calls"}]
    })).unwrap()
}

async fn casting_runtime(fail_child: bool) {
    let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
    let observed = requests.clone();
    // Keep assertions outside the fixture thread so a failed protocol expectation
    // reports normally instead of panicking again in Fixture::drop.
    let server = Fixture::raw(move |index, _, body| {
        observed.lock().unwrap().push(body.clone());
        if index == 0 {
            (200, "text/event-stream", delegate_response())
        } else if fail_child && index == 1 {
            (
                401,
                "application/json",
                serde_json::to_vec(&json!({"error":{"message":"synthetic child failure"}}))
                    .unwrap(),
            )
        } else {
            // Casting uses a non-streaming independent agent after the SSE parent.
            (200, "application/json", finish_response())
        }
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
            title: "选角运行时回归".into(),
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
            message: format!("请为旁白选角。{REQUIREMENTS}"),
        },
    };
    let original = ai::start_run(&db, request.clone(), None).await.unwrap();
    let catalog: CatalogSnapshot = serde_json::from_value(json!({
        "library":[{"id":"voice-a","name":"原音色","description":"清晰自然的旁白音色"}], "presets":[]
    })).unwrap();
    let current_catalog = Arc::new(Mutex::new(catalog));
    let catalog_reads = Arc::new(AtomicUsize::new(0));
    let live = current_catalog.clone();
    let reads = catalog_reads.clone();
    let provider: ai::tasks::CatalogProvider = Arc::new(move || {
        reads.fetch_add(1, Ordering::SeqCst);
        Ok(live.lock().unwrap().clone())
    });
    let runtime = Runtime::new(
        super::super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        Some(provider),
    );
    super::super::super::setup(&db).await.unwrap();
    let mut queue = SqliteStorage::new(db.get_sqlite_connection_pool());
    runtime.dispatch(&mut queue).await.unwrap();
    let task = worker(runtime.clone(), queue.clone());
    let first = wait_terminal(&db, &original.id).await;
    wait_idle(&runtime).await;
    let frozen = casting_input::Entity::find_by_id(&original.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .content;
    assert_eq!(frozen["instructions"], REQUIREMENTS);
    let terminal = if fail_child {
        assert_eq!(first.status, "failed", "{:?}", first.error);
        assert_eq!(first.error.as_deref(), Some("configuration_unavailable"));
        assert_eq!(
            casting_suggestion::Entity::find().count(&db).await.unwrap(),
            0
        );
        assert_eq!(requests.lock().unwrap().len(), 2);
        // Retry must neither route through the parent again nor use a new catalog.
        current_catalog.lock().unwrap().library.clear();
        let changed_catalog = current_catalog.lock().unwrap().clone();
        let retry = ai::start_run(
            &db,
            StartRun {
                request_id: uuid::Uuid::new_v4().to_string(),
                trigger: Trigger::Retry {
                    run_id: original.id.clone(),
                },
                ..request
            },
            Some(changed_catalog),
        )
        .await
        .unwrap();
        assert_eq!(
            casting_input::Entity::find_by_id(&retry.id)
                .one(&db)
                .await
                .unwrap()
                .unwrap()
                .content,
            frozen
        );
        runtime.dispatch(&mut queue).await.unwrap();
        let terminal = wait_terminal(&db, &retry.id).await;
        wait_idle(&runtime).await;
        assert_eq!(terminal.retry_of.as_deref(), Some(original.id.as_str()));
        assert_eq!(terminal.trigger_message_id, first.trigger_message_id);
        let saved = ai_run::Entity::find_by_id(&original.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.status, first.status);
        assert_eq!(saved.budget, first.budget);
        terminal
    } else {
        first
    };
    // Stop the background worker before asserting the publication details.
    task.abort();
    let _ = task.await;
    assert_eq!(terminal.status, "waiting_for_input", "{:?}", terminal.error);
    assert_eq!(catalog_reads.load(Ordering::SeqCst), 1);
    assert_eq!(
        casting_suggestion::Entity::find().count(&db).await.unwrap(),
        1
    );
    let suggestion = casting_suggestion::Entity::find_by_id(&terminal.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        suggestion.content["targets"][0]["voiceCandidates"][0]["voice"]["id"],
        "voice-a"
    );
    for id in [&original.id, &terminal.id] {
        runtime.handle(RunJob { run_id: id.clone() }).await.unwrap();
    }
    let wire = requests.lock().unwrap().clone();
    assert_eq!(
        wire.len(),
        if fail_child { 3 } else { 2 },
        "no extra parent or completion request"
    );
    assert_eq!(wire[0]["stream"], true);
    assert!(
        wire[0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["function"]["name"] == "cast_voices")
    );
    for child in &wire[1..] {
        assert_ne!(child["stream"], true);
        assert_eq!(child["tools"].as_array().unwrap().len(), 1);
        assert_eq!(child["tools"][0]["function"]["name"], "finish_casting");
        let messages = child["messages"].to_string();
        assert!(messages.contains(REQUIREMENTS));
        assert!(messages.contains("voice-a"));
        assert!(
            !messages.contains("cast_voices"),
            "parent context leaked into child"
        );
    }
    if fail_child {
        assert_eq!(
            wire[1]["messages"], wire[2]["messages"],
            "retry model input must remain immutable"
        );
    }
    let page = ai::history_page(&db, &session.id, None, 100).await.unwrap();
    let completed = page
        .messages
        .iter()
        .find(|message| {
            message.role == "assistant" && message.run_id.as_deref() == Some(terminal.id.as_str())
        })
        .unwrap();
    assert_eq!(completed.status, "complete");
    assert!(completed.parts.parts().iter().any(|part| matches!(part, MessagePart::Result { reference } if reference.kind == "casting_suggestion" && reference.id == terminal.id)));
    assert_eq!(
        page.messages
            .iter()
            .filter(|message| message.role == "assistant")
            .count(),
        if fail_child { 2 } else { 1 }
    );
    assert!(page.messages.iter().flat_map(|message| message.parts.parts()).any(|part| matches!(part, MessagePart::Tool { name, state: ToolState::Completed, output: Some(value), .. } if name == "cast_voices" && value["status"] == "accepted")));
    assert_eq!(ai::active_tasks(&db).await.unwrap(), 0);
}

#[tokio::test]
async fn delegated_casting_publishes_once_and_waits_for_input() {
    casting_runtime(false).await;
}

#[tokio::test]
async fn accepted_casting_retry_reuses_frozen_input_and_skips_parent() {
    casting_runtime(true).await;
}
