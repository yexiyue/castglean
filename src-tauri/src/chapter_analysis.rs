//! Source-bound chapter attribution. No engine or UI state belongs in this domain.
mod candidates;
mod characters;
pub(crate) mod commands;
mod compact;
mod edits;
mod execution;
mod workflow;
pub(crate) use workflow::execute_configured;
mod journal;
pub(crate) use journal::RequestLimits;
mod input;
mod precut;
pub(crate) use input::freeze as freeze_input;
#[cfg(test)]
mod evaluation;
#[cfg(test)]
mod experiment;
mod history;
mod protocol;
mod query;
mod review;
mod source;
mod store;
mod types;
mod validation;
mod windows;

/// Bounded annotation context for the project assistant; no source text is duplicated.
pub(crate) async fn inspect(
    db: &impl sea_orm::ConnectionTrait,
    project_id: &str,
    chapter_id: &str,
    page: u32,
) -> Result<serde_json::Value, types::AnalysisError> {
    if page > 100_000 {
        return Err(types::AnalysisError::CapacityExceeded);
    }
    let source = query::binding(db, project_id, chapter_id).await?;
    let Some(state) = store::state(db, project_id, chapter_id).await? else {
        return Ok(serde_json::json!({"chapter_id":chapter_id,"status":"not_analyzed"}));
    };
    let version = query::version(db, project_id, &state.current_version_id).await?;
    let ai_review = if let Some(run_id) = version.run_id.as_deref() {
        journal::review(db, run_id).await?
    } else {
        None
    };
    let value = serde_json::json!({"chapter_id":chapter_id,"stale":version.dependencies.source != source,
        "revision":state.revision,"segments":version.segments.iter().skip(page as usize * 5).take(5).collect::<Vec<_>>(),
        "next_page":((page as usize + 1) * 5 < version.segments.len()).then_some(page + 1),
        "characters":query::characters(db, project_id).await?.iter().map(|c| serde_json::json!({"id":c.id,"name":c.display_name,"status":c.status})).take(30).collect::<Vec<_>>(),
        "aiReview":ai_review});
    if serde_json::to_vec(&value)
        .map_err(|_| types::AnalysisError::InvalidData)?
        .len()
        > 16 * 1024
    {
        return Err(types::AnalysisError::CapacityExceeded);
    }
    Ok(value)
}
