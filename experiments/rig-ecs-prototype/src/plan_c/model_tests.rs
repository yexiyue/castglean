use super::*;
use rig_core::{
    completion::{AssistantContent, Message, ToolDefinition},
    message::{
        CallId, Origin, ToolCall, ToolFunction, ToolName, ToolResult, ToolResultContent,
        UserContent,
    },
};

#[cfg(unix)]
fn fixture(response: Value, script: Option<&str>) -> (tempfile::TempDir, Boundary) {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let helper = root.path().join("helper");
    let reply = root.path().join("reply.json");
    fs::write(&reply, serde_json::to_vec(&response).unwrap()).unwrap();
    let body = script.map(str::to_owned).unwrap_or_else(|| format!(
        "cp '{}' \"${{CASTGLEAN_EXPERIMENT_JOB%.json}}.result.json\"\ncp \"$CASTGLEAN_EXPERIMENT_JOB\" '{}'\n",
        reply.display(), root.path().join("observed.json").display()));
    fs::write(&helper, format!("#!/bin/sh\n{body}")).unwrap();
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
    let config = root.path().join("llm.json");
    fs::write(&config, serde_json::to_vec(&json!({"version":1,"connections":[{"connection":{
        "id":"connection","revision":1,"protocol":"openai","endpoint":"http://unreachable.invalid/v1",
        "models":[{"id":"model","modelId":"test","contextWindow":128000,"maxOutputTokens":8192}]
    }}]})).unwrap()).unwrap();
    let native = root.path().join("native.json");
    fs::write(
        &native,
        serde_json::to_vec(&json!({"bridgeBinary":helper,"configPath":config,
        "selection":{"connectionId":"connection","modelId":"model"},"controlledHelper":true}))
        .unwrap(),
    )
    .unwrap();
    let boundary = build(
        &native,
        &root.path().join("jobs"),
        "classic",
        "run",
        "sourcehash",
    )
    .unwrap();
    // A controlled helper returns the exact same binding identity a native helper must.
    let mut response = response;
    if response["ok"] == true {
        response["configurationHash"] = json!(boundary.configuration_hash);
        response["model"] = json!(boundary.model_id);
        fs::write(reply, serde_json::to_vec(&response).unwrap()).unwrap();
    }
    (root, boundary)
}
fn response(usage: Usage) -> CompletionResponse {
    CompletionResponse::new(
        vec![AssistantContent::text("done")],
        usage,
        Origin::new("openai.chat", "openai", "test"),
        json!({"provider":"raw"}),
    )
}

