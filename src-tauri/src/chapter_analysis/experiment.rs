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
        "evaluate" => {
            crate::llm::test_support::PUBLIC_ACCEPTANCE
                .scope(
                    input["captureResponses"] == true,
                    super::evaluation::evaluate(&input),
                )
                .await
        }
        _ => panic!("unknown experiment operation"),
    };
    std::fs::write(
        Path::new(&job).with_extension("result.json"),
        serde_json::to_vec(&output).unwrap(),
    )
    .unwrap();
}
