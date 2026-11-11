use super::*;
use serde_json::json;

#[tokio::test]
async fn local_model_lists_follow_native_pages_without_changing_manual_configuration() {
    for protocol in [
        LlmProtocol::Openai,
        LlmProtocol::Anthropic,
        LlmProtocol::Gemini,
    ] {
        let fixture = Fixture::new(move |index, head, _| {
            assert!(head.starts_with("GET /gateway/"));
            match protocol {
                LlmProtocol::Openai => (200, json!({"data":[{"id":"first"},{"id":"second"}]})),
                LlmProtocol::Anthropic => {
                    if index == 0 {
                        (
                            200,
                            json!({"data":[{"id":"first","display_name":"First"}],"has_more":true,"last_id":"first"}),
                        )
                    } else {
                        assert!(head.contains("after_id=first"));
                        (
                            200,
                            json!({"data":[{"id":"second","display_name":"Second"}],"has_more":false}),
                        )
                    }
                }
                LlmProtocol::Gemini => {
                    if index == 0 {
                        (
                            200,
                            json!({"models":[{"name":"models/first"}],"nextPageToken":"next"}),
                        )
                    } else {
                        assert!(head.contains("pageToken=next"));
                        (200, json!({"models":[{"name":"models/second"}]}))
                    }
                }
            }
        });
        let (_dir, state, lease) = configured(
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
        let before = serde_json::to_value(state.snapshot().unwrap()).unwrap();
        let models = super::super::providers::list(
            protocol,
            &lease.connection.endpoint,
            &lease.key().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.model.model_id.as_str())
                .collect::<Vec<_>>(),
            ["first", "second"]
        );
        assert_eq!(
            serde_json::to_value(state.snapshot().unwrap()).unwrap(),
            before
        );
    }
}

#[tokio::test]
async fn unsupported_or_failed_listing_keeps_manual_models_and_default() {
    for (status, expected) in [
        (404, LlmError::CapabilityUnavailable),
        (405, LlmError::CapabilityUnavailable),
        (501, LlmError::CapabilityUnavailable),
        (401, LlmError::Authentication),
        (408, LlmError::Timeout),
        (500, LlmError::Network),
    ] {
        let fixture = Fixture::new(move |_, _, _| {
            (
                status,
                json!({"error":"sensitive response must not escape"}),
            )
        });
        let (_dir, state, lease) = configured(LlmProtocol::Openai, &fixture.endpoint);
        let before = serde_json::to_value(state.snapshot().unwrap()).unwrap();
        assert_eq!(
            super::super::providers::list(
                LlmProtocol::Openai,
                &lease.connection.endpoint,
                &lease.key().unwrap()
            )
            .await
            .unwrap_err(),
            expected
        );
        assert_eq!(
            serde_json::to_value(state.snapshot().unwrap()).unwrap(),
            before
        );
    }
}

#[tokio::test]
async fn listing_reports_provider_limits_without_setting_request_output() {
    let fixture = Fixture::new(|_, _, _| {
        (
            200,
            json!({"models":[{"name":"models/example", "displayName":"Example", "inputTokenLimit":32768, "outputTokenLimit":2048}]}),
        )
    });
    let models = super::super::providers::list(LlmProtocol::Gemini, &fixture.endpoint, "draft-key")
        .await
        .unwrap();
    assert_eq!(models[0].model.context_window, Some(32768));
    assert_eq!(models[0].output_limit, Some(2048));
    assert_eq!(models[0].model.max_output_tokens, None);
}

#[tokio::test]
async fn gateway_levels_are_scoped_to_endpoint_and_encode_actual_request() {
    let fixture = Fixture::new(|_, head, body| {
        if head.starts_with("GET ") {
            (
                200,
                json!({"data":[{"id":"antigravity/gemini-3.8-flash","reasoning_levels":["low","medium","high","ultra"]}]}),
            )
        } else {
            assert_eq!(body["reasoning_effort"], "high");
            (200, provider_reply(LlmProtocol::Openai, "OK"))
        }
    });
    let mut models = super::super::providers::list(LlmProtocol::Openai, &fixture.endpoint, "")
        .await
        .unwrap();
    let mut model = models.remove(0).model;
    assert_eq!(
        model.advertised_reasoning.as_ref().unwrap().levels,
        vec![
            ReasoningSetting::Low,
            ReasoningSetting::Medium,
            ReasoningSetting::High
        ]
    );
    model.id = "model".into();
    model.reasoning = ReasoningSetting::High;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm.json");
    let vault = Arc::new(Vault::default());
    let state = Arc::new(LlmState::open(path.clone(), vault.clone()).unwrap());
    let mut input = change();
    input.endpoint = fixture.endpoint.clone();
    input.models = vec![model.clone()];
    let snapshot = state.update(input).unwrap();
    let selection = ModelSelection {
        connection_id: snapshot.connections[0].id.clone(),
        model_id: "model".into(),
    };
    drop(state);
    let state = Arc::new(LlmState::open(path, vault).unwrap());
    let lease = state.acquire(&selection).unwrap();
    let native = super::super::providers::model(&lease).unwrap();
    super::super::providers::call(&native, rig_core::completion::CompletionRequest::new("OK"))
        .await
        .unwrap();
    let mut invalid = change();
    invalid.endpoint = "http://other.example".into();
    invalid.models = vec![model];
    assert!(matches!(
        state.update(invalid),
        Err(LlmError::InvalidConfiguration)
    ));
}

#[tokio::test]
async fn gateway_none_level_is_sent_as_none() {
    let fixture = Fixture::new(|_, head, body| {
        if head.starts_with("GET ") {
            (
                200,
                json!({"data":[{"id":"gateway/model", "reasoning_levels":["none","high"]}]}),
            )
        } else {
            assert_eq!(body["reasoning_effort"], "none");
            (200, provider_reply(LlmProtocol::Openai, "OK"))
        }
    });
    let mut listed = super::super::providers::list(LlmProtocol::Openai, &fixture.endpoint, "")
        .await
        .unwrap()
        .remove(0)
        .model;
    listed.id = "model".into();
    listed.reasoning = ReasoningSetting::Off;
    let dir = tempfile::tempdir().unwrap();
    let state =
        Arc::new(LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap());
    let mut input = change();
    input.endpoint = fixture.endpoint.clone();
    input.models = vec![listed];
    let snapshot = state.update(input).unwrap();
    let lease = state
        .acquire(&ModelSelection {
            connection_id: snapshot.connections[0].id.clone(),
            model_id: "model".into(),
        })
        .unwrap();
    let native = super::super::providers::model(&lease).unwrap();
    super::super::providers::call(&native, rig_core::completion::CompletionRequest::new("OK"))
        .await
        .unwrap();
}