#[cfg(unix)]
#[tokio::test]
async fn complete_tool_history_and_response_cross_the_bridge_without_text_flattening() {
    let name = ToolName::new("check_draft").unwrap();
    let tool_call = AssistantContent::ToolCall(ToolCall::from_wire(
        "call_1",
        ToolFunction::new(name.clone(), json!({"private":"arguments"})),
    ));
    let turn = CompletionResponse::new(
        vec![tool_call.clone()],
        Usage::new(),
        Origin::new("openai.chat", "openai", "test"),
        Value::Null,
    );
    let result = Message::User {
        content: vec![UserContent::ToolResult(ToolResult {
            call: CallId::from_wire("call_1"),
            name: name.clone(),
            is_error: false,
            content: vec![ToolResultContent::text("private result")],
        })],
    };
    let request = CompletionRequest::new("private source")
        .preamble("private prompt")
        .message(turn.message().unwrap())
        .message(result)
        .tool(ToolDefinition::new(name, "check", json!({"type":"object"})))
        .max_tokens(9999);
    let mut reply = response(
        Usage::new()
            .input_tokens(100)
            .output_tokens(20)
            .total_tokens(120),
    );
    reply.choice = vec![tool_call];
    let (root, boundary) = fixture(json!({"ok":true,"response":reply}), None);
    boundary
        .set_hashes(&"a".repeat(64), &"b".repeat(64))
        .unwrap();
    let returned = boundary.model.call(request).await.unwrap();
    assert_eq!(returned.choice, reply.choice);
    assert_eq!(returned.usage, reply.usage);
    assert_eq!(returned.raw, reply.raw);
    let job: Value =
        serde_json::from_slice(&fs::read(root.path().join("observed.json")).unwrap()).unwrap();
    let carried: CompletionRequest = serde_json::from_value(job["request"].clone()).unwrap();
    // Rig normalizes adjacent user messages into one. Assert content and types,
    // not the incidental number of message envelopes.
    assert!(
        carried.chat_history.iter().any(
            |m| matches!(m.as_ref(), Message::System { content } if content == "private prompt")
        )
    );
    assert!(carried.chat_history.iter().any(|m| matches!(m.as_ref(), Message::User { content } if content.iter().any(|c| matches!(c, UserContent::Text(text) if text.text == "private source")))));
    assert!(
        carried
            .chat_history
            .iter()
            .any(|m| matches!(m.as_ref(), Message::Assistant(_)))
    );
    assert_eq!(carried.tools.len(), 1);
    assert!(carried.chat_history.iter().any(|m| matches!(m.as_ref(), Message::User {content} if content.iter().any(|c| matches!(c, UserContent::ToolResult(_))))));
    assert_eq!(carried.max_tokens, Some(4096));
    assert_eq!(
        carried.options.reasoning,
        Some(Reasoning::Effort(Effort::Low))
    );
    assert_eq!(boundary.usage().total_tokens, Some(120));
    let traces = serde_json::to_string(&boundary.traces()).unwrap();
    for private in [
        "private source",
        "private prompt",
        "arguments",
        "private result",
        "provider",
    ] {
        assert!(!traces.contains(private));
    }
    boundary.drain().await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn provider_failure_is_terminal_and_never_retried() {
    let (_root, boundary) = fixture(json!({"ok":false,"error":"must never escape"}), None);
    for _ in 0..2 {
        assert!(
            boundary
                .model
                .call(CompletionRequest::new("test"))
                .await
                .is_err()
        );
    }
    assert_eq!(boundary.traces().len(), 1);
    assert_eq!(boundary.native.state.lock().unwrap().requests, 1);
}

#[cfg(unix)]
#[tokio::test]
async fn request_and_known_token_budgets_stop_new_admission() {
    let (_root, boundary) = fixture(
        json!({"ok":true,"response":response(Usage::new().total_tokens(4000))}),
        None,
    );
    for _ in 0..16 {
        boundary
            .model
            .call(CompletionRequest::new("test"))
            .await
            .unwrap();
    }
    assert!(
        boundary
            .model
            .call(CompletionRequest::new("test"))
            .await
            .is_err()
    );
    assert_eq!(boundary.traces().len(), 16);
    assert_eq!(boundary.usage().total_tokens, Some(64000));
}

#[cfg(unix)]
#[tokio::test]
async fn changed_helper_hash_fails_before_launch() {
    let (root, boundary) = fixture(json!({"ok":true,"response":response(Usage::new())}), None);
    fs::write(root.path().join("helper"), "#!/bin/sh\nexit 1\n").unwrap();
    assert!(
        boundary
            .model
            .call(CompletionRequest::new("test"))
            .await
            .is_err()
    );
    assert!(!root.path().join("observed.json").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn cancelled_caller_reaps_child_and_finishes_a_redacted_span() {
    let (root, boundary) = fixture(
        Value::Null,
        Some("echo $$ > \"${CASTGLEAN_EXPERIMENT_JOB%.json}.pid\"\nexec sleep 60\n"),
    );
    let model = boundary.model.clone();
    let task = tokio::spawn(async move { model.call(CompletionRequest::new("test")).await });
    let pid = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            for dir in fs::read_dir(root.path().join("jobs")).unwrap() {
                let path = dir.unwrap().path().join("job.pid");
                if let Ok(pid) = fs::read_to_string(path) {
                    return pid.trim().to_owned();
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    task.abort();
    let _ = task.await;
    boundary.drain().await.unwrap();
    let status = std::process::Command::new("kill")
        .args(["-0", &pid])
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(!status.success(), "helper must be killed and reaped");
    assert_eq!(boundary.traces()[0]["status"], "failed_or_unknown");
}
