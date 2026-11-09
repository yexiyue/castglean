//! Explicit no-project-write evaluation of the production chapter attribution implementation.
use serde_json::{Value, json};

#[tokio::test]
#[ignore = "explicit authorized evaluation job and native model configuration required"]
async fn production_agent_bridge() {
    let job = std::env::var("CASTGLEAN_EXPERIMENT_JOB").expect("explicit job path");
    let input: Value = serde_json::from_slice(&std::fs::read(&job).unwrap()).unwrap();
    assert_eq!(
        input["op"], "production_agent",
        "unsupported evaluation operation"
    );
    let output = production_agent(&input).await;
    std::fs::write(
        std::path::Path::new(&job).with_extension("result.json"),
        serde_json::to_vec(&output).unwrap(),
    )
    .unwrap();
}

/// No product database or project writes. Uses the shipped chapter attribution core and native runtime.
async fn production_agent(input: &Value) -> Value {
    use super::{
        agent_core::{CoreCharacter, Draft},
        agent_runtime, execution_agent,
    };
    use std::time::Instant;
    let text = input["text"].as_str().expect("authorized source text");
    let characters: Vec<CoreCharacter> =
        serde_json::from_value(input.get("characters").cloned().unwrap_or(json!([])))
            .expect("lossless role context");
    let aliases = input.get("aliases").cloned().unwrap_or(json!([]));
    let input_hash =
        crate::project::hash(&serde_json::to_vec(&(text, &characters, &aliases)).unwrap());
    let (model, configuration, max_output) = match crate::llm::test_support::experiment_model(input)
    {
        Ok(v) => v,
        Err(e) => {
            return json!({"ok":false,"error":e,"inputHash":input_hash,"requestsUnknown":true});
        }
    };
    let draft = Draft::analysis(text, characters, aliases).unwrap();
    let token = tokio_util::sync::CancellationToken::new();
    let started = Instant::now();
    let (analysis_status, analysis_trace) = agent_runtime::run(
        model.clone(),
        draft.clone(),
        max_output,
        &token,
        None,
        "analysis",
    )
    .await;
    let mut result = json!({"formatVersion":1,"implementationHash":execution_agent::implementation_hash(),"inputHash":input_hash,"configuration":configuration,"analysisTrace":analysis_trace,"ok":false});
    if let Err(e) = analysis_status {
        result["error"] = json!(e);
        result["elapsedMs"] = json!(started.elapsed().as_millis() as u64);
        return result;
    }
    let analysis = draft.lock().unwrap().result().unwrap();
    result["analysis"] = json!(analysis);
    result["analysisToolAudit"] = json!(draft.lock().unwrap().audit());
    let review = Draft::review(text, analysis).unwrap();
    let (review_status, review_trace) =
        agent_runtime::run(model, review.clone(), max_output, &token, None, "review").await;
    result["reviewTrace"] = json!(review_trace);
    result["reviewToolAudit"] = json!(review.lock().unwrap().audit());
    match review_status {
        Ok(()) => {
            result["ok"] = json!(true);
            result["review"] = json!(review.lock().unwrap().review_result());
        }
        Err(e) => result["error"] = json!(e),
    }
    result["elapsedMs"] = json!(started.elapsed().as_millis() as u64);
    result
}
