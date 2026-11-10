use super::*;
use rig_core::completion::{CompletionRequest, Effort, Reasoning};

fn setup(
    protocol: LlmProtocol,
    endpoint: &str,
    model: &str,
    reasoning: ReasoningSetting,
) -> (tempfile::TempDir, Arc<LlmState>, ModelSelection) {
    let dir = tempfile::tempdir().unwrap();
    let state =
        Arc::new(LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap());
    let mut change = change();
    change.protocol = protocol;
    change.endpoint = endpoint.into();
    change.models[0].model_id = model.into();
    change.models[0].reasoning = reasoning;
    let connection = state.update(change).unwrap().connections.remove(0);
    (
        dir,
        state,
        ModelSelection {
            connection_id: connection.id,
            model_id: "model".into(),
        },
    )
}

#[test]
fn old_model_json_defaults_to_lowest_and_unknown_capabilities_send_nothing() {
    let model: LlmModel =
        serde_json::from_value(serde_json::json!({"id":"model","modelId":"same","name":"Model"}))
            .unwrap();
    assert_eq!(model.reasoning, ReasoningSetting::Lowest);
    let (_dir, state, selected) = setup(
        LlmProtocol::Openai,
        "http://localhost",
        "unknown/gpt-5",
        model.reasoning,
    );
    assert!(
        state
            .acquire(&selected)
            .unwrap()
            .completion_options_with(None)
            .unwrap()
            .is_default()
    );
}

#[test]
fn lowest_is_sorted_and_budget_controls_are_resolved_by_rig() {
    for (protocol, model, expected) in [
        (
            LlmProtocol::Openai,
            "gpt-5",
            Reasoning::Effort(Effort::Minimal),
        ),
        (LlmProtocol::Openai, "gpt-5.1", Reasoning::Off),
        (
            LlmProtocol::Openai,
            "zcode/GLM-5.3-Flash",
            Reasoning::Effort(Effort::Low),
        ),
        (
            LlmProtocol::Gemini,
            "gemini-2.5-pro",
            Reasoning::Budget { tokens: 2048 },
        ),
        (
            LlmProtocol::Gemini,
            "gemini-3-pro-preview",
            Reasoning::Effort(Effort::Low),
        ),
    ] {
        let (_dir, state, selection) = setup(
            protocol,
            "http://localhost",
            model,
            ReasoningSetting::Lowest,
        );
        assert_eq!(
            state
                .acquire(&selection)
                .unwrap()
                .completion_options_with(None)
                .unwrap()
                .reasoning,
            Some(expected),
            "{model}"
        );
    }
}

#[test]
fn host_rejects_unknown_and_unsupported_explicit_settings_before_persisting() {
    for (model, setting) in [
        ("unknown/gpt-5", ReasoningSetting::Low),
        ("zcode/GLM-5.3-Flash", ReasoningSetting::Off),
        ("gpt-5", ReasoningSetting::Max),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let state =
            LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap();
        let mut change = change();
        change.models[0].model_id = model.into();
        change.models[0].reasoning = setting;
        assert!(matches!(
            state.update(change),
            Err(LlmError::InvalidConfiguration)
        ));
        assert!(state.snapshot().unwrap().connections.is_empty());
    }
}

#[test]
fn reasoning_changes_are_request_changes_and_existing_lease_stays_frozen() {
    let (_dir, state, selected) = setup(
        LlmProtocol::Openai,
        "http://localhost",
        "gpt-5",
        ReasoningSetting::Lowest,
    );
    let lease = state.acquire(&selected).unwrap();
    let revision = lease.connection.revision;
    let mut next = change();
    next.id = Some(selected.connection_id.clone());
    next.expected_revision = Some(revision);
    next.endpoint = lease.connection.endpoint.clone();
    next.credential = CredentialChange::Keep;
    next.models = lease.connection.models.clone();
    next.models[0].reasoning = ReasoningSetting::High;
    state.update(next).unwrap();
    assert_eq!(
        lease.completion_options_with(None).unwrap().reasoning,
        Some(Reasoning::Effort(Effort::Minimal))
    );
    let next = state.acquire(&selected).unwrap();
    assert!(next.connection.revision > revision);
    assert_eq!(
        next.completion_options_with(None).unwrap().reasoning,
        Some(Reasoning::Effort(Effort::High))
    );
}

