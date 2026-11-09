//! Plan C comparison: both real runtimes share model, draft tools and stopping rules.
mod classic;
mod ecs;
mod model;
mod tools;

use crate::contract::{Case, hash};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::{
    io::{self, BufRead},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub(crate) fn main(args: &[String]) -> Result<()> {
    let arg = |key: &str| {
        args.iter()
            .position(|s| s == key)
            .and_then(|i| args.get(i + 1))
    };
    let route = arg("--plan-c-route").ok_or_else(|| anyhow::anyhow!("plan_c_route"))?;
    ensure!(["classic", "ecs"].contains(&route.as_str()), "plan_c_route");
    let config =
        PathBuf::from(arg("--live-config").ok_or_else(|| anyhow::anyhow!("plan_c_live_config"))?);
    let mut line = String::new();
    io::stdin().lock().read_line(&mut line)?;
    let value: Value = serde_json::from_str(&line)?;
    ensure!(
        value.get("gold").is_none() && value.get("reviewGold").is_none(),
        "gold_forbidden"
    );
    let case: Case = serde_json::from_value(value)?;
    let discover = args.iter().any(|s| s == "--discover-characters");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(3)
        .enable_all()
        .build()?;
    let result = runtime.block_on(evaluate(case, &config, route, discover))?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
fn identity_scope(discover: bool) -> &'static str {
    if discover { "discovery" } else { "known-only" }
}
fn budgets(
    unlimited_tokens: bool,
    unlimited_time: bool,
    reasoning: model::ReasoningEffort,
) -> Value {
    let profile = match (unlimited_tokens, unlimited_time) {
        (false, false) => "default",
        (true, false) => "unlimited-tokens",
        (false, true) => "unlimited-time",
        (true, true) => "unlimited-tokens-and-time",
    };
    json!({"profile":profile,"modelRequests":16,"toolCallsPerAgent":32,"repairRounds":3,
        "wallMs":(!unlimited_time).then_some(300000),"requestTimeoutMs":(!unlimited_time).then_some(600000),
        "knownTokens":(!unlimited_tokens).then_some(64000),"maxOutputTokens":(!unlimited_tokens).then_some(4096),
        "reasoning":reasoning.as_str(),"toolConcurrency":1})
}
fn prompt(unlimited_time: bool) -> String {
    if unlimited_time {
        tools::PROMPT.replace("、300秒", "，不设执行期限")
    } else {
        tools::PROMPT.to_owned()
    }
}
async fn with_timeout<F: std::future::Future>(
    limit: Option<Duration>,
    work: F,
) -> std::result::Result<F::Output, tokio::time::error::Elapsed> {
    match limit {
        Some(limit) => tokio::time::timeout(limit, work).await,
        None => Ok(work.await),
    }
}
async fn evaluate(
    case: Case,
    config: &std::path::Path,
    route: &str,
    discover: bool,
) -> Result<Value> {
    let run_id = uuid::Uuid::new_v4().to_string();
    let root_id = format!("workflow:{run_id}");
    let began = tools::timestamp();
    let start = Instant::now();
    let source_hash = case.source.sha256.clone();
    let case_id = case.case_id.clone();
    let task = case.evaluation_task.clone();
    let character_context_hash = hash(
        serde_json::to_value(&case.characters)?
            .to_string()
            .as_bytes(),
    );
    let draft = Arc::new(Mutex::new(tools::Draft::new(case, discover)?));
    let jobs = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/plan-c/jobs")
        .join(&run_id);
    let boundary = model::build(config, &jobs, route, &run_id, &source_hash)?;
    let audit_path = std::env::var_os("CASTGLEAN_TOOL_AUDIT")
        .map(PathBuf::from)
        .unwrap_or_else(|| jobs.join("tool-audit.jsonl"));
    draft
        .lock()
        .map_err(|_| anyhow::anyhow!("draft_lock"))?
        .set_audit_path(&audit_path)?;
    let prompt = prompt(boundary.unlimited_time());
    let prompt_hash = hash(prompt.as_bytes());
    let tool_hash = hash(&serde_json::to_vec(&tools::definitions())?);
    boundary.set_hashes(&prompt_hash, &tool_hash, discover)?;
    let effective_hash = boundary.effective_hash(discover)?;
    let input = draft
        .lock()
        .map_err(|_| anyhow::anyhow!("draft_lock"))?
        .input()
        .to_string();
    let input_hash = hash(input.as_bytes());
    let mut generated_review = None;
    let mut review_start = usize::MAX;
    let work = async {
        run_runtime(route, &boundary, draft.clone(), &prompt, input).await?;
        if task != "review" {
            let review_case = {
                let state = draft.lock().map_err(|_| anyhow::anyhow!("draft_lock"))?;
                let mut case = state.case.clone();
                case.evaluation_task = "review".into();
                case.review_input = Some(crate::contract::Analysis {
                    segments: state.segments(),
                });
                case
            };
            let reviewer = Arc::new(Mutex::new(tools::Draft::new(review_case, false)?));
            reviewer
                .lock()
                .map_err(|_| anyhow::anyhow!("draft_lock"))?
                .set_audit_path(&audit_path)?;
            let input = reviewer
                .lock()
                .map_err(|_| anyhow::anyhow!("draft_lock"))?
                .input()
                .to_string();
            review_start = boundary.traces().len();
            generated_review = Some(reviewer.clone());
            run_runtime(route, &boundary, reviewer, &prompt, input).await?;
        }
        Ok::<_, anyhow::Error>(())
    };
    let outcome = with_timeout(boundary.wall_timeout(), work).await;
    let (runtime_ok, error) = match outcome {
        Ok(Ok(())) => (true, Value::Null),
        Ok(Err(_)) => (false, json!("agent_failed_or_unfinished")),
        Err(_) => (false, json!("deadline_exceeded")),
    };
    let reaped = boundary.drain().await.is_ok();
    let state = draft.lock().map_err(|_| anyhow::anyhow!("draft_lock"))?;
    let success = runtime_ok && reaped && state.finished();
    let mut spans = vec![
        json!({"runId":run_id,"spanId":root_id,"parentSpanId":null,"stage":"workflow","route":route,"attempt":1,"status":if success{"completed"}else{"failed"},"startedAt":began,"elapsedMs":start.elapsed().as_secs_f64()*1000.0,"isRequest":false}),
    ];
    for (i, raw) in boundary.traces().into_iter().enumerate() {
        let usage = &raw["usage"];
        spans.push(json!({"runId":run_id,"spanId":format!("model:{i}"),"requestId":format!("model:{i}"),"parentSpanId":root_id,"stage":if task=="review" || i>=review_start {"review"}else{"analysis"},"route":route,"attempt":1,"status":if raw["status"]=="completed"{"completed"}else{"failed"},"startedAt":raw.get("startedAt").cloned().unwrap_or_else(||json!(began)),"elapsedMs":raw["elapsedMs"],"isRequest":true,
            "metadata":{"reasoningEffort":raw["reasoningEffort"],"wireFacts":raw["wireFacts"],"maxOutputTokens":raw["maxOutputTokens"],"finishReason":raw["finishReason"],"budgets":boundary.budgets(),"identityScope":identity_scope(discover),"model":boundary.model_id,"configurationHash":effective_hash,"promptVersion":"chapter-tool-agent-c2-batch-feedback","promptHash":prompt_hash,"protocolVersion":"chapter-tools-c3-batch-feedback","sourceHash":source_hash,"codeRevision":option_env!("CASTGLEAN_CODE_REVISION").unwrap_or("unknown"),"toolsHash":tool_hash,"offeredToolsHash":raw["offeredToolsHash"],"offeredToolCount":raw["offeredToolCount"],"actualSystemHash":raw["actualSystemHash"]},
            "usage":{"inputTokens":usage.get("input_tokens").or_else(||usage.get("inputTokens")),"outputTokens":usage.get("output_tokens").or_else(||usage.get("outputTokens")),"cachedInputTokens":usage.get("cached_input_tokens").or_else(||usage.get("cachedInputTokens")),"reasoningTokens":usage.get("reasoning_tokens").or_else(||usage.get("reasoningTokens"))}}));
    }
    let reviewer = generated_review
        .as_ref()
        .map(|d| d.lock().map_err(|_| anyhow::anyhow!("draft_lock")))
        .transpose()?;
    let tool_audit = state
        .logs
        .iter()
        .chain(reviewer.as_ref().into_iter().flat_map(|d| d.logs.iter()))
        .cloned()
        .collect::<Vec<_>>();
    for (i, raw) in tool_audit.iter().enumerate() {
        spans.push(json!({"runId":run_id,"spanId":format!("tool:{i}"),"parentSpanId":root_id,"stage":"tool","route":route,"attempt":1,"status":if raw["status"]=="rejected"{"failed"}else{"completed"},"startedAt":raw["startedAt"],"elapsedMs":raw["elapsedMs"],"isRequest":false,"toolName":raw["tool"],"revisionBefore":raw["revisionBefore"],"revisionAfter":raw["revisionAfter"],"errorCode":raw["error"]}));
    }
    let review = reviewer
        .as_ref()
        .map_or_else(|| state.review(), |d| d.review());
    let runtime_observations = state
        .runtime_observations
        .iter()
        .chain(
            reviewer
                .as_ref()
                .into_iter()
                .flat_map(|d| d.runtime_observations.iter()),
        )
        .cloned()
        .collect::<Vec<_>>();
    // Actual local stage, rather than inferring semantic correctness from tool success.
    spans.push(json!({"runId":run_id,"spanId":"validation","parentSpanId":root_id,"stage":"validation","route":route,"attempt":1,"status":if success{"completed"}else{"failed"},"startedAt":tools::timestamp(),"elapsedMs":0,"isRequest":false}));
    Ok(
        json!({"version":1,"caseId":case_id,"route":route,"mode":if boundary.controlled(){"mock"}else{"live"},"status":if success{"completed"}else{"failed"},"error":error,"segments":if success{json!(state.segments())}else{json!([])},"review":if success{review}else{json!({"status":"failed","issues":[]})},"trace":spans,
        "diagnosticDraft":{"finished":state.finished(),"characters":state.case.characters,"segments":state.segments()},
        "observedUsage":boundary.usage(),"toolAudit":tool_audit,"runtimeObservations":runtime_observations,"repairRounds":state.repair_rounds,"firstValidationPassed":state.first_check_valid,"helpersReaped":reaped,
        "experimentIdentity":{"characterContextHash":character_context_hash,"inputHash":input_hash,"promptHash":prompt_hash,"toolsHash":tool_hash,"budgets":boundary.budgets(),"configurationHash":effective_hash,"identityDiscoveryEvaluated":false,"humanConfirmed":false}}),
    )
}

async fn run_runtime(
    route: &str,
    boundary: &model::Boundary,
    draft: tools::SharedDraft,
    prompt: &str,
    input: String,
) -> Result<()> {
    match route {
        "classic" => {
            classic::run(
                boundary.model.clone(),
                boundary.spec.clone(),
                draft,
                prompt,
                input,
                16,
            )
            .await
        }
        _ => {
            ecs::run(
                boundary.model.clone(),
                boundary.spec.clone(),
                draft,
                prompt,
                input,
                16,
            )
            .await
        }
    }
}

#[cfg(test)]
#[path = "plan_c/tests.rs"]
mod tests;
