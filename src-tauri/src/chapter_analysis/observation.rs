//! Read-only chapter attribution progress, review findings and redacted execution diagnostics.
use super::{
    checkpoint::{WINDOW_VERSION, WindowReview},
    input,
    types::*,
};
use crate::database::entity::{ai_invocation, analysis_window};
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
    window_version: u32,
    windows: Vec<super::windows::WindowIdentity>,
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
    if rows.iter().any(|row| !row.content.validate()) {
        return Err(AnalysisError::InvalidData);
    }
    serde_json::to_value(Diagnostics {
        protocol: super::agent_runtime::PROTOCOL,
        run_id,
        input_id: origin,
        configuration: input.configuration,
        window_version: WINDOW_VERSION,
        windows: rows.iter().map(|row| row.content.plan.clone()).collect(),
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
            protocol: super::agent_runtime::PROTOCOL,
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
    pub elapsed_ms: Option<f64>,
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
/// Attribution has one owning invocation per run. Review invocations are nested
/// below it and share its persisted window checkpoints.
pub(crate) async fn invocation_progress(
    db: &impl ConnectionTrait,
    run_id: &str,
    subagent_run_id: &str,
) -> Result<Progress, AnalysisError> {
    ai_invocation::Entity::find_by_id(subagent_run_id)
        .filter(ai_invocation::Column::RunId.eq(run_id))
        .filter(ai_invocation::Column::Name.eq("chapter_analysis"))
        .one(db)
        .await?
        .ok_or(AnalysisError::NotFound)?;
    progress(db, run_id).await
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
    let reviewing = ai_invocation::Entity::find()
        .filter(ai_invocation::Column::RunId.eq(run_id))
        .filter(ai_invocation::Column::Name.eq("review"))
        .filter(ai_invocation::Column::Status.eq("running"))
        .one(db)
        .await?
        .is_some();
    let requests = current_run
        .as_ref()
        .and_then(|run| {
            serde_json::from_value::<crate::ai::budget::Ledger>(run.budget.clone())
                .ok()?
                .total()
                .ok()
                .map(|budget| budget.requests)
        })
        .unwrap_or_default();
    let elapsed_ms = current_run.as_ref().and_then(|run| {
        let start = run.created_at.parse::<f64>().ok()?;
        let end = run
            .finished_at
            .clone()
            .unwrap_or_else(crate::timestamp::unix_seconds);
        Some((end.parse::<f64>().ok()? - start).max(0.0) * 1000.0)
    });
    let mut agent = None;
    let mut completed = 0;
    for window in &windows {
        if !window.content.validate()
            || (window.status == "completed") != window.content.outcome.is_some()
        {
            return Err(AnalysisError::InvalidData);
        }
        let a = agent.get_or_insert(AgentProgress {
            chapter_id: input.dependencies.source.chapter_id.clone(),
            stage: if reviewing { "review" } else { "analysis" }.into(),
            requests,
            input_tokens: None,
            output_tokens: None,
            elapsed_ms,
            timing_complete: false,
            review_findings: vec![],
        });
        if let Some(outcome) = &window.content.outcome {
            completed += 1;
            let WindowReview {
                source_offset,
                result,
            } = &outcome.review;
            let analysis = &outcome.analysis;
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
    if completed == windows.len()
        && let Some(a) = &mut agent
    {
        a.stage = "completed".into();
    }
    Ok(Progress {
        agent,
        completed: completed
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
