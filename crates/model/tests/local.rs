//! Local model HTTP contracts without external requests.
use castglean_core::*;
use castglean_model::*;
use serde_json::{Value, json};
mod support;
use support::{server, server_with_encoding};

fn request() -> ModelRequest {
    ModelRequest {
        evidence_mode: castglean_core::EvidenceMode::SegmentIds,
        system: "instruction".into(),
        user: "input".into(),
        max_output_tokens: 123,
    }
}

#[tokio::test]
async fn chunked_body_is_bounded_without_content_length() {
    let (endpoint, handle) = server_with_encoding(200, "x".repeat(1024 * 1024 + 1), true);
    let error = LocalModel::new(LocalConfig::new("default", &endpoint).unwrap())
        .unwrap()
        .generate(request())
        .await
        .err()
        .unwrap();
    assert_eq!(error, ModelError::Response);
    handle.join().unwrap();
}
fn body(reason: &str) -> Value {
    json!({"choices":[{"message":{"content":"{\"characters\":[],\"segments\":[]}"},"finish_reason":reason}],
        "usage":{"prompt_tokens":7,"completion_tokens":9,"completion_tokens_details":{"reasoning_tokens":0}}})
}
#[tokio::test]
async fn quotation_mode_forwards_the_experimental_schema() {
    let (endpoint, handle) = server(200, body("stop").to_string());
    let mut request = request();
    request.evidence_mode = EvidenceMode::VerifiedQuotes;
    LocalModel::new(LocalConfig::new("default", &endpoint).unwrap())
        .unwrap()
        .generate(request)
        .await
        .unwrap();
    let wire = handle.join().unwrap();
    let payload: Value = serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(
        payload["response_format"]["json_schema"]["schema"],
        analysis_suggestion_schema_for(EvidenceMode::VerifiedQuotes).to_value()
    );
}
#[test]
fn explicit_configuration_and_invalid_values() {
    let config = LocalConfig::new("default", "http://localhost:1234/v1").unwrap();
    assert_eq!(
        config.endpoint(),
        DEFAULT_LOCAL_ENDPOINT.replace("127.0.0.1", "localhost")
    );
    assert_eq!(config.model(), "default");
    for (model, url) in [
        (" ", DEFAULT_LOCAL_ENDPOINT),
        ("alias\nname", DEFAULT_LOCAL_ENDPOINT),
        ("default", "file:///tmp"),
        ("default", "https://user:secret@example.com/v1"),
        ("default", "http://localhost/v1?secret=key"),
        ("default", "http://localhost/v1#fragment"),
    ] {
        assert!(LocalConfig::new(model, url).is_err());
    }
}
#[tokio::test]
async fn schema_thinking_usage_and_truncation() {
    for reason in ["stop", "length"] {
        let (endpoint, handle) = server(200, body(reason).to_string());
        let response = LocalModel::new(LocalConfig::new("custom-alias", &endpoint).unwrap())
            .unwrap()
            .generate(request())
            .await
            .unwrap();
        assert_eq!(response.truncated, reason == "length");
        assert_eq!(response.usage.input, Some(7));
        assert_eq!(response.usage.output, Some(9));
        assert_eq!(response.usage.reasoning, Some(0));
        let wire = handle.join().unwrap();
        assert!(wire.starts_with("POST /test/v4/chat/completions "));
        assert!(!wire.to_lowercase().contains("authorization:"));
        let payload: Value = serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(payload["model"], "custom-alias");
        assert_eq!(payload["enable_thinking"], false);
        assert_eq!(payload["reasoning_effort"], "off");
        assert_eq!(payload["max_tokens"], 123);
        assert_eq!(payload["temperature"], 0);
        assert_eq!(payload["response_format"]["type"], "json_schema");
        assert_eq!(
            payload["response_format"]["json_schema"]["schema"],
            serde_json::to_value(analysis_suggestion_schema()).unwrap()
        );
    }
}
#[tokio::test]
async fn service_errors_remain_safe_without_fallback() {
    for (status, expected) in [
        (401, ModelError::Authentication),
        (403, ModelError::Authentication),
        (429, ModelError::RateLimited),
        (503, ModelError::Transport),
        (302, ModelError::Transport),
    ] {
        let (endpoint, handle) = server(status, "private-source-and-key".into());
        let error = LocalModel::new(LocalConfig::new("default", &endpoint).unwrap())
            .unwrap()
            .generate(request())
            .await
            .err()
            .unwrap();
        assert_eq!(error, expected);
        assert!(!error.to_string().contains("private-source-and-key"));
        handle.join().unwrap();
    }
}
#[tokio::test]
async fn invalid_response_and_missing_usage() {
    let mut multiple = body("stop");
    multiple["choices"]
        .as_array_mut()
        .unwrap()
        .push(body("stop")["choices"][0].clone());
    let mut empty = body("stop");
    empty["choices"][0]["message"]["content"] = json!(" ");
    let mut tool = body("stop");
    tool["choices"][0]["message"]["tool_calls"] = json!([{}]);
    for body in [
        "private-invalid".into(),
        "{}".into(),
        multiple.to_string(),
        empty.to_string(),
        tool.to_string(),
        body("tool_calls").to_string(),
        "x".repeat(1024 * 1024 + 1),
    ] {
        let (endpoint, handle) = server(200, body);
        let error = LocalModel::new(LocalConfig::new("default", &endpoint).unwrap())
            .unwrap()
            .generate(request())
            .await
            .err()
            .unwrap();
        assert_eq!(error, ModelError::Response);
        handle.join().unwrap();
    }
    let mut no_usage = body("stop");
    no_usage.as_object_mut().unwrap().remove("usage");
    let (endpoint, handle) = server(200, no_usage.to_string());
    let response = LocalModel::new(LocalConfig::new("default", &endpoint).unwrap())
        .unwrap()
        .generate(request())
        .await
        .unwrap();
    assert_eq!(response.usage.input, None);
    assert_eq!(response.usage.output, None);
    handle.join().unwrap();
}
