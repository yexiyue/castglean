//! Local project transactions. File publication and domain validation precede the short write transaction.
use super::{Chapter, ProjectDocument, ProjectError, Source, Volume, assets};
use crate::database::entity::{chapter, project, project_edit_state, source, volume};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction,
    EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EditState {
    pub rules: Value,
    pub issues: Value,
    pub single_chapter_sources: Value,
    pub undo: Option<UndoState>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct UndoState {
    pub document: ProjectDocument,
    pub rules: Value,
    pub issues: Value,
    pub single_chapter_sources: Value,
}

fn encode_undo(undo: &Option<UndoState>) -> Result<Option<Value>, ProjectError> {
    undo.as_ref()
        .map(|undo| {
            undo.document.validate_draft()?;
            let p = &undo.document.project;
            let sources: Vec<_> = p.sources.iter().map(|s| serde_json::json!({
                "id":s.id, "filename":s.filename, "encoding":s.encoding, "rawSha256":s.raw_sha256, "sha256":s.sha256
            })).collect();
            Ok(serde_json::json!({
                "document":{
                    "project":{"id":p.id,"title":p.title,"description":p.description,"revision":p.revision,
                        "sources":sources,"chapters":p.chapters,"volumes":p.volumes,"corrections":p.corrections}},
                "rules":undo.rules,"issues":undo.issues,"single_chapter_sources":undo.single_chapter_sources
            }))
        })
        .transpose()
}

fn decode_undo(root: &Path, undo: Option<Value>) -> Result<Option<UndoState>, ProjectError> {
    undo.map(|mut value| {
        for source in value
            .pointer_mut("/document/project/sources")
            .and_then(Value::as_array_mut)
            .ok_or(ProjectError::InvalidProject)?
        {
            let digest = source
                .get("sha256")
                .and_then(Value::as_str)
                .ok_or(ProjectError::InvalidProject)?;
            let text = assets::text(root, digest)?;
            let object = source.as_object_mut().ok_or(ProjectError::InvalidProject)?;
            if object.insert("text".into(), Value::String(text)).is_some() {
                return Err(ProjectError::InvalidProject);
            }
        }
        let undo: UndoState = decode(value)?;
        undo.document.validate_draft()?;
        Ok(undo)
    })
    .transpose()
}

pub(crate) struct LocalProject {
    pub document: ProjectDocument,
    pub edit: EditState,
}

pub(crate) async fn lock(tx: &DatabaseTransaction, id: &str) -> Result<u32, ProjectError> {
    let changed = project::Entity::update_many()
        .col_expr(
            project::Column::Revision,
            sea_orm::sea_query::Expr::col(project::Column::Revision),
        )
        .filter(project::Column::Id.eq(id))
        .exec(tx)
        .await
        .map_err(db_error)?;
    if changed.rows_affected != 1 {
        return Err(ProjectError::NotFound);
    }
    project::Entity::find_by_id(id)
        .one(tx)
        .await
        .map_err(db_error)?
        .ok_or(ProjectError::NotFound)?
        .revision
        .try_into()
        .map_err(|_| ProjectError::InvalidProject)
}

fn db_error(_: sea_orm::DbErr) -> ProjectError {
    ProjectError::WriteFailed
}
fn json<T: Serialize>(value: &T) -> Result<Value, ProjectError> {
    serde_json::to_value(value).map_err(|_| ProjectError::InvalidProject)
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, ProjectError> {
    serde_json::from_value(value).map_err(|_| ProjectError::InvalidProject)
}

/// Opaque validated write input; source IO is finished before opening a transaction.
pub(crate) struct Prepared<'a> {
    state: &'a LocalProject,
    raw_sizes: Vec<usize>,
    undo: Option<Value>,
}

pub(crate) fn prepare<'a>(
    root: &Path,
    state: &'a LocalProject,
) -> Result<Prepared<'a>, ProjectError> {
    state.document.validate_draft()?;
    let p = &state.document.project;
    let raw_sizes = p
        .sources
        .iter()
        .map(|s| assets::verify(root, s))
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(undo) = &state.edit.undo {
        undo.document.validate_draft()?;
        if undo.document.project.id != p.id {
            return Err(ProjectError::InvalidProject);
        }
        for source in &undo.document.project.sources {
            assets::verify(root, source)?;
        }
    }
    Ok(Prepared {
        state,
        raw_sizes,
        undo: encode_undo(&state.edit.undo)?,
    })
}

/// Caller publishes sources before saving. A failed transaction may leave unreferenced files.
pub(crate) async fn save(
    db: &DatabaseConnection,
    root: &Path,
    state: &LocalProject,
    expected: Option<u32>,
) -> Result<(), ProjectError> {
    let prepared = prepare(root, state)?;
    let tx = db.begin().await.map_err(db_error)?;
    write(&tx, &prepared, expected).await?;
    tx.commit().await.map_err(db_error)
}

