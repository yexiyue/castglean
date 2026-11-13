//! Immutable versions and optimistic current pointers. Caller holds the SQLite writer slot.
use super::{query, types::*, validation};
use crate::database::entity::{analysis_state, analysis_version, character};
use sea_orm::{ActiveModelTrait, ConnectionTrait, EntityTrait, IntoActiveModel, Set};

pub(crate) async fn state(
    db: &impl ConnectionTrait,
    project_id: &str,
    chapter_id: &str,
) -> Result<Option<analysis_state::Model>, AnalysisError> {
    let row = analysis_state::Entity::find_by_id(chapter_id)
        .one(db)
        .await?;
    if row.as_ref().is_some_and(|s| s.project_id != project_id) {
        return Err(AnalysisError::Conflict);
    }
    Ok(row)
}

pub(crate) async fn check_dependencies(
    db: &impl ConnectionTrait,
    dependencies: &Dependencies,
    check_revision: bool,
) -> Result<(), AnalysisError> {
    let source = &dependencies.source;
    if query::binding(db, &source.project_id, &source.chapter_id).await? != *source {
        return Err(AnalysisError::SourceChanged);
    }
    if check_revision {
        let current = state(db, &source.project_id, &source.chapter_id).await?;
        if current.as_ref().map_or(0, |s| s.revision as u32) != dependencies.analysis_revision
            || current.as_ref().map_or(0, |s| s.human_revision as u32)
                != dependencies.human_revision
        {
            return Err(AnalysisError::Conflict);
        }
    }
    for dependency in &dependencies.characters {
        let row = character::Entity::find_by_id(&dependency.id)
            .one(db)
            .await?
            .ok_or(AnalysisError::Conflict)?;
        if row.project_id != source.project_id
            || row.revision as u32 != dependency.revision
            || !matches!(row.status.as_str(), "confirmed" | "candidate")
        {
            return Err(AnalysisError::Conflict);
        }
    }
    for context in &dependencies.contexts {
        let v = query::version(db, &source.project_id, &context.version_id).await?;
        let current = state(db, &source.project_id, &context.chapter_id)
            .await?
            .ok_or(AnalysisError::Conflict)?;
        if v.dependencies.source.chapter_id != context.chapter_id
            || current.current_version_id != context.version_id
            || crate::project::hash(
                &serde_json::to_vec(&v).map_err(|_| AnalysisError::InvalidData)?,
            ) != context.digest
        {
            return Err(AnalysisError::Conflict);
        }
    }
    Ok(())
}

pub(crate) async fn insert_version(
    db: &impl ConnectionTrait,
    version: &AnalysisVersion,
    text: &str,
) -> Result<(), AnalysisError> {
    validation::validate(
        version,
        text,
        &query::characters(db, &version.dependencies.source.project_id).await?,
    )?;
    analysis_version::ActiveModel {
        id: Set(version.id.clone()),
        project_id: Set(version.dependencies.source.project_id.clone()),
        chapter_id: Set(version.dependencies.source.chapter_id.clone()),
        run_id: Set(version.run_id.clone()),
        content: Set(serde_json::to_value(version).map_err(|_| AnalysisError::InvalidData)?),
        created_at: Set(crate::timestamp::unix_seconds()),
    }
    .insert(db)
    .await
    .map_err(|_| AnalysisError::WriteFailed)?;
    Ok(())
}

pub(crate) async fn set_current(
    db: &impl ConnectionTrait,
    version: &AnalysisVersion,
    expected_revision: u32,
    human: bool,
    edit_id: Option<String>,
) -> Result<u32, AnalysisError> {
    let b = &version.dependencies.source;
    let previous = state(db, &b.project_id, &b.chapter_id).await?;
    if previous.as_ref().map_or(0, |s| s.revision as u32) != expected_revision {
        return Err(AnalysisError::Conflict);
    }
    let next = expected_revision
        .checked_add(1)
        .and_then(|n| i32::try_from(n).ok())
        .ok_or(AnalysisError::CapacityExceeded)?;
    if let Some(previous) = previous {
        let hr = previous
            .human_revision
            .checked_add(i32::from(human))
            .ok_or(AnalysisError::CapacityExceeded)?;
        let mut update = previous.into_active_model();
        update.current_version_id = Set(version.id.clone());
        update.revision = Set(next);
        update.human_revision = Set(hr);
        update.last_edit_id = Set(edit_id);
        update
            .update(db)
            .await
            .map_err(|_| AnalysisError::WriteFailed)?;
    } else {
        analysis_state::ActiveModel {
            id: Set(b.chapter_id.clone()),
            project_id: Set(b.project_id.clone()),
            current_version_id: Set(version.id.clone()),
            revision: Set(next),
            human_revision: Set(i32::from(human)),
            last_edit_id: Set(edit_id),
        }
        .insert(db)
        .await
        .map_err(|_| AnalysisError::WriteFailed)?;
    }
    Ok(next as u32)
}
