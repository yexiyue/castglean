//! Human edits, boundary replacement and undo are atomic and idempotent.
use super::{query, store, types::*};
use crate::{
    database::entity::analysis_edit,
    project::receipts::{self, CommandResult},
};
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set, TransactionTrait};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Edit {
    Segment {
        id: String,
        kind: SegmentKind,
        attribution: Attribution,
        confirm: bool,
    },
    Replace {
        range: ByteRange,
        segments: Vec<Segment>,
    },
    Undo,
}

pub(crate) async fn apply(
    db: &DatabaseConnection,
    root: &Path,
    project_id: &str,
    chapter_id: &str,
    command_id: &str,
    expected: u32,
    edit: Edit,
) -> Result<CommandResult, AnalysisError> {
    let fingerprint = receipts::fingerprint(
        "chapter_analysis_edit",
        &(project_id, chapter_id, expected, &edit),
    )
    .map_err(|_| AnalysisError::InvalidData)?;
    if let Some(result) = receipts::replay(db, command_id, "chapter_analysis_edit", &fingerprint)
        .await
        .map_err(|_| AnalysisError::Conflict)?
    {
        return Ok(result);
    }
    let (source, text) = query::prepare_text(db, root, project_id, chapter_id).await?;
    let tx = db.begin().await?;
    crate::project::store::lock(&tx, project_id)
        .await
        .map_err(|_| AnalysisError::NotFound)?;
    if let Some(replay) = receipts::replay(&tx, command_id, "chapter_analysis_edit", &fingerprint)
        .await
        .map_err(|_| AnalysisError::Conflict)?
    {
        return Ok(replay);
    }
    let state = store::state(&tx, project_id, chapter_id)
        .await?
        .ok_or(AnalysisError::NotFound)?;
    if state.revision as u32 != expected {
        return Err(AnalysisError::Conflict);
    }
    let current = query::version(&tx, project_id, &state.current_version_id).await?;
    if source != current.dependencies.source
        || source != query::binding(&tx, project_id, chapter_id).await?
    {
        return Err(AnalysisError::SourceChanged);
    }
    let mut next = current.clone();
    match &edit {
        Edit::Segment {
            id,
            kind,
            attribution,
            confirm,
        } => {
            let s = next
                .segments
                .iter_mut()
                .find(|s| s.id == *id)
                .ok_or(AnalysisError::NotFound)?;
            let mut fields = Vec::new();
            if s.kind != *kind {
                fields.push(ProtectedField::Kind);
            }
            if s.attribution != *attribution {
                fields.push(ProtectedField::Attribution);
            }
            s.kind = *kind;
            s.attribution = attribution.clone();
            if *confirm {
                s.review = ReviewStatus::Confirmed;
                fields.extend([
                    ProtectedField::Kind,
                    ProtectedField::Attribution,
                    ProtectedField::Review,
                ]);
            }
            if fields.is_empty() {
                return Err(AnalysisError::InvalidData);
            }
            next.protections.push(Protection {
                range: s.range.clone(),
                fields,
            });
        }
        Edit::Replace { range, segments } => {
            if segments.is_empty()
                || segments.first().map(|s| s.range.start) != Some(range.start)
                || segments.last().map(|s| s.range.end) != Some(range.end)
            {
                return Err(AnalysisError::InvalidData);
            }
            let first = next
                .segments
                .iter()
                .position(|s| s.range.start == range.start)
                .ok_or(AnalysisError::InvalidData)?;
            let last = next
                .segments
                .iter()
                .position(|s| s.range.end == range.end)
                .filter(|n| *n >= first)
                .ok_or(AnalysisError::InvalidData)?;
            let mut replacement = segments.clone();
            for s in &mut replacement {
                s.id = uuid::Uuid::new_v4().to_string();
                s.review = ReviewStatus::Confirmed;
            }
            next.segments.splice(first..=last, replacement);
            super::review::subtract_protection_range(&mut next.protections, range);
            next.protections.push(Protection {
                range: range.clone(),
                fields: vec![
                    ProtectedField::Boundary,
                    ProtectedField::Kind,
                    ProtectedField::Attribution,
                    ProtectedField::Review,
                ],
            });
        }
        Edit::Undo => {
            let id = state
                .last_edit_id
                .as_deref()
                .ok_or(AnalysisError::Conflict)?;
            let previous = analysis_edit::Entity::find_by_id(id)
                .one(&tx)
                .await?
                .ok_or(AnalysisError::Conflict)?;
            if previous.project_id != project_id
                || previous.chapter_id != chapter_id
                || previous.after_version_id != current.id
                || previous.revision as u32 != expected
            {
                return Err(AnalysisError::Conflict);
            }
            if let Some(id) = previous.operation.strip_prefix("candidate:") {
                use sea_orm::IntoActiveModel;
                let candidate = crate::database::entity::analysis_candidate::Entity::find_by_id(id)
                    .one(&tx)
                    .await?
                    .ok_or(AnalysisError::Conflict)?;
                if candidate.project_id != project_id || candidate.chapter_id != chapter_id {
                    return Err(AnalysisError::Conflict);
                }
                let mut update = candidate.into_active_model();
                update.status = Set("withdrawn".into());
                update
                    .update(&tx)
                    .await
                    .map_err(|_| AnalysisError::WriteFailed)?;
            }
            next = query::version(&tx, project_id, &previous.before_version_id).await?;
            if next.dependencies.source != current.dependencies.source {
                return Err(AnalysisError::SourceChanged);
            }
        }
    }
    next.id = uuid::Uuid::new_v4().to_string();
    next.parent_id = Some(current.id.clone());
    next.run_id = None;
    next.dependencies.analysis_revision = expected;
    next.dependencies.human_revision = state.human_revision as u32;
    store::insert_version(&tx, &next, &text).await?;
    let undo = matches!(edit, Edit::Undo);
    let revision = store::set_current(
        &tx,
        &next,
        expected,
        true,
        (!undo).then(|| command_id.to_owned()),
    )
    .await?;
    analysis_edit::ActiveModel {
        id: Set(command_id.into()),
        project_id: Set(project_id.into()),
        chapter_id: Set(chapter_id.into()),
        before_version_id: Set(current.id),
        after_version_id: Set(next.id.clone()),
        revision: Set(revision as i32),
        operation: Set(if undo { "undo" } else { "edit" }.into()),
    }
    .insert(&tx)
    .await
    .map_err(|_| AnalysisError::WriteFailed)?;
    let result = CommandResult {
        version: 1,
        project_id: project_id.into(),
        revision,
        result_id: Some(next.id),
    };
    receipts::record(
        &tx,
        command_id,
        "chapter_analysis_edit",
        &fingerprint,
        &result,
    )
    .await
    .map_err(|_| AnalysisError::WriteFailed)?;
    tx.commit().await.map_err(|_| AnalysisError::WriteFailed)?;
    Ok(result)
}

#[cfg(test)]
mod tests;
