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
        let models = super::super::providers::list(&lease).await.unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.model_id.as_str())
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
            super::super::providers::list(&lease).await.unwrap_err(),
            expected
        );
        assert_eq!(
            serde_json::to_value(state.snapshot().unwrap()).unwrap(),
            before
        );
    }
}
