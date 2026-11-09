//! Read-only C7 progress, review findings and redacted execution diagnostics.
use super::{
    checkpoint::{Identity, WindowReview},
    input,
    types::*,
};
use crate::database::entity::analysis_window;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostics<'a> {
    protocol: &'static str,
    run_id: &'a str,
    input_id: &'a str,
    configuration: crate::ai::Configuration,
    identities: Vec<Identity>,
    traces: Vec<super::agent_runtime::Trace>,
    windows_complete: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewProjection {
    protocol: &'static str,
    chapter_id: String,
    issues: Vec<ReviewFinding>,
    complete: bool,
    applied: bool,
    human_confirmed: bool,
}

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
        if !row.content.validate() {
            return Err(AnalysisError::InvalidData);
        }
        if let Some(checkpoint) = &row.content.checkpoint {
            identities.push(checkpoint.identity.clone());
        }
        traces.extend(row.content.traces.values().cloned());
    }
    serde_json::to_value(Diagnostics {
        protocol: "chapter-agent-c7/1",
        run_id,
        input_id: origin,
        configuration: input.configuration,
        identities,
        traces,
        windows_complete: !rows.is_empty() && rows.iter().all(|r| r.status == "completed"),
    })
    .map_err(|_| AnalysisError::InvalidData)
}

pub(super) async fn review(
    db: &impl ConnectionTrait,
    run_id: &str,
) -> Result<Option<Value>, AnalysisError> {
    let progress = progress(db, run_id).await?;
    if let Some(agent) = progress.agent {
        return serde_json::to_value(ReviewProjection {
            protocol: "chapter-agent-c7/1",
            chapter_id: agent.chapter_id,
            issues: agent.review_findings,
            complete: agent.stage == "completed",
            applied: false,
            human_confirmed: false,
        })
        .map(Some)
        .map_err(|_| AnalysisError::InvalidData);
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
        if !window.content.validate() {
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
        if window
            .content
            .checkpoint
            .as_ref()
            .is_some_and(|c| c.analysis.is_some() && c.review.is_none())
        {
            a.stage = "review".into();
        }
        for trace in window.content.traces.values() {
            a.requests = a.requests.saturating_add(trace.requests.len() as u32);
            let elapsed = if trace.status == super::agent_runtime::TraceStatus::Running
                && live
                && trace.run_id.as_deref() == Some(run_id)
            {
                trace.elapsed_ms.saturating_add(
                    super::agent_runtime::now_ms().saturating_sub(trace.observed_at_ms),
                )
            } else {
                trace.elapsed_ms
            };
            a.elapsed_ms += elapsed as f64;
            a.timing_complete &= trace.status != super::agent_runtime::TraceStatus::Running;
            for request in &trace.requests {
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
        if let Some(checkpoint) = &window.content.checkpoint
            && let Some(WindowReview {
                source_offset,
                result,
            }) = &checkpoint.review
        {
            let analysis = checkpoint
                .analysis
                .as_ref()
                .ok_or(AnalysisError::InvalidData)?;
            let name = |id: &str| {
                analysis
                    .characters
                    .iter()
                    .find(|c| c.id == id)
                    .map(|c| c.name.clone())
            };
            for issue in &result.issues {
                let coordinate = |n: usize| {
                    u32::try_from(n)
                        .ok()
                        .and_then(|v| v.checked_add(*source_offset))
                        .ok_or(AnalysisError::InvalidData)
                };
                let (kind, speaker_name, candidate_names) =
                    if let Some(suggestion) = &issue.suggestion {
                        let kind = match suggestion.kind.as_str() {
                            "narration" => SegmentKind::Narration,
                            "speech" => SegmentKind::Speech,
                            "thought" => SegmentKind::Thought,
                            _ => return Err(AnalysisError::InvalidData),
                        };
                        (
                            Some(kind),
                            name(&suggestion.speaker),
                            suggestion
                                .candidates
                                .iter()
                                .filter_map(|id| name(id))
                                .collect(),
                        )
                    } else {
                        (None, None, vec![])
                    };
                a.review_findings.push(ReviewFinding {
                    range: ByteRange {
                        start: coordinate(issue.start)?,
                        end: coordinate(issue.end)?,
                    },
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
