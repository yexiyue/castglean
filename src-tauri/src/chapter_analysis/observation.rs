//! Read-only C7 progress, review findings and redacted execution diagnostics.
use super::{input, types::*};
use crate::database::entity::analysis_window;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::Serialize;
use serde_json::{Value, json};

pub(super) async fn run(db: &impl ConnectionTrait, run_id: &str) -> Result<Value, AnalysisError> {
    let input = input::read(db, run_id)
        .await
        .map_err(|_| AnalysisError::NotFound)?;
    let origin = input.resume_input_id.as_deref().unwrap_or(run_id);
    let rows = analysis_window::Entity::find()
        .filter(analysis_window::Column::InputId.eq(origin))
        .order_by_asc(analysis_window::Column::Ordinal)
        .all(db)
        .await?;
    let mut traces = Vec::new();
    let mut identities = Vec::new();
    for row in &rows {
        if let Some(identity) = row.content.get("identity") {
            identities.push(identity.clone());
        }
        if let Some(object) = row.content.as_object() {
            for (key, value) in object {
                if key.starts_with("trace:") {
                    traces.push(value.clone());
                }
            }
        }
    }
    Ok(
        json!({"protocol":"chapter-agent-c7/1","runId":run_id,"inputId":origin,
        "configuration":input.configuration,"identities":identities,"traces":traces,
        "windowsComplete":!rows.is_empty() && rows.iter().all(|r|r.status=="completed")}),
    )
}

pub(super) async fn review(
    db: &impl ConnectionTrait,
    run_id: &str,
) -> Result<Option<Value>, AnalysisError> {
    let progress = progress(db, run_id).await?;
    if let Some(agent) = progress.agent {
        return Ok(Some(
            json!({"protocol":"chapter-agent-c7/1","chapterId":agent.chapter_id,
            "issues":agent.review_findings,"complete":agent.stage=="completed","applied":false,"humanConfirmed":false}),
        ));
    }
    Ok(None)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewFinding {
    pub range: ByteRange,
    pub kind: Option<SegmentKind>,
    pub speaker_name: Option<String>,
    pub candidate_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProgress {
    pub chapter_id: String,
    pub stage: String,
    pub requests: u32,
    pub input_tokens: Option<f64>,
    pub output_tokens: Option<f64>,
    pub elapsed_ms: f64,
    pub timing_complete: bool,
    pub review_findings: Vec<ReviewFinding>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    pub agent: Option<AgentProgress>,
    pub completed: u32,
    pub total: u32,
    pub resume: bool,
    pub analyze: bool,
}
pub(crate) async fn progress(
    db: &impl ConnectionTrait,
    run_id: &str,
) -> Result<Progress, AnalysisError> {
    let input = super::input::read(db, run_id)
        .await
        .map_err(|_| AnalysisError::NotFound)?;
    let origin = input.resume_input_id.as_deref().unwrap_or(run_id);
    let windows = crate::database::entity::analysis_window::Entity::find()
        .filter(crate::database::entity::analysis_window::Column::InputId.eq(origin))
        .filter(crate::database::entity::analysis_window::Column::Ordinal.gte(0))
        .all(db)
        .await?;
    let current_run = crate::database::entity::ai_run::Entity::find_by_id(run_id)
        .one(db)
        .await?;
    let live = current_run
        .as_ref()
        .is_some_and(|r| matches!(r.status.as_str(), "running" | "cancelling"));
    let mut agent = None;
    for window in &windows {
        if window.content["formatVersion"] != 5 {
            return Err(AnalysisError::InvalidData);
        }
        let a = agent.get_or_insert(AgentProgress {
            chapter_id: input.dependencies.source.chapter_id.clone(),
            stage: "analysis".into(),
            requests: 0,
            input_tokens: Some(0.0),
            output_tokens: Some(0.0),
            elapsed_ms: 0.0,
            timing_complete: true,
            review_findings: vec![],
        });
        if window.content["analysis"].is_object() && window.content["review"].is_null() {
            a.stage = "review".into();
        }
        if let Some(object) = window.content.as_object() {
            for (key, value) in object {
                if !key.starts_with("trace:") {
                    continue;
                }
                let trace: super::agent_runtime::Trace = serde_json::from_value(value.clone())
                    .map_err(|_| AnalysisError::InvalidData)?;
                a.requests = a.requests.saturating_add(trace.requests.len() as u32);
                let elapsed =
                    if trace.status == "running" && live && trace.run_id.as_deref() == Some(run_id)
                    {
                        trace.elapsed_ms.saturating_add(
                            super::agent_runtime::now_ms().saturating_sub(trace.observed_at_ms),
                        )
                    } else {
                        trace.elapsed_ms
                    };
                a.elapsed_ms += elapsed as f64;
                a.timing_complete &= trace.status != "running";
                for request in trace.requests {
                    a.input_tokens = a
                        .input_tokens
                        .zip(request.usage.and_then(|u| u.input_tokens))
                        .map(|(n, v)| n + v as f64);
                    a.output_tokens = a
                        .output_tokens
                        .zip(request.usage.and_then(|u| u.output_tokens))
                        .map(|(n, v)| n + v as f64);
                }
            }
        }
        if let Some(offset) = window.content["review"]["sourceOffset"].as_u64()
            && let Some(issues) = window.content["review"]["result"]["issues"].as_array()
        {
            for issue in issues {
                let start = issue["start"]
                    .as_u64()
                    .and_then(|v| v.checked_add(offset))
                    .and_then(|v| u32::try_from(v).ok())
                    .ok_or(AnalysisError::InvalidData)?;
                let end = issue["end"]
                    .as_u64()
                    .and_then(|v| v.checked_add(offset))
                    .and_then(|v| u32::try_from(v).ok())
                    .ok_or(AnalysisError::InvalidData)?;
                let suggestion = &issue["suggestion"];
                let name = |id: &str| {
                    window.content["analysis"]["characters"]
                        .as_array()
                        .and_then(|cs| cs.iter().find(|c| c["id"] == id))
                        .and_then(|c| c["name"].as_str())
                        .map(str::to_owned)
                };
                let kind = match suggestion["kind"].as_str() {
                    Some("narration") => Some(SegmentKind::Narration),
                    Some("speech") => Some(SegmentKind::Speech),
                    Some("thought") => Some(SegmentKind::Thought),
                    _ => None,
                };
                let speaker_name = suggestion["speaker"].as_str().and_then(name);
                let candidate_names = suggestion["candidates"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v.as_str().and_then(name))
                    .collect();
                a.review_findings.push(ReviewFinding {
                    range: ByteRange { start, end },
                    kind,
                    speaker_name,
                    candidate_names,
                });
            }
        }
    }
    if windows.iter().all(|w| w.status == "completed")
        && let Some(a) = &mut agent
    {
        a.stage = "completed".into();
    }
    Ok(Progress {
        agent,
        completed: windows
            .iter()
            .filter(|w| w.status == "completed")
            .count()
            .try_into()
            .map_err(|_| AnalysisError::InvalidData)?,
        total: windows
            .len()
            .try_into()
            .map_err(|_| AnalysisError::InvalidData)?,
        resume: input.resume_input_id.is_some(),
        analyze: input.action == super::input::Action::Analyze,
    })
}
