use super::*;
use rig_core::{
    catalog::ModelSpec,
    providers::registry::ProviderId,
    test_utils::{MockCompletionModel, MockStreamEvent, MockTurn},
};

#[tokio::test]
async fn both_real_runtimes_receive_feedback_and_repair_the_identical_shared_draft() {
    let mut outputs = Vec::new();
    for (route, unlimited) in [
        ("classic", false),
        ("ecs", false),
        ("classic", true),
        ("ecs", true),
    ] {
        let text = "风起。雨落。";
        let case:Case=serde_json::from_value(json!({"version":1,"caseId":"paired-controlled","evaluationTask":"analysis","source":{"text":text,"sha256":hash(text.as_bytes())},"characters":[]})).unwrap();
        let draft = Arc::new(Mutex::new(tools::Draft::new(case, false).unwrap()));
        let input = draft.lock().unwrap().input().to_string();
        let patch = |id: &str, revision: u64, op: &str| json!({"operationId":op,"expectedRevision":revision,"segments":[{"pieces":[id],"kind":"narration","speaker":"narrator","evidence":[id],"reason":"受控测试依据"}]});
        let calls = [
            ("first", "patch_annotations", patch("p0", 0, "first")),
            ("check", "check_draft", json!({})),
            ("repair", "patch_annotations", patch("p1", 1, "repair")),
            ("finish", "finish_analysis", json!({"expectedRevision":2})),
        ];
        let model = if route == "classic" {
            MockCompletionModel::from_turns(
                calls
                    .into_iter()
                    .map(|(id, name, args)| MockTurn::tool_call(id, name, args)),
            )
        } else {
            MockCompletionModel::from_stream_turns(calls.into_iter().map(|(id, name, args)| {
                vec![
                    MockStreamEvent::tool_call(id, name, args),
                    MockStreamEvent::final_response(rig_core::completion::Usage::new()),
                ]
            }))
        };
        let mut spec =
            ModelSpec::new(ProviderId::declare("openai").unwrap(), "controlled").with_tools(true);
        spec.max_output_tokens = (!unlimited).then_some(4096);
        let spec = Arc::new(spec);
        tokio::time::timeout(Duration::from_secs(5), async {
            if route == "classic" {
                classic::run(
                    model.clone().erase(),
                    spec,
                    draft.clone(),
                    tools::PROMPT,
                    input,
                    4,
                )
                .await
            } else {
                ecs::run(
                    model.clone().erase(),
                    spec,
                    draft.clone(),
                    tools::PROMPT,
                    input,
                    4,
                )
                .await
            }
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(model.request_count(), 4, "{route}");
        let sent = model.requests();
        for request in &sent {
            assert_eq!(
                request.max_tokens,
                (!unlimited && route == "classic").then_some(4096),
                "{route}, unlimited={unlimited}"
            );
        }
        let feedback = serde_json::to_string(&sent[2]).unwrap();
        assert!(
            feedback.contains("missingIds") && feedback.contains("p1"),
            "{route}"
        );
        let state = draft.lock().unwrap();
        assert!(state.finished());
        assert_eq!(state.repair_rounds, 1);
        assert_eq!(state.first_check_valid, Some(false));
        outputs.push(serde_json::to_value(state.segments()).unwrap());
    }
    assert!(outputs.iter().all(|output| output == &outputs[0]));
}

#[tokio::test]
async fn optional_timeout_none_has_no_deadline_and_some_still_times_out() {
    let unlimited = with_timeout(None, std::future::pending::<()>());
    tokio::pin!(unlimited);
    assert!(futures::poll!(&mut unlimited).is_pending());
    assert_eq!(with_timeout(None, async { 42 }).await.unwrap(), 42);
    assert!(
        with_timeout(Some(Duration::ZERO), std::future::pending::<()>())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn both_runtimes_stop_requesting_when_tool_or_repair_budget_is_exhausted() {
    for (route, prefill) in [
        ("classic", false),
        ("ecs", false),
        ("classic", true),
        ("ecs", true),
    ] {
        let text = "风起。";
        let case: Case = serde_json::from_value(json!({"version":1,"caseId":"terminal-budget","evaluationTask":"analysis","source":{"text":text,"sha256":hash(text.as_bytes())},"characters":[]})).unwrap();
        let draft = Arc::new(Mutex::new(tools::Draft::new(case, false).unwrap()));
        if prefill {
            for _ in 0..31 {
                assert_eq!(
                    draft
                        .lock()
                        .unwrap()
                        .call("read_source", json!({"from":"p0","to":"p0"}))["ok"],
                    true
                );
            }
        }
        let input = draft.lock().unwrap().input().to_string();
        let args = json!({"expectedRevision":0});
        let model =
            if route == "classic" {
                MockCompletionModel::from_turns((0..4).map(|i| {
                    MockTurn::tool_call(format!("fail-{i}"), "finish_analysis", args.clone())
                }))
            } else {
                MockCompletionModel::from_stream_turns((0..4).map(|i| {
                    vec![
                        MockStreamEvent::tool_call(
                            format!("fail-{i}"),
                            "finish_analysis",
                            args.clone(),
                        ),
                        MockStreamEvent::final_response(rig_core::completion::Usage::new()),
                    ]
                }))
            };
        let spec = Arc::new(
            ModelSpec::new(ProviderId::declare("openai").unwrap(), "controlled").with_tools(true),
        );
        let outcome = tokio::time::timeout(Duration::from_secs(5), async {
            if route == "classic" {
                classic::run(
                    model.clone().erase(),
                    spec,
                    draft.clone(),
                    tools::PROMPT,
                    input,
                    4,
                )
                .await
            } else {
                ecs::run(
                    model.clone().erase(),
                    spec,
                    draft.clone(),
                    tools::PROMPT,
                    input,
                    4,
                )
                .await
            }
        })
        .await
        .unwrap();
        assert!(outcome.is_err(), "{route}");
        assert_eq!(
            model.request_count(),
            if prefill { 1 } else { 3 },
            "{route}"
        );
        let state = draft.lock().unwrap();
        assert!(state.terminal());
        assert!(!state.finished());
        assert_eq!(state.repair_rounds, if prefill { 1 } else { 3 });
    }
}

#[tokio::test]
async fn compact_partition_finishes_both_runtimes_in_one_model_request() {
    for route in ["classic", "ecs"] {
        let text = "风起。她说。";
        let case=serde_json::from_value(json!({"version":1,"caseId":"compact-runtime","evaluationTask":"analysis","source":{"text":text,"sha256":hash(text.as_bytes())},"characters":[]})).unwrap();
        let mut d = tools::Draft::new(case, true).unwrap();
        d.enable_compact().unwrap();
        let input = d.input().to_string();
        let draft = Arc::new(Mutex::new(d));
        let args = json!({"operationId":"all","expectedRevision":0,"characters":[{"ref":"new:a","name":"她","evidence":["p1"]}],"runs":[{"end":0,"kind":"n","speaker":"narrator"},{"end":1,"kind":"s","speaker":"new:a"}]});
        let model = if route == "classic" {
            MockCompletionModel::from_turns([MockTurn::tool_call("full", "finish_analysis", args)])
        } else {
            MockCompletionModel::from_stream_turns([vec![
                MockStreamEvent::tool_call("full", "finish_analysis", args),
                MockStreamEvent::final_response(rig_core::completion::Usage::new()),
            ]])
        };
        let spec = Arc::new(
            ModelSpec::new(ProviderId::declare("openai").unwrap(), "controlled").with_tools(true),
        );
        tokio::time::timeout(Duration::from_secs(5), async {
            if route == "classic" {
                classic::run(
                    model.clone().erase(),
                    spec,
                    draft.clone(),
                    tools::compact_prompt(),
                    input,
                    4,
                )
                .await
            } else {
                ecs::run(
                    model.clone().erase(),
                    spec,
                    draft.clone(),
                    tools::compact_prompt(),
                    input,
                    4,
                )
                .await
            }
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(model.request_count(), 1);
        assert_eq!(draft.lock().unwrap().logs.len(), 1);
        assert!(draft.lock().unwrap().finished());
    }
}
