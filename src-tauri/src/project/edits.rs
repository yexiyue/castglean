//! Project edit use cases. The command receipt and new revision commit together.
use super::{
    ProjectError,
    receipts::{self, CommandResult},
    store,
};
use crate::novel_import::{self, HeadingRule, ImportIssue};
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ProjectEdit {
    Info {
        title: String,
        description: String,
    },
    Boundary {
        correction: super::Correction,
    },
    Rules {
        rules: Vec<HeadingRule>,
    },
    Volume {
        source_id: String,
        line: u32,
        title: String,
    },
}

pub(crate) fn capture_undo(state: &mut store::LocalProject) {
    state.edit.undo = Some(store::UndoState {
        document: state.document.clone(),
        rules: state.edit.rules.clone(),
        issues: state.edit.issues.clone(),
        single_chapter_sources: state.edit.single_chapter_sources.clone(),
    });
}

pub(crate) async fn apply(
    db: &DatabaseConnection,
    root: &Path,
    id: &str,
    revision: u32,
    command_id: &str,
    edit: ProjectEdit,
) -> Result<CommandResult, ProjectError> {
    let hash = receipts::fingerprint("edit_project", &(id, revision, &edit))?;
    if let Some(result) = receipts::replay(db, command_id, "edit_project", &hash).await? {
        return Ok(result);
    }
    let mut state = store::read(db, root, id).await?;
    if state.document.project.revision != revision {
        return receipts::replay(db, command_id, "edit_project", &hash)
            .await?
            .ok_or(ProjectError::Conflict);
    }
    capture_undo(&mut state);
    let token = CancellationToken::new();
    let mut issues: Vec<ImportIssue> = serde_json::from_value(state.edit.issues.clone())
        .map_err(|_| ProjectError::InvalidProject)?;
    match edit {
        ProjectEdit::Info { title, description } => {
            state.document.project.title = title;
            state.document.project.description = description;
        }
        ProjectEdit::Boundary { correction } => novel_import::patch_boundaries(
            &mut state.document,
            &mut issues,
            vec![correction],
            &token,
        )?,
        ProjectEdit::Rules { rules } => {
            let single: Vec<String> =
                serde_json::from_value(state.edit.single_chapter_sources.clone())
                    .map_err(|_| ProjectError::InvalidProject)?;
            novel_import::recalculate(&mut state.document, &rules, &single, &mut issues, &token)?;
            state.edit.rules =
                serde_json::to_value(rules).map_err(|_| ProjectError::InvalidProject)?;
        }
        ProjectEdit::Volume {
            source_id,
            line,
            title,
        } => {
            let volume_id = format!("{source_id}-v-{line}");
            state.document.project.volumes.retain(|v| v.id != volume_id);
            state.document.project.volumes.push(super::Volume {
                id: volume_id,
                source_id,
                line,
                title,
                manual: true,
            });
            novel_import::regroup(&mut state.document);
        }
    }
    state.edit.issues = serde_json::to_value(issues).map_err(|_| ProjectError::InvalidProject)?;
    state.document.project.revision = revision.checked_add(1).ok_or(ProjectError::TooLarge)?;
    let prepared = store::prepare(root, &state)?;
    let tx = db.begin().await.map_err(|_| ProjectError::WriteFailed)?;
    store::lock(&tx, id).await?;
    if let Some(result) = receipts::replay(&tx, command_id, "edit_project", &hash).await? {
        return Ok(result);
    }
    store::write(&tx, &prepared, Some(revision)).await?;
    let result = CommandResult {
        version: 1,
        project_id: id.into(),
        revision: state.document.project.revision,
        result_id: None,
    };
    receipts::record(&tx, command_id, "edit_project", &hash, &result).await?;
    tx.commit().await.map_err(|_| ProjectError::WriteFailed)?;
    Ok(result)
}

pub(crate) async fn undo(
    db: &DatabaseConnection,
    root: &Path,
    id: &str,
    revision: u32,
    command_id: &str,
) -> Result<CommandResult, ProjectError> {
    let hash = receipts::fingerprint("undo_project", &(id, revision))?;
    if let Some(result) = receipts::replay(db, command_id, "undo_project", &hash).await? {
        return Ok(result);
    }
    let mut state = store::read(db, root, id).await?;
    if state.document.project.revision != revision {
        return receipts::replay(db, command_id, "undo_project", &hash)
            .await?
            .ok_or(ProjectError::Conflict);
    }
    let undo = state.edit.undo.take().ok_or(ProjectError::NotFound)?;
    state.document = undo.document;
    state.document.project.revision = revision.checked_add(1).ok_or(ProjectError::TooLarge)?;
    state.edit.rules = undo.rules;
    state.edit.issues = undo.issues;
    state.edit.single_chapter_sources = undo.single_chapter_sources;
    let prepared = store::prepare(root, &state)?;
    let tx = db.begin().await.map_err(|_| ProjectError::WriteFailed)?;
    store::lock(&tx, id).await?;
    if let Some(result) = receipts::replay(&tx, command_id, "undo_project", &hash).await? {
        return Ok(result);
    }
    store::write(&tx, &prepared, Some(revision)).await?;
    let result = CommandResult {
        version: 1,
        project_id: id.into(),
        revision: state.document.project.revision,
        result_id: None,
    };
    receipts::record(&tx, command_id, "undo_project", &hash, &result).await?;
    tx.commit().await.map_err(|_| ProjectError::WriteFailed)?;
    Ok(result)
}

#[cfg(test)]
mod tests;