/// The application use case owns this transaction, including any candidate and receipt.
pub(crate) async fn write(
    tx: &DatabaseTransaction,
    prepared: &Prepared<'_>,
    expected: Option<u32>,
) -> Result<(), ProjectError> {
    let state = prepared.state;
    let p = &state.document.project;
    let revision = i32::try_from(p.revision).map_err(|_| ProjectError::TooLarge)?;
    let now = crate::timestamp::unix_seconds();
    if let Some(expected) = expected {
        if p.revision != expected.checked_add(1).ok_or(ProjectError::TooLarge)? {
            return Err(ProjectError::Conflict);
        }
        let changed = project::Entity::update_many()
            .col_expr(
                project::Column::Title,
                sea_orm::sea_query::Expr::value(p.title.clone()),
            )
            .col_expr(
                project::Column::Description,
                sea_orm::sea_query::Expr::value(p.description.clone()),
            )
            .col_expr(
                project::Column::Revision,
                sea_orm::sea_query::Expr::value(revision),
            )
            .col_expr(
                project::Column::UpdatedAt,
                sea_orm::sea_query::Expr::value(now),
            )
            .col_expr(
                project::Column::Stage,
                sea_orm::sea_query::Expr::value(if p.sources.is_empty() {
                    "importing"
                } else {
                    "editing"
                }),
            )
            .filter(project::Column::Id.eq(&p.id))
            .filter(project::Column::Revision.eq(i64::from(expected)))
            .exec(tx)
            .await
            .map_err(db_error)?;
        if changed.rows_affected != 1 {
            return Err(ProjectError::Conflict);
        }
    } else {
        project::ActiveModel {
            id: Set(p.id.clone()),
            title: Set(p.title.clone()),
            description: Set(p.description.clone()),
            revision: Set(revision),
            stage: Set(if p.sources.is_empty() {
                "importing"
            } else {
                "editing"
            }
            .into()),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        }
        .insert(tx)
        .await
        .map_err(db_error)?;
    }
    write_structure(tx, p, &state.edit, &prepared.raw_sizes, &prepared.undo).await
}

