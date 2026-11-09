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
    fixture_profile(response, script, false)
}

#[cfg(unix)]
fn fixture_profile(
    response: Value,
    script: Option<&str>,
    unlimited_tokens: bool,
) -> (tempfile::TempDir, Boundary) {
    fixture_options(
        response,
        script,
        unlimited_tokens,
        false,
        ReasoningEffort::Low,
    )
}

#[cfg(unix)]
fn fixture_options(
    response: Value,
    script: Option<&str>,
    unlimited_tokens: bool,
    unlimited_time: bool,
    reasoning: ReasoningEffort,
) -> (tempfile::TempDir, Boundary) {
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
        "selection":{"connectionId":"connection","modelId":"model"},"controlledHelper":true,"unlimitedTokens":unlimited_tokens,"unlimitedTime":unlimited_time,"reasoningEffort":reasoning.as_str()}))
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
        .set_hashes(&"a".repeat(64), &"b".repeat(64), false)
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
    for unlimited_time in [false, true] {
        let (root, boundary) = fixture_options(
            Value::Null,
            Some("echo $$ > \"${CASTGLEAN_EXPERIMENT_JOB%.json}.pid\"\nexec sleep 60\n"),
            false,
            unlimited_time,
            ReasoningEffort::Low,
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
}

#[cfg(unix)]
#[tokio::test]
async fn unlimited_profile_removes_output_and_cumulative_caps_but_keeps_request_budget() {
    let (root, boundary) = fixture_profile(
        json!({"ok":true,"response":response(Usage::new().total_tokens(65000))}),
        None,
        true,
    );
    assert!(boundary.unlimited_tokens());
    assert_eq!(boundary.spec.max_output_tokens, None);
    boundary
        .set_hashes(&"a".repeat(64), &"b".repeat(64), true)
        .unwrap();
    for _ in 0..16 {
        boundary
            .model
            .call(CompletionRequest::new("test").max_tokens(9999))
            .await
            .unwrap();
    }
    assert_eq!(boundary.usage().total_tokens, Some(16 * 65000));
    assert!(
        boundary
            .model
            .call(CompletionRequest::new("test"))
            .await
            .is_err()
    );
    let job: Value =
        serde_json::from_slice(&fs::read(root.path().join("observed.json")).unwrap()).unwrap();
    let request: CompletionRequest = serde_json::from_value(job["request"].clone()).unwrap();
    assert_eq!(request.max_tokens, None);
    assert_eq!(job["unlimitedTokens"], true);
    let expected_hash = boundary.effective_hash(true).unwrap();
    for trace in boundary.traces() {
        assert_eq!(trace["configurationHash"], expected_hash);
        assert_eq!(trace["identityScope"], "discovery");
        assert_eq!(trace["maxOutputTokens"], Value::Null);
        assert_eq!(trace["finishReason"], Value::Null);
        assert_eq!(trace["budgets"]["profile"], "unlimited-tokens");
        assert_eq!(trace["budgets"]["knownTokens"], Value::Null);
        assert_eq!(trace["budgets"]["maxOutputTokens"], Value::Null);
    }
    assert_ne!(expected_hash, boundary.effective_hash(false).unwrap());
    boundary.drain().await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn default_profile_stops_at_64k_before_request_budget_and_rejects_overshoot() {
    for tokens in [64000, 65000] {
        let (root, boundary) = fixture(
            json!({"ok":true,"response":response(Usage::new().total_tokens(tokens))}),
            None,
        );
        assert!(!boundary.unlimited_tokens());
        assert_eq!(boundary.spec.max_output_tokens, Some(4096));
        let first = boundary.model.call(CompletionRequest::new("test")).await;
        assert_eq!(first.is_ok(), tokens == 64000);
        assert!(
            boundary
                .model
                .call(CompletionRequest::new("test"))
                .await
                .is_err()
        );
        assert_eq!(boundary.traces().len(), 1);
        let job: Value =
            serde_json::from_slice(&fs::read(root.path().join("observed.json")).unwrap()).unwrap();
        assert_eq!(job["unlimitedTokens"], false);
    }
}

#[cfg(unix)]
#[test]
fn omitted_profile_defaults_to_limited_and_changes_effective_identity_when_enabled() {
    let (root, default) = fixture(json!({"ok":false}), None);
    let path = root.path().join("native.json");
    let mut config: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    config.as_object_mut().unwrap().remove("unlimitedTokens");
    let omitted: NativeConfig = serde_json::from_value(config.clone()).unwrap();
    assert!(!omitted.unlimited_tokens);
    config.as_object_mut().unwrap().remove("unlimitedTime");
    config.as_object_mut().unwrap().remove("reasoningEffort");
    let omitted: NativeConfig = serde_json::from_value(config.clone()).unwrap();
    assert!(!omitted.unlimited_time);
    assert_eq!(omitted.reasoning_effort, ReasoningEffort::Low);
    assert_eq!(omitted.request_timeout(), Some(Duration::from_secs(600)));
    assert_eq!(default.wall_timeout(), Some(Duration::from_secs(300)));
    config["unlimitedTokens"] = json!(true);
    fs::write(&path, serde_json::to_vec(&config).unwrap()).unwrap();
    let unlimited = build(
        &path,
        &root.path().join("jobs"),
        "classic",
        "run",
        "sourcehash",
    )
    .unwrap();
    assert_ne!(
        default.effective_hash(false).unwrap(),
        unlimited.effective_hash(false).unwrap()
    );
    assert_eq!(default.budgets()["knownTokens"], 64000);
    assert_eq!(default.budgets()["maxOutputTokens"], 4096);
    assert_eq!(default.budgets()["profile"], "default");
    for key in [
        "modelRequests",
        "toolCallsPerAgent",
        "repairRounds",
        "wallMs",
        "reasoning",
        "toolConcurrency",
    ] {
        assert_eq!(default.budgets()[key], unlimited.budgets()[key]);
    }
}

#[cfg(unix)]
#[tokio::test]
async fn failed_generated_review_retains_finished_diagnostic_draft_and_discovered_mapping() {
    for route in ["classic", "ecs"] {
        let call = |id: &str, name: &str, args| {
            AssistantContent::ToolCall(ToolCall::from_wire(
                id,
                ToolFunction::new(ToolName::new(name).unwrap(), args),
            ))
        };
        let mut reply = response(Usage::new().total_tokens(65000));
        reply.choice = vec![
            call(
                "discover",
                "propose_characters",
                json!({"operationId":"discover","expectedRevision":0,"characters":[{"ref":"new:test","name":"测试人物","evidence":["p0"]}]}),
            ),
            call(
                "patch",
                "patch_annotations",
                json!({"operationId":"whole","expectedRevision":1,
                "segments":[{"from":"p0","to":"p0","kind":"narration","speaker":"narrator","evidence":["p0"],"reason":"受控依据"}]}),
            ),
            call("finish", "finish_analysis", json!({"expectedRevision":2})),
        ];
        let wire_facts = if route == "classic" {
            json!({"request":{"reasoningEffort":"low","toolsCount":5},"response":{"reasoningContentPresent":true,"reasoningContentChars":12,"reasoningTokens":0}})
        } else {
            Value::Null
        };
        let (root, boundary) = fixture_profile(
            json!({"ok":true,"response":reply,"wireFacts":wire_facts}),
            None,
            true,
        );
        if route == "ecs" {
            let path = root.path().join("native.json");
            let mut config: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            config["unlimitedTime"] = json!(true);
            fs::write(path, serde_json::to_vec(&config).unwrap()).unwrap();
        }
        let marker = root.path().join("called");
        let script = format!(
            "if [ -e '{}' ]; then\nexit 1\nfi\ntouch '{}'\ncp '{}' \"${{CASTGLEAN_EXPERIMENT_JOB%.json}}.result.json\"\n",
            marker.display(),
            marker.display(),
            root.path().join("reply.json").display()
        );
        // Rebuild the boundary after changing the controlled executable identity.
        fs::write(root.path().join("helper"), format!("#!/bin/sh\n{script}")).unwrap();
        drop(boundary);
        let text = "风起。";
        let case = serde_json::from_value(
            json!({"version":1,"caseId":"diagnostic","evaluationTask":"analysis",
            "source":{"text":text,"sha256":hash(text.as_bytes())},"characters":[]}),
        )
        .unwrap();
        let result = super::super::evaluate(case, &root.path().join("native.json"), route, true)
            .await
            .unwrap();
        assert_eq!(result["status"], "failed", "{route}: {result}");
        assert_eq!(result["segments"], json!([]));
        assert_eq!(
            result["diagnosticDraft"]["finished"], true,
            "{route}: {result}"
        );
        assert_eq!(
            result["diagnosticDraft"]["segments"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let requests: Vec<_> = result["trace"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|span| span["isRequest"] == true)
            .collect();
        assert!(
            requests
                .iter()
                .all(|span| span["metadata"]["maxOutputTokens"] == Value::Null)
        );
        let expected_prompt_hash = hash(super::super::prompt(route == "ecs").as_bytes());
        assert_eq!(
            result["experimentIdentity"]["promptHash"],
            expected_prompt_hash
        );
        assert_eq!(requests[0]["metadata"]["promptHash"], expected_prompt_hash);
        assert_eq!(
            requests[0]["metadata"]["actualSystemHash"],
            expected_prompt_hash
        );
        assert_eq!(requests[0]["metadata"]["wireFacts"], wire_facts);
        assert_eq!(requests[0]["metadata"]["reasoningEffort"], "low");
        assert_eq!(requests[1]["metadata"]["wireFacts"], Value::Null);
        assert_eq!(requests[1]["metadata"]["finishReason"], Value::Null);
        let characters = result["diagnosticDraft"]["characters"].as_array().unwrap();
        assert_eq!(characters.len(), 1);
        assert_eq!(characters[0]["name"], "测试人物");
        assert!(
            characters[0]["id"]
                .as_str()
                .unwrap()
                .starts_with("candidate:")
        );
        assert_eq!(
            result["trace"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|t| t["isRequest"] == true)
                .count(),
            2
        );
        assert_eq!(
            result["experimentIdentity"]["budgets"]["profile"],
            if route == "ecs" {
                "unlimited-tokens-and-time"
            } else {
                "unlimited-tokens"
            }
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn relay_trace_records_actual_cap_and_reported_finish_reason_without_inferring_one() {
    use rig_core::completion::FinishReason;
    for unlimited in [false, true] {
        for reason in [None, Some(FinishReason::Length), Some(FinishReason::Stop)] {
            let expected = reason.as_ref().map(|reason| format!("{reason:?}"));
            let reply =
                response(Usage::new().output_tokens(4096)).with_optional_finish_reason(reason);
            let (_root, boundary) =
                fixture_profile(json!({"ok":true,"response":reply}), None, unlimited);
            boundary
                .model
                .call(CompletionRequest::new("private body").max_tokens(9999))
                .await
                .unwrap();
            let traces = boundary.traces();
            assert_eq!(
                traces[0]["maxOutputTokens"],
                json!((!unlimited).then_some(4096))
            );
            assert_eq!(traces[0]["finishReason"], json!(expected));
            assert!(
                !serde_json::to_string(&traces)
                    .unwrap()
                    .contains("private body")
            );
        }
    }
}

#[cfg(unix)]
#[tokio::test]
async fn time_and_reasoning_profiles_reach_both_runtimes_and_frozen_jobs() {
    use std::collections::BTreeSet;
    let mut identities = BTreeSet::new();
    for unlimited_tokens in [false, true] {
        for unlimited_time in [false, true] {
            for reasoning in [ReasoningEffort::Low, ReasoningEffort::ProviderDefault] {
                let mut route_identities = Vec::new();
                for route in ["classic", "ecs"] {
                    let call = |id: &str, name: &str, args| {
                        AssistantContent::ToolCall(ToolCall::from_wire(
                            id,
                            ToolFunction::new(ToolName::new(name).unwrap(), args),
                        ))
                    };
                    let mut reply = response(Usage::new());
                    reply.choice = vec![
                        call(
                            "patch",
                            "patch_annotations",
                            json!({"operationId":"whole","expectedRevision":0,
                            "segments":[{"from":"p0","to":"p0","kind":"narration","speaker":"narrator","evidence":["p0"],"reason":"受控依据"}]}),
                        ),
                        call("finish", "finish_analysis", json!({"expectedRevision":1})),
                    ];
                    let wire_facts = json!({"request":{"reasoningEffort":reasoning.as_str(),"maxTokens":(!unlimited_tokens).then_some(4096),"thinkingType":null,"stream":false,"toolsCount":5,"messagesCount":2,"historyReasoningMessages":0},
                        "response":{"reasoningContentPresent":true,"reasoningContentChars":12,"reasoningTokens":0,"finishReason":"tool_calls"}});
                    let (root, boundary) = fixture_options(
                        json!({"ok":true,"response":reply,"wireFacts":wire_facts}),
                        None,
                        unlimited_tokens,
                        unlimited_time,
                        reasoning,
                    );
                    assert_eq!(boundary.unlimited_time(), unlimited_time);
                    assert_eq!(
                        boundary.wall_timeout(),
                        (!unlimited_time).then_some(Duration::from_secs(300))
                    );
                    assert_eq!(
                        boundary.native.config.request_timeout(),
                        (!unlimited_time).then_some(Duration::from_secs(600))
                    );
                    let budgets = boundary.budgets();
                    assert_eq!(
                        budgets["wallMs"],
                        json!((!unlimited_time).then_some(300000))
                    );
                    assert_eq!(
                        budgets["requestTimeoutMs"],
                        json!((!unlimited_time).then_some(600000))
                    );
                    assert_eq!(budgets["reasoning"], reasoning.as_str());
                    assert_eq!(budgets["modelRequests"], 16);
                    assert_eq!(budgets["toolCallsPerAgent"], 32);
                    assert_eq!(budgets["repairRounds"], 3);
                    assert_eq!(
                        budgets["knownTokens"],
                        json!((!unlimited_tokens).then_some(64000))
                    );
                    let config = &boundary.native.config;
                    let expected_binding = hash(
                        &serde_json::to_vec(&json!({
                            "configuration":{"selection":config.selection,"revision":1},
                            "capacity":[128000,8192],"model":"test","reasoning":reasoning.as_str()
                        }))
                        .unwrap(),
                    );
                    assert_eq!(boundary.configuration_hash, expected_binding);
                    route_identities.push(boundary.effective_hash(false).unwrap());
                    let text = "风起。";
                    let case = serde_json::from_value(
                        json!({"version":1,"caseId":"profiles","evaluationTask":"analysis",
                        "source":{"text":text,"sha256":hash(text.as_bytes())},"characters":[]}),
                    )
                    .unwrap();
                    let draft = Arc::new(Mutex::new(
                        super::super::tools::Draft::new(case, false).unwrap(),
                    ));
                    let input = draft.lock().unwrap().input().to_string();
                    super::super::run_runtime(
                        route,
                        &boundary,
                        draft.clone(),
                        &super::super::prompt(unlimited_time),
                        input,
                    )
                    .await
                    .unwrap();
                    boundary.drain().await.unwrap();
                    assert!(draft.lock().unwrap().finished());
                    assert_eq!(boundary.traces().len(), 1);
                    let job: Value = serde_json::from_slice(
                        &fs::read(root.path().join("observed.json")).unwrap(),
                    )
                    .unwrap();
                    assert_eq!(job["unlimitedTime"], unlimited_time);
                    assert_eq!(job["unlimitedTokens"], unlimited_tokens);
                    assert_eq!(job["reasoningEffort"], reasoning.as_str());
                    let carried: CompletionRequest =
                        serde_json::from_value(job["request"].clone()).unwrap();
                    let actual_prompt = super::super::prompt(unlimited_time);
                    assert_eq!(carried.system_instructions(), Some(actual_prompt.as_str()));
                    assert_eq!(actual_prompt.contains("300秒"), !unlimited_time);
                    assert_eq!(actual_prompt.contains("不设执行期限"), unlimited_time);
                    assert_eq!(carried.options.reasoning, reasoning.request_reasoning());
                    assert_eq!(carried.max_tokens, (!unlimited_tokens).then_some(4096));
                    let trace = &boundary.traces()[0];
                    assert_eq!(trace["promptHash"], hash(actual_prompt.as_bytes()));
                    assert_eq!(trace["actualSystemHash"], trace["promptHash"]);
                    assert_eq!(trace["wireFacts"], wire_facts);
                    assert_eq!(trace["reasoningEffort"], reasoning.as_str());
                    assert_eq!(trace["budgets"], budgets);
                    assert_eq!(
                        trace["configurationHash"],
                        route_identities.last().unwrap().as_str()
                    );
                }
                assert_eq!(route_identities[0], route_identities[1]);
                assert!(
                    identities.insert(route_identities.remove(0)),
                    "each profile must have a distinct identity"
                );
            }
        }
    }
    assert_eq!(identities.len(), 8);
}

#[cfg(unix)]
#[test]
fn invalid_time_or_reasoning_profiles_are_rejected() {
    let (root, _) = fixture(json!({"ok":false}), None);
    let original: Value =
        serde_json::from_slice(&fs::read(root.path().join("native.json")).unwrap()).unwrap();
    for (key, value) in [
        ("reasoningEffort", json!("disabled")),
        ("reasoningEffort", json!("high")),
        ("unlimitedTime", json!("true")),
    ] {
        let mut config = original.clone();
        config[key] = value;
        assert!(serde_json::from_value::<NativeConfig>(config).is_err());
    }
    let mut config = original;
    config["reasoningEffort"] = json!("provider-default");
    assert_eq!(
        serde_json::from_value::<NativeConfig>(config)
            .unwrap()
            .reasoning_effort
            .as_str(),
        "default"
    );
}