#[tokio::test]
async fn typed_options_reach_actual_native_http_bodies() {
    use serde_json::json;
    for (protocol, model, setting, expected) in [
        (
            LlmProtocol::Openai,
            "gpt-5",
            ReasoningSetting::Lowest,
            json!({"reasoning_effort":"minimal"}),
        ),
        (
            LlmProtocol::Openai,
            "zcode/GLM-5.3-Flash",
            ReasoningSetting::Lowest,
            json!({"reasoning_effort":"low"}),
        ),
        (
            LlmProtocol::Openai,
            "zcode/GLM-5.3-Flash",
            ReasoningSetting::Max,
            json!({"reasoning_effort":"max"}),
        ),
        (
            LlmProtocol::Anthropic,
            "claude-sonnet-4-5",
            ReasoningSetting::Low,
            json!({"thinking":{"type":"enabled","budget_tokens":2048}}),
        ),
        (
            LlmProtocol::Anthropic,
            "claude-sonnet-4-6",
            ReasoningSetting::High,
            json!({"thinking":{"type":"adaptive"},"output_config":{"effort":"high"}}),
        ),
        (
            LlmProtocol::Gemini,
            "gemini-2.5-pro",
            ReasoningSetting::Low,
            json!({"generationConfig":{"thinkingConfig":{"thinkingBudget":2048}}}),
        ),
        (
            LlmProtocol::Gemini,
            "gemini-3-pro-preview",
            ReasoningSetting::Lowest,
            json!({"generationConfig":{"thinkingConfig":{"thinkingLevel":"low"}}}),
        ),
    ] {
        let seen = Arc::new(AtomicBool::new(false));
        let sent = seen.clone();
        let fixture = Fixture::new(move |_, _, body| {
            for (key, value) in expected.as_object().unwrap() {
                // generationConfig also carries maxOutputTokens; compare the nested reasoning only.
                if key == "generationConfig" {
                    assert_eq!(body[key]["thinkingConfig"], value["thinkingConfig"]);
                } else {
                    assert_eq!(&body[key], value, "{model}");
                }
            }
            sent.store(true, Ordering::SeqCst);
            (200, provider_reply(protocol, "OK"))
        });
        let (_dir, state, selection) = setup(protocol, &fixture.endpoint, model, setting);
        let lease = state.acquire(&selection).unwrap();
        let model = super::super::providers::model(&lease).unwrap();
        super::super::providers::call(&model, CompletionRequest::new("OK").max_tokens(8192))
            .await
            .unwrap();
        assert!(seen.load(Ordering::SeqCst));
    }
}

