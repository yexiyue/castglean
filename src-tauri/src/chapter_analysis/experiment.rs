//! Opt-in experiment bridge for explicitly authorized text. Never publishes annotations.
use super::{protocol, types::*, windows};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

fn binding(text: &str) -> SourceBinding {
    SourceBinding {
        project_id: "public-experiment".into(),
        chapter_id: "public-chapter".into(),
        source_id: "public-source".into(),
        sha256: crate::project::hash(text.as_bytes()),
        start: 0,
        end: text.len() as u32,
    }
}

fn prepare(input: &Value) -> Value {
    let text = input["text"].as_str().unwrap();
    let schema = schemars::schema_for!(protocol::ModelOutput);
    let context =
        serde_json::to_string(&(Vec::<Value>::new(), Vec::<Value>::new(), &schema)).unwrap();
    let capacity = input["capacity"].as_u64().map(|n| n as u32);
    let plans = windows::plan(text, &binding(text), capacity, None, context.len()).unwrap();
    let source = include_str!("execution.rs");
    let preamble = source
        .split(".preamble(\"")
        .nth(1)
        .unwrap()
        .split("\")")
        .next()
        .unwrap();
    json!({"schema":schema,"preamble":preamble,"plans":plans,
        "payloads":plans.iter().map(|p|protocol::window_payload(p).unwrap()).collect::<Vec<_>>()})
}

fn validate(input: &Value) -> Value {
    let text = input["text"].as_str().unwrap();
    let binding = binding(text);
    let mut local = BTreeMap::new();
    let mut segments = Vec::new();
    for item in input["candidates"].as_array().unwrap() {
        let plan: windows::Window = serde_json::from_value(item["plan"].clone()).unwrap();
        let raw = match serde_json::from_value::<protocol::ModelOutput>(item["output"].clone()) {
            Ok(raw) => raw,
            Err(_) => return json!({"valid":false,"error":"strict_json"}),
        };
        match protocol::convert(raw, &plan, &binding, &[], &mut local) {
            Ok(next) => segments.extend(next),
            Err(error) => return json!({"valid":false,"error":error.to_string()}),
        }
    }
    let names: BTreeMap<_, _> = local.values().map(|c| (&c.id, &c.display_name)).collect();
    let normalized: Vec<_> = segments
        .iter()
        .map(|s| {
            let speaker = match &s.attribution {
                Attribution::Narrator => "narrator".into(),
                Attribution::Unknown => "unknown".into(),
                Attribution::Resolved { character_id } => names[character_id].clone(),
                Attribution::Ambiguous { .. } => "ambiguous".into(),
            };
            json!({"start":s.range.start,"end":s.range.end,"kind":s.kind,"speaker":speaker})
        })
        .collect();
    json!({"valid":true,"segments":normalized,"local":local.iter().map(|(key,c)|
        json!({"key":key,"name":c.display_name})).collect::<Vec<_>>()})
}

#[tokio::test]
#[ignore = "explicit experiment job required; call jobs use the selected native credential and authorized text"]
async fn protocol_experiment_bridge() {
    let job = std::env::var("CASTGLEAN_EXPERIMENT_JOB").expect("explicit job path");
    let input: Value = serde_json::from_slice(&std::fs::read(&job).unwrap()).unwrap();
    let output = match input["op"].as_str().unwrap() {
        "prepare" => prepare(&input),
        "validate" => validate(&input),
        "call" => crate::llm::test_support::experiment_call(&input).await,
        "production_agent" => production_agent(&input).await,
        _ => panic!("unknown experiment operation"),
    };
    std::fs::write(
        Path::new(&job).with_extension("result.json"),
        serde_json::to_vec(&output).unwrap(),
    )
    .unwrap();
}

/// No product database or project writes. Uses the shipped C7 core and native runtime.
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
