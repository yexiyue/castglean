//! Read-only routing for C7 diagnostics and historical compact-workflow records.
use super::{input, journal, query, types::AnalysisError};
use crate::database::entity::analysis_window;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};
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
    let c7 = input.protocol == 2
        || rows
            .iter()
            .any(|r| r.content["identity"]["implementationHash"].is_string());
    if !c7 {
        return journal::diagnostics(db, run_id).await;
    }
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
    let progress = query::progress(db, run_id).await?;
    if let Some(agent) = progress.agent {
        return Ok(Some(
            json!({"protocol":"chapter-agent-c7/1","chapterId":agent.chapter_id,
            "issues":agent.review_findings,"complete":agent.stage=="completed","applied":false,"humanConfirmed":false}),
        ));
    }
    journal::review(db, run_id).await
}
