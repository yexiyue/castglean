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
        let patch = |id: &str, revision: u64, op: &str| json!({"operationId":op,"expectedRevision":revision,"from":id,"to":id,"segments":[{"from":id,"to":id,"kind":"narration","speaker":"narrator","evidence":[id],"reason":"受控测试依据"}]});
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
