use super::*;
use futures_util::StreamExt;
use rig_core::{
    completion::CompletionRequest,
    streaming::{Item, StreamEvent},
};

fn sse(protocol: LlmProtocol) -> String {
    match protocol {
        LlmProtocol::Openai => concat!(
            "data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"model\":\"same\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"OK\"},\"finish_reason\":null}]}\n\n",
            "data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"model\":\"same\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n"
        ).into(),
        LlmProtocol::Anthropic => concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"test\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"same\",\"content\":[],\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"OK\"}}\n\n",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        ).into(),
        LlmProtocol::Gemini => "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"OK\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":1,\"candidatesTokenCount\":1,\"totalTokenCount\":2}}\n\n".into(),
    }
}

async fn streamed_text(lease: &super::super::config::ConnectionLease) -> Result<String, LlmError> {
    let model = super::super::providers::model(lease)?;
    let mut stream = model
        .stream(CompletionRequest::new("Reply with OK.").max_tokens(2048))
        .map_err(super::super::providers::failure)?;
    let mut text = String::new();
    while let Some(item) = stream.next().await {
        if let Item::Event(StreamEvent::Text { text: fragment, .. }) =
            item.map_err(super::super::providers::failure)?
        {
            text.push_str(&fragment);
        }
    }
    stream
        .finish()
        .await
        .map_err(super::super::providers::failure)?;
    Ok(text)
}

#[tokio::test]
async fn all_native_streams_decode_on_custom_local_paths() {
    for protocol in [
        LlmProtocol::Openai,
        LlmProtocol::Anthropic,
        LlmProtocol::Gemini,
    ] {
        let fixture = Fixture::raw(move |_, head, body| {
            assert!(head.starts_with("POST /gateway/"));
            assert!(
                body.get("stream")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(protocol == LlmProtocol::Gemini)
            );
            (200, "text/event-stream", sse(protocol).into_bytes())
        });
        let (_dir, _state, lease) = configured(
            protocol,
            &format!(
                "{}/gateway{}",
                fixture.endpoint,
                if protocol == LlmProtocol::Openai {
                    "/v1"
                } else {
                    ""
                }
            ),
        );
        assert_eq!(streamed_text(&lease).await.unwrap(), "OK", "{protocol:?}");
    }
}