async fn write_structure(
    tx: &impl ConnectionTrait,
    p: &super::document::ProjectData,
    edit: &EditState,
    raw_sizes: &[usize],
    undo: &Option<Value>,
) -> Result<(), ProjectError> {
    let existing = source::Entity::find()
        .filter(source::Column::ProjectId.eq(&p.id))
        .all(tx)
        .await
        .map_err(db_error)?;
    for s in &p.sources {
        if existing.iter().any(|old| {
            old.id == s.id
                && (old.text_sha256 != s.sha256
                    || old.raw_sha256 != s.raw_sha256
                    || old.encoding != s.encoding)
        }) {
            return Err(ProjectError::Conflict);
        }
    }
    chapter::Entity::delete_many()
        .filter(chapter::Column::ProjectId.eq(&p.id))
        .exec(tx)
        .await
        .map_err(db_error)?;
    volume::Entity::delete_many()
        .filter(volume::Column::ProjectId.eq(&p.id))
        .exec(tx)
        .await
        .map_err(db_error)?;
    // Source metadata describes the current partition. Undo retains metadata and blob hashes;
    // historical runs retain source hashes rather than foreign keys to the current partition.
    source::Entity::delete_many()
        .filter(source::Column::ProjectId.eq(&p.id))
        .exec(tx)
        .await
        .map_err(db_error)?;
    for (i, s) in p.sources.iter().enumerate() {
        if let Some(old) = source::Entity::find_by_id(&s.id)
            .one(tx)
            .await
            .map_err(db_error)?
        {
            if old.project_id != p.id
                || old.text_sha256 != s.sha256
                || old.raw_sha256 != s.raw_sha256
            {
                return Err(ProjectError::Conflict);
            }
        } else {
            source::ActiveModel {
                id: Set(s.id.clone()),
                project_id: Set(p.id.clone()),
                ordinal: Set(i as i32),
                filename: Set(s.filename.clone()),
                encoding: Set(s.encoding.clone()),
                raw_sha256: Set(s.raw_sha256.clone()),
                raw_path: Set(format!("{}.raw", s.raw_sha256)),
                raw_bytes: Set(raw_sizes[i] as i64),
                text_sha256: Set(s.sha256.clone()),
                text_path: Set(format!("{}.txt", s.sha256)),
                text_bytes: Set(s.text.len() as i64),
            }
            .insert(tx)
            .await
            .map_err(db_error)?;
        }
    }
    for v in &p.volumes {
        volume::ActiveModel {
            id: Set(v.id.clone()),
            project_id: Set(p.id.clone()),
            source_id: Set(v.source_id.clone()),
            title: Set(v.title.clone()),
            line: Set(v.line as i32),
            manual: Set(v.manual),
        }
        .insert(tx)
        .await
        .map_err(db_error)?;
    }
    for (i, c) in p.chapters.iter().enumerate() {
        chapter::ActiveModel {
            id: Set(c.id.clone()),
            project_id: Set(p.id.clone()),
            source_id: Set(c.source_id.clone()),
            volume_id: Set(c.volume_id.clone()),
            title: Set(c.title.clone()),
            start: Set(c.start as i32),
            end: Set(c.end as i32),
            heading: Set(c.heading.map(|v| v as i32)),
            ordinal: Set(i as i32),
            predecessor_ids: Set(json(&c.predecessor_ids)?),
        }
        .insert(tx)
        .await
        .map_err(db_error)?;
    }
    project_edit_state::Entity::delete_by_id(&p.id)
        .exec(tx)
        .await
        .map_err(db_error)?;
    project_edit_state::ActiveModel {
        project_id: Set(p.id.clone()),
        version: Set(1),
        rules: Set(edit.rules.clone()),
        corrections: Set(json(&p.corrections)?),
        issues: Set(edit.issues.clone()),
        undo: Set(undo.clone()),
        single_chapter_sources: Set(edit.single_chapter_sources.clone()),
    }
    .insert(tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

pub(crate) async fn read(
    db: &DatabaseConnection,
    root: &Path,
    id: &str,
) -> Result<LocalProject, ProjectError> {
    // Read all rows under one snapshot, then perform file IO after releasing the transaction.
    let tx = db.begin().await.map_err(db_error)?;
    let p = project::Entity::find_by_id(id)
        .one(&tx)
        .await
        .map_err(db_error)?
        .ok_or(ProjectError::NotFound)?;
    let edit = project_edit_state::Entity::find_by_id(id)
        .one(&tx)
        .await
        .map_err(db_error)?
        .ok_or(ProjectError::InvalidProject)?;
    if edit.version != 1 {
        return Err(ProjectError::UnsupportedVersion);
    }
    let sources = source::Entity::find()
        .filter(source::Column::ProjectId.eq(id))
        .order_by_asc(source::Column::Ordinal)
        .all(&tx)
        .await
        .map_err(db_error)?;
    let chapters = chapter::Entity::find()
        .filter(chapter::Column::ProjectId.eq(id))
        .order_by_asc(chapter::Column::Ordinal)
        .all(&tx)
        .await
        .map_err(db_error)?;
    let volumes = volume::Entity::find()
        .filter(volume::Column::ProjectId.eq(id))
        .order_by_asc(volume::Column::Line)
        .all(&tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    let mut document = ProjectDocument::new(p.id, p.title, p.description);
    document.project.revision =
        u32::try_from(p.revision).map_err(|_| ProjectError::InvalidProject)?;
    for s in sources {
        let text = assets::text(root, &s.text_sha256)?;
        if text.len() as i64 != s.text_bytes {
            return Err(ProjectError::ChecksumMismatch);
        }
        document.project.sources.push(Source {
            id: s.id,
            filename: s.filename,
            encoding: s.encoding,
            raw_sha256: s.raw_sha256,
            sha256: s.text_sha256,
            text,
        });
    }
    document.project.chapters = chapters
        .into_iter()
        .map(|c| {
            Ok(Chapter {
                id: c.id,
                source_id: c.source_id,
                volume_id: c.volume_id,
                title: c.title,
                start: c.start as u32,
                end: c.end as u32,
                heading: c.heading.map(|v| v as u32),
                predecessor_ids: decode(c.predecessor_ids)?,
            })
        })
        .collect::<Result<_, ProjectError>>()?;
    document.project.volumes = volumes
        .into_iter()
        .map(|v| Volume {
            id: v.id,
            source_id: v.source_id,
            title: v.title,
            line: v.line as u32,
            manual: v.manual,
        })
        .collect();
    document.project.corrections = decode(edit.corrections)?;
    document.validate_draft()?;
    let undo = decode_undo(root, edit.undo)?;
    if undo
        .as_ref()
        .is_some_and(|u| u.document.project.id != document.project.id)
    {
        return Err(ProjectError::InvalidProject);
    }
    Ok(LocalProject {
        document,
        edit: EditState {
            rules: edit.rules,
            issues: edit.issues,
            undo,
            single_chapter_sources: edit.single_chapter_sources,
        },
    })
}

#[cfg(test)]
mod tests;
