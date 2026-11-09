//! Real native Rig/SSE fixtures. No external provider or project adoption.
use super::*;
use crate::ai::messages::{MessagePart, ToolState};
use crate::novel_import::splitting::{
    graph,
    test_support::{fixture_saved, tool_context},
};
use serde_json::json;
use std::time::{Duration, Instant};
fn model(endpoint: &str) -> DynModel<Completion> {
    rig_core::providers::openai::OpenAIConfig::new("test")
        .with_base_url(format!("{endpoint}/v1"))
        .connect(crate::llm::TestHttp::new(endpoint).unwrap())
        .chat("test")
        .erase()
}
fn sse(index: usize, delta: Value, tool: bool) -> Vec<u8> {
    let first = json!({"id":format!("reply{index}"),"object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":delta,"finish_reason":null}]});
    let end = json!({"id":format!("reply{index}"),"object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":if tool {"tool_calls"} else {"stop"}}]});
    format!("data: {first}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes()
}
#[tokio::test]
async fn malformed_typed_call_is_failed_counted_and_repair_creates_one_pending_candidate() {
    let fixture = crate::llm::test_support::Fixture::raw(|index, _, body| {
        let (delta, tool) = if index < 2 {
            let args = if index == 0 {
                json!({"plan":{"kind":"rules","rules":"not-an-array"}})
            } else {
                let outputs = body["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|m| m["role"] == "tool")
                    .collect::<Vec<_>>();
                assert_eq!(outputs.len(), 1);
                assert!(
                    outputs[0]["content"]
                        .as_str()
                        .unwrap()
                        .contains("invalid_arguments")
                );
                json!({"plan":{"kind":"rules","rules":crate::novel_import::heading_rules()}})
            };
            (
                json!({"role":"assistant","content":null,"tool_calls":[{"index":0,"id":format!("call{index}"),"type":"function","function":{"name":"finish_splitting","arguments":args.to_string()}}]}),
                true,
            )
        } else {
            assert_eq!(index, 2);
            (json!({"role":"assistant","content":"请审阅候选。"}), false)
        };
        let system = body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["role"] == "system")
            .unwrap();
        // Native OpenAI chat can encode system content as typed blocks.
        assert!(!system["content"].to_string().contains("analyze_chapter"));
        assert!(
            body["tools"]
                .as_array()
                .unwrap()
                .iter()
                .all(|tool| tool["function"]["name"] != "analyze_chapter")
        );
        (200, "text/event-stream", sse(index, delta, tool))
    });
    let (root, db, state, lease) = fixture_saved().await;
    graph::execute(
        tool_context(root.path(), &db, &lease),
        model(&fixture.endpoint),
        None,
    )
    .await
    .unwrap();
    let page = ai::history_page(&db, lease.session_id(), None, 20)
        .await
        .unwrap();
    assert_eq!(page.session.budget.requests, 2);
    assert_eq!(page.session.budget.tool_calls, 2);
    let facts = page
        .messages
        .iter()
        .flat_map(|m| m.parts.parts())
        .filter_map(|p| {
            if let MessagePart::Tool {
                state,
                result,
                output,
                ..
            } = p
            {
                Some((state, result, output))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    assert_eq!(facts.len(), 2);
    assert_eq!(*facts[0].0, ToolState::Failed);
    assert!(facts[0].1.is_none());
    assert_eq!(facts[0].2.as_ref().unwrap()["error"], "invalid_arguments");
    assert_eq!(*facts[1].0, ToolState::Completed);
    assert!(facts[1].1.is_some());
    let latest = crate::project::store::read(&db, root.path(), &state.document.project.id)
        .await
        .unwrap();
    assert_eq!(
        latest.document.project.revision,
        state.document.project.revision
    );
    assert!(ai::model_input(&db, lease.session_id()).await.is_ok());
}
#[tokio::test]
async fn actual_stream_provider_errors_keep_their_safe_categories_and_unknown_usage() {
    for (status, expected) in [
        (401, RunFailure::ConfigurationUnavailable),
        (408, RunFailure::Timeout),
        (429, RunFailure::Unknown),
    ] {
        let fixture = crate::llm::test_support::Fixture::new(move |_, _, _| {
            (
                status,
                json!({"error":{"message":"private provider detail"}}),
            )
        });
        let (root, db, _, lease) = fixture_saved().await;
        assert_eq!(
            graph::execute(
                tool_context(root.path(), &db, &lease),
                model(&fixture.endpoint),
                None
            )
            .await,
            Err(expected)
        );
        let page = ai::history_page(&db, lease.session_id(), None, 20)
            .await
            .unwrap();
        assert_eq!(page.session.budget.requests, 1);
        assert_eq!(page.session.budget.tool_calls, 0);
        assert!(page.messages.iter().all(|m| m.usage.is_none()));
        assert!(
            !serde_json::to_string(&page)
                .unwrap()
                .contains("private provider detail")
        );
    }
}
#[tokio::test]
async fn cancellation_interrupts_a_stream_before_its_next_chunk() {
    let started = Arc::new(tokio::sync::Notify::new());
    let observed = started.clone();
    let fixture = crate::llm::test_support::Fixture::raw(move |_, _, _| {
        observed.notify_one();
        std::thread::sleep(Duration::from_secs(1));
        (
            200,
            "text/event-stream",
            sse(0, json!({"role":"assistant","content":"迟到"}), false),
        )
    });
    let (root, db, _, lease) = fixture_saved().await;
    let tools = tool_context(root.path(), &db, &lease);
    let token = tools.token.clone();
    let cancel = async {
        started.notified().await;
        token.cancel();
        Instant::now()
    };
    let run = graph::execute(tools, model(&fixture.endpoint), None);
    let (cancelled, result) = tokio::join!(cancel, run);
    assert_eq!(result, Err(RunFailure::Cancelled));
    assert!(cancelled.elapsed() < Duration::from_millis(500));
}

mod context;