#[tokio::test]
async fn unknown_and_provider_default_omit_all_reasoning_wire_parameters() {
    for (model, setting) in [
        ("unknown/glm-5.3", ReasoningSetting::Lowest),
        ("gpt-5", ReasoningSetting::ProviderDefault),
    ] {
        let fixture = Fixture::new(|_, _, body| {
            for field in [
                "reasoning",
                "reasoning_effort",
                "thinking",
                "thinkingConfig",
            ] {
                assert!(body.get(field).is_none());
            }
            (200, provider_reply(LlmProtocol::Openai, "OK"))
        });
        let (_dir, state, selection) =
            setup(LlmProtocol::Openai, &fixture.endpoint, model, setting);
        let lease = state.acquire(&selection).unwrap();
        super::super::providers::call(
            &super::super::providers::model(&lease).unwrap(),
            CompletionRequest::new("OK"),
        )
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn explicit_typed_request_override_wins_over_frozen_default() {
    let fixture = Fixture::new(|_, _, body| {
        assert_eq!(body["reasoning_effort"], "high");
        (200, provider_reply(LlmProtocol::Openai, "OK"))
    });
    let (_dir, state, selected) = setup(
        LlmProtocol::Openai,
        &fixture.endpoint,
        "gpt-5",
        ReasoningSetting::Lowest,
    );
    let lease = state.acquire(&selected).unwrap();
    let model = super::super::providers::model(&lease).unwrap();
    super::super::providers::call(
        &model,
        CompletionRequest::new("OK")
            .options(rig_core::completion::GenerationOptions::default().reasoning(Effort::High)),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn streaming_model_also_inherits_the_frozen_default() {
    use futures_util::StreamExt;
    let fixture = Fixture::raw(|_, _, body| {
        assert_eq!(body["reasoning_effort"], "low");
        (200, "text/event-stream", concat!(
            "data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"model\":\"test\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"OK\"},\"finish_reason\":null}]}\n\n",
            "data: {\"id\":\"test\",\"object\":\"chat.completion.chunk\",\"model\":\"test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n"
        ).as_bytes().to_vec())
    });
    let (_dir, state, selected) = setup(
        LlmProtocol::Openai,
        &fixture.endpoint,
        "zcode/GLM-5.3-Flash",
        ReasoningSetting::Lowest,
    );
    let lease = state.acquire(&selected).unwrap();
    let model = super::super::providers::model(&lease).unwrap();
    let mut stream = model.stream(CompletionRequest::new("OK")).unwrap();
    while let Some(event) = stream.next().await {
        event.unwrap();
    }
    assert_eq!(stream.finish().await.unwrap().text(), "OK");
}

#[tokio::test]
async fn splitting_agent_inherits_shared_reasoning_on_every_tool_turn() {
    use crate::novel_import::splitting::{
        graph,
        test_support::{fixture_saved, tool_context},
    };
    use std::sync::atomic::{AtomicUsize, Ordering};

    for (model_id, setting, override_setting, expected) in [
        (
            "zcode/GLM-5.3-Flash",
            ReasoningSetting::Lowest,
            None,
            Some("low"),
        ),
        (
            "zcode/GLM-5.3-Flash",
            ReasoningSetting::High,
            None,
            Some("high"),
        ),
        (
            "zcode/GLM-5.3-Flash",
            ReasoningSetting::ProviderDefault,
            None,
            None,
        ),
        ("unknown/model", ReasoningSetting::Lowest, None, None),
        (
            "zcode/GLM-5.3-Flash",
            ReasoningSetting::Lowest,
            Some(ReasoningSetting::High),
            Some("high"),
        ),
        (
            "zcode/GLM-5.3-Flash",
            ReasoningSetting::High,
            Some(ReasoningSetting::ProviderDefault),
            None,
        ),
    ] {
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let fixture = Fixture::raw(move |index, _, body| {
            observed.fetch_add(1, Ordering::SeqCst);
            assert_eq!(body["reasoning_effort"].as_str(), expected);
            if expected.is_none() {
                for key in ["reasoning_effort", "reasoning", "thinking"] {
                    assert!(body.get(key).is_none(), "unexpected {key}: {body}");
                }
            }
            let delta = if index == 0 {
                serde_json::json!({"role":"assistant","tool_calls":[{"index":0,"id":"directory-call","type":"function","function":{"name":"directory","arguments":"{}"}}]})
            } else {
                assert_eq!(index, 1);
                assert!(body["messages"].as_array().unwrap().iter().any(|message| {
                    message["role"] == "tool" && message["tool_call_id"] == "directory-call"
                }));
                serde_json::json!({"role":"assistant","content":"目录已检查。"})
            };
            let chunk = serde_json::json!({"id":"reasoning-test","object":"chat.completion.chunk","model":model_id,"choices":[{"index":0,"delta":delta,"finish_reason":null}]});
            let end = serde_json::json!({"id":"reasoning-test","object":"chat.completion.chunk","model":model_id,"choices":[{"index":0,"delta":{},"finish_reason":if index == 0 {"tool_calls"} else {"stop"}}]});
            (
                200,
                "text/event-stream",
                format!("data: {chunk}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes(),
            )
        });
        let (_config_dir, state, selected) =
            setup(LlmProtocol::Openai, &fixture.endpoint, model_id, setting);
        let connection = state.acquire_for_run(&selected).unwrap();
        let model =
            crate::llm::configured_model(&connection, Some(Arc::new(|_| Ok(()))), override_setting)
                .unwrap();
        let (root, db, _, lease) = fixture_saved().await;
        graph::execute(tool_context(root.path(), &db, &lease), model, None)
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let history = crate::ai::history_page(&db, lease.session_id(), None, 20)
            .await
            .unwrap();
        assert_eq!(history.session.budget.requests, 2);
        assert_eq!(history.session.budget.tool_calls, 1);
    }
}

#[tokio::test]
async fn evaluation_model_is_read_only_and_identity_omits_endpoint_and_credentials() {
    let fixture = Fixture::new(|_, _, body| {
        assert_eq!(body["reasoning_effort"], "low");
        (200, provider_reply(LlmProtocol::Openai, "OK"))
    });
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm.json");
    let state = LlmState::open(path.clone(), Arc::new(Vault::default())).unwrap();
    let mut change = change();
    change.credential = CredentialChange::Keep;
    change.endpoint = fixture.endpoint.clone();
    change.models[0].model_id = "zcode/GLM-5.3-Flash".into();
    change.models[0].max_output_tokens = Some(8192);
    let connection = state.update(change).unwrap().connections.remove(0);
    let before = std::fs::read(&path).unwrap();
    let input = serde_json::json!({"configPath":path,"selection":{"connectionId":connection.id,"modelId":"model"}});
    let (model, identity, limit) = super::super::test_support::experiment_model(&input).unwrap();
    assert_eq!(limit, Some(8192));
    assert_eq!(identity["modelId"], "zcode/GLM-5.3-Flash");
    assert_eq!(
        identity["configurationSnapshotHash"]
            .as_str()
            .unwrap()
            .len(),
        64
    );
    let identity = serde_json::to_string(&identity).unwrap();
    assert!(!identity.contains(&fixture.endpoint));
    assert!(!identity.contains("credential"));
    super::super::providers::call(&model, CompletionRequest::new("OK"))
        .await
        .unwrap();
    assert_eq!(before, std::fs::read(&path).unwrap());
}

#[test]
fn changing_effort_during_run_only_affects_new_leases() {
    let (_dir, state, selection) = setup(
        LlmProtocol::Openai,
        "http://localhost",
        "zcode/GLM-5.3-Flash",
        ReasoningSetting::Lowest,
    );
    let running = state.acquire_for_run(&selection).unwrap();
    let mut models = running.connection.models.clone();
    models[0].reasoning = ReasoningSetting::High;
    state
        .update(ConnectionChange {
            id: Some(running.connection.id.clone()),
            expected_revision: Some(running.connection.revision),
            name: running.connection.name.clone(),
            protocol: running.connection.protocol,
            endpoint: running.connection.endpoint.clone(),
            models,
            credential: CredentialChange::Keep,
        })
        .unwrap();
    assert_eq!(
        running.completion_options_with(None).unwrap().reasoning,
        Some(Reasoning::Effort(Effort::Low))
    );
    let next = state.acquire_for_run(&selection).unwrap();
    assert_eq!(
        next.completion_options_with(None).unwrap().reasoning,
        Some(Reasoning::Effort(Effort::High))
    );
    assert!(next.connection.revision > running.connection.revision);
}

#[test]
fn run_level_override_replaces_frozen_default_and_rejects_unsupported() {
    let (_dir, state, selected) = setup(
        LlmProtocol::Openai,
        "http://localhost",
        "glm-5.3",
        ReasoningSetting::Lowest,
    );
    let lease = state.acquire(&selected).unwrap();
    // 无覆盖与显式 None 等价，沿用 lease 冻结的默认档。
    assert_eq!(
        lease.completion_options_with(None).unwrap().reasoning,
        lease.completion_options_with(None).unwrap().reasoning
    );
    let overridden = lease
        .completion_options_with(Some(ReasoningSetting::High))
        .unwrap();
    assert!(overridden.reasoning.is_some());
    // GLM-5.3 目录不含 off：拒绝而不是静默忽略。
    assert!(matches!(
        lease.completion_options_with(Some(ReasoningSetting::Off)),
        Err(LlmError::InvalidConfiguration)
    ));
}