#[tokio::test]
#[ignore = "requires an explicitly authorized local gateway supporting all three protocols"]
async fn configured_gateway_supports_lists_probes_and_streams_for_all_protocols() {
    let endpoint = std::env::var("CASTGLEAN_TEST_LLM_ENDPOINT").expect("endpoint");
    let root = endpoint
        .trim_end_matches('/')
        .strip_suffix("/v1")
        .unwrap_or(endpoint.trim_end_matches('/'));
    let model = std::env::var("CASTGLEAN_TEST_LLM_MODEL").expect("model");
    let key = std::env::var("CASTGLEAN_TEST_LLM_KEY").expect("key");
    let mut failures = Vec::new();
    for protocol in [
        LlmProtocol::Openai,
        LlmProtocol::Anthropic,
        LlmProtocol::Gemini,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(
            LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap(),
        );
        let mut change = change();
        change.protocol = protocol;
        change.endpoint = if protocol == LlmProtocol::Openai {
            format!("{root}/v1")
        } else {
            root.to_owned()
        };
        change.models[0].model_id = model.clone();
        change.credential = CredentialChange::Replace(key.clone());
        let connection = state.update(change).unwrap().connections.remove(0);
        let lease = state
            .acquire(&ModelSelection {
                connection_id: connection.id,
                model_id: "model".into(),
            })
            .unwrap();
        match super::super::providers::list(&lease).await {
            Ok(listed) => {
                assert!(listed.iter().any(|entry| entry.model_id == model));
                eprintln!("{protocol:?} models: {}", listed.len());
            }
            Err(error) => failures.push(format!("{protocol:?} listing: {error:?}")),
        }
        for kind in [
            ProbeKind::Connection,
            ProbeKind::Tools,
            ProbeKind::Structured,
        ] {
            let result = super::super::providers::probe(&lease, kind).await;
            eprintln!("{protocol:?} {kind:?}: {result:?}");
            if let Err(error) = result {
                failures.push(format!("{protocol:?} {kind:?}: {error:?}"));
            }
        }
        match streamed_text(&lease).await {
            Ok(text) if !text.trim().is_empty() => eprintln!("{protocol:?} streaming: passed"),
            result => failures.push(format!("{protocol:?} streaming: {:?}", result.err())),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[tokio::test]
async fn native_streams_reject_truncated_responses() {
    for protocol in [
        LlmProtocol::Openai,
        LlmProtocol::Anthropic,
        LlmProtocol::Gemini,
    ] {
        let fixture = Fixture::raw(move |_, _, _| {
            let partial = match protocol {
                LlmProtocol::Openai => sse(protocol).split("data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"model\":\"same\",\"choices\":[{\"index\":0,\"delta\":{},").next().unwrap().to_owned(),
                LlmProtocol::Anthropic => sse(protocol).split("event: message_delta").next().unwrap().to_owned(),
                LlmProtocol::Gemini => "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"partial\"}]}}]}\n\n".into(),
            };
            (200, "text/event-stream", partial.into_bytes())
        });
        let (_dir, _state, lease) = configured(protocol, &fixture.endpoint);
        assert!(streamed_text(&lease).await.is_err(), "{protocol:?}");
    }
}

#[tokio::test]
async fn probes_reject_schema_errors_without_retries_and_cancel_before_dispatch() {
    for protocol in [
        LlmProtocol::Openai,
        LlmProtocol::Anthropic,
        LlmProtocol::Gemini,
    ] {
        let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = requests.clone();
        let fixture = Fixture::new(move |index, _, _| {
            seen.fetch_add(1, Ordering::SeqCst);
            (
                200,
                provider_reply(
                    protocol,
                    if index == 0 {
                        "OK"
                    } else {
                        "{\"ok\":false,\"extra\":true}"
                    },
                ),
            )
        });
        let (_dir, _state, lease) = configured(protocol, &fixture.endpoint);
        super::super::providers::probe(&lease, ProbeKind::Connection)
            .await
            .unwrap();
        assert_eq!(
            super::super::providers::probe(&lease, ProbeKind::Structured).await,
            Err(LlmError::CapabilityUnavailable)
        );
        assert_eq!(requests.load(Ordering::SeqCst), 2);
        let token = tokio_util::sync::CancellationToken::new();
        token.cancel();
        assert_eq!(
            super::super::providers::probe_cancellable(&lease, ProbeKind::Connection, &token).await,
            Err(LlmError::Cancelled)
        );
        assert_eq!(requests.load(Ordering::SeqCst), 2);
    }
}

#[tokio::test]
async fn cancellation_during_a_request_discards_a_late_success() {
    let arrived = Arc::new(tokio::sync::Notify::new());
    let server_arrived = arrived.clone();
    let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = requests.clone();
    let fixture = Fixture::new(move |_, _, _| {
        seen.fetch_add(1, Ordering::SeqCst);
        server_arrived.notify_one();
        std::thread::sleep(std::time::Duration::from_millis(50));
        (200, provider_reply(LlmProtocol::Openai, "OK"))
    });
    let (_dir, _state, lease) = configured(LlmProtocol::Openai, &fixture.endpoint);
    let token = tokio_util::sync::CancellationToken::new();
    let cancel = async {
        arrived.notified().await;
        token.cancel();
    };
    let (result, ()) = tokio::join!(
        super::super::providers::probe_cancellable(&lease, ProbeKind::Connection, &token),
        cancel
    );
    assert_eq!(result, Err(LlmError::Cancelled));
    assert_eq!(requests.load(Ordering::SeqCst), 1);
}
