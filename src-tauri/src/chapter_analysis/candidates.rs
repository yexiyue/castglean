//! Explicit difference review; unselected ranges preserve the current human version.
use super::{
    query,
    review::{self, Difference},
    store,
    types::*,
};
use crate::{
    database::entity::{analysis_candidate, analysis_edit},
    project::receipts::{self, CommandResult},
};
use sea_orm::{
    ActiveModelTrait, DatabaseConnection, EntityTrait, IntoActiveModel, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Candidate {
    pub id: String,
    pub chapter_id: String,
    pub version_id: String,
    pub base_version_id: Option<String>,
    pub base_revision: u32,
    pub status: String,
    pub stale: bool,
    pub source_changed: bool,
    pub differences: Vec<Difference>,
}

pub(crate) async fn read(
    db: &impl sea_orm::ConnectionTrait,
    project_id: &str,
    id: &str,
) -> Result<Candidate, AnalysisError> {
    let row = analysis_candidate::Entity::find_by_id(id)
        .one(db)
        .await?
        .filter(|c| c.project_id == project_id)
        .ok_or(AnalysisError::NotFound)?;
    let version = query::version(db, project_id, &row.version_id).await?;
    let source_changed = if let Some(id) = &row.base_version_id {
        query::version(db, project_id, id)
            .await?
            .dependencies
            .source
            != version.dependencies.source
    } else {
        false
    };
    let state = store::state(db, project_id, &row.chapter_id).await?;
    let stale = store::check_dependencies(db, &version.dependencies, false)
        .await
        .is_err()
        || state.as_ref().is_none_or(|s| {
            Some(&s.current_version_id) != row.base_version_id.as_ref()
                || s.revision != row.base_revision
                || s.human_revision as u32 != version.dependencies.human_revision
        });
    Ok(Candidate {
        id: row.id,
        chapter_id: row.chapter_id,
        version_id: row.version_id,
        base_version_id: row.base_version_id,
        base_revision: row.base_revision as u32,
        status: row.status,
        stale,
        source_changed,
        differences: serde_json::from_value(row.content).map_err(|_| AnalysisError::InvalidData)?,
    })
}

pub(crate) struct Decision {
    pub selected: Option<Vec<String>>,
    pub allow_conflicts: Vec<String>,
}

pub(crate) async fn process(
    db: &DatabaseConnection,
    root: &Path,
    project_id: &str,
    candidate_id: &str,
    command_id: &str,
    expected: u32,
    decision: Decision,
) -> Result<CommandResult, AnalysisError> {
    let Decision {
        selected,
        allow_conflicts,
    } = decision;
    let fingerprint = receipts::fingerprint(
        "chapter_analysis_candidate",
        &(
            project_id,
            candidate_id,
            expected,
            &selected,
            &allow_conflicts,
        ),
    )
    .map_err(|_| AnalysisError::InvalidData)?;
    if let Some(result) =
        receipts::replay(db, command_id, "chapter_analysis_candidate", &fingerprint)
            .await
            .map_err(|_| AnalysisError::Conflict)?
    {
        return Ok(result);
    }
    let prepared = if selected.is_some() {
        let candidate = read(db, project_id, candidate_id).await?;
        Some(query::prepare_text(db, root, project_id, &candidate.chapter_id).await?)
    } else {
        None
    };
    let tx = db.begin().await?;
    crate::project::store::lock(&tx, project_id)
        .await
        .map_err(|_| AnalysisError::NotFound)?;
    if let Some(r) = receipts::replay(&tx, command_id, "chapter_analysis_candidate", &fingerprint)
        .await
        .map_err(|_| AnalysisError::Conflict)?
    {
        return Ok(r);
    }
    let candidate = read(&tx, project_id, candidate_id).await?;
    if candidate.status != "pending" {
        return Err(AnalysisError::Conflict);
    }
    let state = store::state(&tx, project_id, &candidate.chapter_id)
        .await?
        .ok_or(AnalysisError::Conflict)?;
    if state.revision as u32 != expected {
        return Err(AnalysisError::Conflict);
    }
    let mut revision = expected;
    let mut result_id = state.current_version_id.clone();
    let status = if let Some(selected) = selected {
        if candidate.stale {
            return Err(AnalysisError::Conflict);
        }
        let old = query::version(&tx, project_id, &state.current_version_id).await?;
        let mut next = if candidate.source_changed {
            let [group] = candidate.differences.as_slice() else {
                return Err(AnalysisError::InvalidData);
            };
            if selected != [group.id.clone()] || allow_conflicts != selected {
                return Err(AnalysisError::Conflict);
            }
            let mut version = query::version(&tx, project_id, &candidate.version_id).await?;
            version.id = uuid::Uuid::new_v4().to_string();
            version.parent_id = Some(old.id.clone());
            version.run_id = None;
            version
        } else {
            review::merge(&old, &candidate.differences, &selected, &allow_conflicts)?
        };
        next.dependencies.analysis_revision = expected;
        next.dependencies.human_revision = state.human_revision as u32;
        let (source, text) = prepared.as_ref().ok_or(AnalysisError::InvalidData)?;
        if *source != next.dependencies.source
            || *source != query::binding(&tx, project_id, &candidate.chapter_id).await?
        {
            return Err(AnalysisError::SourceChanged);
        }
        store::insert_version(&tx, &next, text).await?;
        // An obsolete source range cannot become current again through annotation undo.
        // Its immutable version remains accessible in history.
        revision = store::set_current(
            &tx,
            &next,
            expected,
            true,
            (!candidate.source_changed).then(|| command_id.into()),
        )
        .await?;
        analysis_edit::ActiveModel {
            id: Set(command_id.into()),
            project_id: Set(project_id.into()),
            chapter_id: Set(candidate.chapter_id.clone()),
            before_version_id: Set(old.id),
            after_version_id: Set(next.id.clone()),
            revision: Set(revision as i32),
            operation: Set(format!("candidate:{candidate_id}")),
        }
        .insert(&tx)
        .await
        .map_err(|_| AnalysisError::WriteFailed)?;
        result_id = next.id;
        "applied"
    } else {
        "discarded"
    };
    let row = analysis_candidate::Entity::find_by_id(candidate_id)
        .one(&tx)
        .await?
        .ok_or(AnalysisError::NotFound)?;
    let mut row = row.into_active_model();
    row.status = Set(status.into());
    row.update(&tx)
        .await
        .map_err(|_| AnalysisError::WriteFailed)?;
    let result = CommandResult {
        version: 1,
        project_id: project_id.into(),
        revision,
        result_id: Some(result_id),
    };
    receipts::record(
        &tx,
        command_id,
        "chapter_analysis_candidate",
        &fingerprint,
        &result,
    )
    .await
    .map_err(|_| AnalysisError::WriteFailed)?;
    tx.commit().await.map_err(|_| AnalysisError::WriteFailed)?;
    Ok(result)
}
