//! MiniMax contracts tested against an isolated loopback server.
mod support;
use castglean_core::*;
use castglean_model::*;
use serde_json::{Value, json};
use support::{server, server_with_encoding};

fn request() -> ModelRequest {
    ModelRequest {
        system: "instructions".into(),
        user: "novel".into(),
        max_output_tokens: 512,
    }
}
fn body(reason: &str, content: &str) -> Value {
    json!({"base_resp":{"status_code":0},"choices":[{"finish_reason":reason,
        "message":{"content":content,"reasoning_content":"not a JSON suggestion"}}],
        "usage":{"prompt_tokens":5,"completion_tokens":17}})
}
async fn generate(endpoint: &str) -> Result<ModelResponse, ModelError> {
    MiniMaxModel::new(MiniMaxConfig::new("MiniMax-M2.5", endpoint, "test-key")?)?
        .generate(request())
        .await
}
#[tokio::test]
async fn final_content_authentication_and_provider_parameters() {
    for reason in ["stop", "length"] {
        let (endpoint, handle) = server(200, body(reason, "{}").to_string());
        let result = generate(&endpoint).await.unwrap();
        assert_eq!(result.text, "{}");
        assert_eq!(result.truncated, reason == "length");
        assert_eq!(result.usage.input, Some(5));
        assert_eq!(result.usage.output, Some(17));
        assert_eq!(result.usage.reasoning, None);
        let wire = handle.join().unwrap();
        assert!(
            wire.to_lowercase()
                .contains("authorization: bearer test-key")
        );
        let payload: Value = serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(payload["reasoning_split"], true);
        assert_eq!(payload["max_completion_tokens"], 512);
        assert!(payload.get("response_format").is_none());
        assert!(payload.get("reasoning_effort").is_none());
    }
}
#[test]
fn credentials_and_remote_endpoint_are_validated_without_echo() {
    let config =
        MiniMaxConfig::new(DEFAULT_MINIMAX_MODEL, DEFAULT_MINIMAX_ENDPOINT, "test-key").unwrap();
    assert_eq!(config.endpoint(), DEFAULT_MINIMAX_ENDPOINT);
    for (endpoint, key) in [
        (DEFAULT_MINIMAX_ENDPOINT, ""),
        (DEFAULT_MINIMAX_ENDPOINT, "bad\r\nkey"),
        ("http://example.com/v1/", "test-key"),
        ("https://user:secret@example.com/v1/", "test-key"),
    ] {
        let error = MiniMaxConfig::new(DEFAULT_MINIMAX_MODEL, endpoint, key)
            .err()
            .unwrap();
        assert_eq!(error, ModelError::Configuration);
        assert!(!error.to_string().contains("secret"));
    }
}
#[tokio::test]
async fn business_and_http_errors_are_safe() {
    for (http, code, expected) in [
        (401, 0, ModelError::Authentication),
        (429, 0, ModelError::RateLimited),
        (302, 0, ModelError::Transport),
        (200, 1004, ModelError::Authentication),
        (200, 1002, ModelError::RateLimited),
        (200, 2056, ModelError::RateLimited),
        (200, 2013, ModelError::Configuration),
        (200, 9999, ModelError::Transport),
    ] {
        let (endpoint, handle) = server(
            http,
            json!({"base_resp":{"status_code":code,"status_msg":"private-key-source"}}).to_string(),
        );
        let error = generate(&endpoint).await.err().unwrap();
        assert_eq!(error, expected);
        assert!(!error.to_string().contains("private-key-source"));
        handle.join().unwrap();
    }
}
#[tokio::test]
async fn oversized_and_reasoning_only_responses_are_rejected() {
    for chunked in [false, true] {
        let (endpoint, handle) = server_with_encoding(200, "x".repeat(1024 * 1024 + 1), chunked);
        assert_eq!(generate(&endpoint).await.err(), Some(ModelError::Response));
        handle.join().unwrap();
    }
    let (endpoint, handle) = server(200, body("stop", "").to_string());
    assert_eq!(generate(&endpoint).await.err(), Some(ModelError::Response));
    handle.join().unwrap();
    let (endpoint, handle) = server(200, body("length", "").to_string());
    assert!(generate(&endpoint).await.unwrap().truncated);
    handle.join().unwrap();
    let mut truncated = body("length", "");
    truncated["choices"][0]["message"]["content"] = Value::Null;
    let (endpoint, handle) = server(200, truncated.to_string());
    assert!(generate(&endpoint).await.unwrap().truncated);
    handle.join().unwrap();
}
