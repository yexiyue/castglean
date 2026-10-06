//! Local HTTP contract checks; no credentials or external calls required.
use castglean_core::*;
use castglean_model::*;
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::Duration,
};

fn server(status: u16, body: String) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/test/v4/", listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut buffer = [0u8; 4096];
            let n = socket.read(&mut buffer).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&buffer[..n]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length: "))
                    .unwrap()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        write!(socket, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        String::from_utf8(bytes).unwrap()
    });
    (endpoint, handle)
}
fn request() -> ModelRequest {
    ModelRequest {
        system: "test instruction".into(),
        user: "test input".into(),
        max_output_tokens: 1234,
    }
}
fn body(reason: &str) -> String {
    json!({"id":"mock","object":"chat.completion","model":"glm-4.6","choices":[{"index":0,"message":{"role":"assistant","content":"{\"characters\":[],\"segments\":[]}"},"finish_reason":reason}],"usage":{"prompt_tokens":7,"completion_tokens":9,"total_tokens":16}}).to_string()
}
#[test]
fn config_rejects_bad_values_and_normalizes_endpoint() {
    let config = GlmConfig::new(DEFAULT_GLM_MODEL, "http://localhost:1234/v4", "test-key").unwrap();
    assert_eq!(config.endpoint(), "http://localhost:1234/v4/");
    for (model, endpoint, key) in [
        ("glm-4.6", DEFAULT_GLM_ENDPOINT, "key"),
        ("bigmodel::", DEFAULT_GLM_ENDPOINT, "key"),
        (DEFAULT_GLM_MODEL, "file:///tmp", "key"),
        (DEFAULT_GLM_MODEL, "https://user:pass@example.com", "key"),
        (DEFAULT_GLM_MODEL, DEFAULT_GLM_ENDPOINT, " "),
    ] {
        assert!(GlmConfig::new(model, endpoint, key).is_err());
    }
}
#[tokio::test]
async fn explicit_endpoint_auth_limit_usage_and_truncation() {
    for reason in ["stop", "length"] {
        let (endpoint, handle) = server(200, body(reason));
        let model = GlmModel::new(
            GlmConfig::new(DEFAULT_GLM_MODEL, endpoint, "explicit-test-key")
                .unwrap()
                .with_output_mode(GlmOutputMode::Json),
        )
        .unwrap();
        let result = model.generate(request()).await.unwrap();
        assert_eq!(result.truncated, reason == "length");
        assert_eq!(result.usage.input, Some(7));
        assert_eq!(result.usage.output, Some(9));
        assert_eq!(result.usage.reasoning, None);
        let wire = handle.join().unwrap();
        assert!(wire.starts_with("POST /test/v4/chat/completions "));
        assert!(
            wire.to_lowercase()
                .contains("authorization: bearer explicit-test-key")
        );
        let payload: serde_json::Value =
            serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(payload["max_tokens"], 1234);
        assert_eq!(payload["reasoning_effort"], "low");
        assert_eq!(payload["model"], "glm-4.6");
        assert_eq!(payload["response_format"]["type"], "json_object");
        assert!(payload.get("tools").is_none());
    }
}
#[tokio::test]
async fn reasoning_levels_and_optional_usage_are_preserved() {
    for effort in [
        GlmReasoningEffort::Low,
        GlmReasoningEffort::High,
        GlmReasoningEffort::Max,
    ] {
        let mut response: serde_json::Value = serde_json::from_str(&body("stop")).unwrap();
        response["usage"]["completion_tokens_details"] = json!({"reasoning_tokens": 4});
        let (endpoint, handle) = server(200, response.to_string());
        let config = GlmConfig::new(DEFAULT_GLM_MODEL, endpoint, "key")
            .unwrap()
            .with_output_mode(GlmOutputMode::Json)
            .with_reasoning_effort(effort);
        let result = GlmModel::new(config)
            .unwrap()
            .generate(request())
            .await
            .unwrap();
        assert_eq!(result.usage.output, Some(9));
        assert_eq!(result.usage.reasoning, Some(4));
        let wire = handle.join().unwrap();
        let payload: serde_json::Value =
            serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(payload["reasoning_effort"], effort.as_str());
        assert!(payload.get("thinking").is_none());
    }
    assert!("medium".parse::<GlmReasoningEffort>().is_err());
    assert!("private-invalid".parse::<GlmReasoningEffort>().is_err());
    let historical: TokenUsage = serde_json::from_str(r#"{"input":7,"output":9}"#).unwrap();
    assert_eq!(historical.reasoning, None);
    let historical: AnalysisStats =
        serde_json::from_str(r#"{"requests":1,"usage":[{"input":7,"output":9}],"elapsed_ms":10}"#)
            .unwrap();
    assert!(historical.response_bytes.is_empty());
    assert_eq!(historical.usage[0].reasoning, None);
}
#[tokio::test]
async fn provider_errors_are_categorized_and_redacted() {
    for (status, expected) in [
        (401, ModelError::Authentication),
        (403, ModelError::Authentication),
        (429, ModelError::RateLimited),
        (500, ModelError::Transport),
    ] {
        let (endpoint, handle) = server(
            status,
            json!({"error":{"message":"private-key-and-novel"}}).to_string(),
        );
        let model = GlmModel::new(
            GlmConfig::new(DEFAULT_GLM_MODEL, endpoint, "explicit-test-key").unwrap(),
        )
        .unwrap();
        let error = match model.generate(request()).await {
            Err(e) => e,
            Ok(_) => panic!("must fail"),
        };
        assert_eq!(error, expected);
        assert!(!format!("{error:?} {error}").contains("private-key-and-novel"));
        handle.join().unwrap();
    }
}
#[tokio::test]
async fn unsupported_finish_and_invalid_body_fail() {
    for content in [body("content_filter"), "not-json".into()] {
        let (endpoint, handle) = server(200, content);
        let model =
            GlmModel::new(GlmConfig::new(DEFAULT_GLM_MODEL, endpoint, "key").unwrap()).unwrap();
        assert!(model.generate(request()).await.is_err());
        handle.join().unwrap();
    }
}

fn tool_body(name: &str, count: usize, finish: &str) -> String {
    json!({"model":"glm-4.6","choices":[{"message":{"role":"assistant","tool_calls":(0..count).map(|i| json!({"id":format!("call-{i}"),"type":"function","function":{"name":name,"arguments":"{\"characters\":[],\"segments\":[]}"}})).collect::<Vec<_>>()},"finish_reason":if finish == "missing" {json!(null)} else {json!(finish)}}],"usage":{"prompt_tokens":7,"completion_tokens":9}}).to_string()
}
#[tokio::test]
async fn tool_submission_enforces_name_count_stop_and_truncation() {
    for (name, count, finish, succeeds) in [
        ("submit_analysis", 1, "tool_calls", true),
        ("submit_analysis", 1, "length", true),
        ("other", 1, "tool_calls", false),
        ("submit_analysis", 2, "tool_calls", false),
        ("submit_analysis", 0, "tool_calls", false),
        ("submit_analysis", 1, "stop", false),
        ("submit_analysis", 1, "missing", false),
    ] {
        let (endpoint, handle) = server(200, tool_body(name, count, finish));
        let model = GlmModel::new(
            GlmConfig::new(DEFAULT_GLM_MODEL, endpoint, "key")
                .unwrap()
                .with_output_mode(GlmOutputMode::Tool),
        )
        .unwrap();
        let result = model.generate(request()).await;
        assert_eq!(result.is_ok(), succeeds);
        if let Ok(response) = result {
            assert_eq!(response.truncated, finish == "length");
            assert!(serde_json::from_str::<AnalysisSuggestion>(&response.text).is_ok());
        }
        let wire = handle.join().unwrap();
        let payload: serde_json::Value =
            serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(
            payload["tool_choice"]["function"]["name"],
            "submit_analysis"
        );
        assert_eq!(payload["tools"].as_array().unwrap().len(), 1);
        assert_eq!(payload["tools"][0]["function"]["strict"], true);
        assert!(payload.get("response_format").is_none());
    }
}
#[tokio::test]
async fn schema_is_sent_and_text_modes_reject_tool_calls() {
    let (endpoint, handle) = server(200, body("stop"));
    let model = GlmModel::new(
        GlmConfig::new(DEFAULT_GLM_MODEL, endpoint, "key")
            .unwrap()
            .with_output_mode(GlmOutputMode::Schema),
    )
    .unwrap();
    model.generate(request()).await.unwrap();
    let wire = handle.join().unwrap();
    let payload: serde_json::Value =
        serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(payload["response_format"]["type"], "json_schema");
    assert_eq!(payload["response_format"]["json_schema"]["strict"], true);
    assert!(
        payload["response_format"]["json_schema"]["schema"]["properties"]["segments"].is_object()
    );
    for mode in [GlmOutputMode::Json, GlmOutputMode::Schema] {
        let (endpoint, handle) = server(200, tool_body("submit_analysis", 1, "stop"));
        let model = GlmModel::new(
            GlmConfig::new(DEFAULT_GLM_MODEL, endpoint, "key")
                .unwrap()
                .with_output_mode(mode),
        )
        .unwrap();
        assert!(model.generate(request()).await.is_err());
        handle.join().unwrap();
    }
    assert!("private-invalid".parse::<GlmOutputMode>().is_err());
}

#[tokio::test]
async fn tool_arguments_must_be_a_single_object() {
    for arguments in ["[]", "null", "private-invalid"] {
        let mut body: serde_json::Value =
            serde_json::from_str(&tool_body("submit_analysis", 1, "tool_calls")).unwrap();
        body["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = json!(arguments);
        let (endpoint, handle) = server(200, body.to_string());
        let model = GlmModel::new(
            GlmConfig::new(DEFAULT_GLM_MODEL, endpoint, "key")
                .unwrap()
                .with_output_mode(GlmOutputMode::Tool),
        )
        .unwrap();
        let error = model.generate(request()).await.err().unwrap();
        assert_eq!(error, ModelError::Response);
        assert!(!error.to_string().contains("private-invalid"));
        handle.join().unwrap();
    }
}
