//! Import a frozen selection with its command receipt in one project transaction.
use super::{HeadingRule, ImportIssue, decode_source, detect_chapters, selection::Selections};
use crate::project::{
    self, ProjectError,
    receipts::{self, CommandResult},
    store,
};
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImportSource {
    pub project_id: String,
    pub revision: u32,
    pub selection_id: String,
    pub encoding: String,
    pub split: bool,
    pub command_id: String,
}

pub(crate) async fn confirm(
    db: &DatabaseConnection,
    root: &Path,
    selections: &Selections,
    request: ImportSource,
) -> Result<CommandResult, ProjectError> {
    let hash = receipts::fingerprint(
        "import_source",
        &(
            &request.project_id,
            request.revision,
            &request.selection_id,
            &request.encoding,
            request.split,
        ),
    )?;
    if let Some(result) = receipts::replay(db, &request.command_id, "import_source", &hash).await? {
        return Ok(result);
    }
    let selected = match selections.get(&request.selection_id) {
        Ok(selected) => selected,
        Err(error) => {
            return receipts::replay(db, &request.command_id, "import_source", &hash)
                .await?
                .ok_or(error);
        }
    };
    let mut state = store::read(db, root, &request.project_id).await?;
    if state.document.project.revision != request.revision {
        return receipts::replay(db, &request.command_id, "import_source", &hash)
            .await?
            .ok_or(ProjectError::Conflict);
    }
    let text = decode_source(&selected.raw, &request.encoding)?;
    let source = project::Source {
        id: uuid::Uuid::new_v4().to_string(),
        filename: selected.filename,
        encoding: request.encoding.clone(),
        raw_sha256: project::hash(&selected.raw),
        sha256: project::hash(text.as_bytes()),
        text,
    };
    if state
        .document
        .project
        .sources
        .iter()
        .any(|s| s.sha256 == source.sha256)
    {
        return Err(ProjectError::DuplicateSource);
    }
    if state.document.project.sources.len() >= 128
        || state
            .document
            .project
            .sources
            .iter()
            .map(|s| s.text.len())
            .sum::<usize>()
            + source.text.len()
            > project::MAX_TOTAL
    {
        return Err(ProjectError::TooLarge);
    }
    project::edits::capture_undo(&mut state);
    let rules: Vec<HeadingRule> = serde_json::from_value(state.edit.rules.clone())
        .map_err(|_| ProjectError::InvalidProject)?;
    let detected = detect_chapters(
        &source,
        if request.split { &rules } else { &[] },
        &[],
        &[],
        &CancellationToken::new(),
    )?;
    let mut issues: Vec<ImportIssue> = serde_json::from_value(state.edit.issues.clone())
        .map_err(|_| ProjectError::InvalidProject)?;
    issues.extend(detected.issues);
    state.edit.issues = serde_json::to_value(issues).map_err(|_| ProjectError::InvalidProject)?;
    if !request.split {
        let mut single: Vec<String> =
            serde_json::from_value(state.edit.single_chapter_sources.clone())
                .map_err(|_| ProjectError::InvalidProject)?;
        single.push(source.id.clone());
        state.edit.single_chapter_sources =
            serde_json::to_value(single).map_err(|_| ProjectError::InvalidProject)?;
    }
    let source_id = source.id.clone();
    state.document.project.chapters.extend(detected.chapters);
    state.document.project.volumes.extend(detected.volumes);
    state.document.project.sources.push(source.clone());
    state.document.project.revision = request
        .revision
        .checked_add(1)
        .ok_or(ProjectError::TooLarge)?;
    state.document.validate()?;
    project::publish_source(root, &source, &selected.raw)?;
    let prepared = store::prepare(root, &state)?;
    let tx = db.begin().await.map_err(|_| ProjectError::WriteFailed)?;
    store::lock(&tx, &request.project_id).await?;
    if let Some(result) = receipts::replay(&tx, &request.command_id, "import_source", &hash).await?
    {
        return Ok(result);
    }
    store::write(&tx, &prepared, Some(request.revision)).await?;
    let result = CommandResult {
        version: 1,
        project_id: request.project_id,
        revision: state.document.project.revision,
        result_id: Some(source_id),
    };
    receipts::record(&tx, &request.command_id, "import_source", &hash, &result).await?;
    tx.commit().await.map_err(|_| ProjectError::WriteFailed)?;
    let _ = selections.release(&request.selection_id);
    Ok(result)
}

#[cfg(test)]
mod tests;
