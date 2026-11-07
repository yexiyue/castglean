//! Metadata queries and frontend projections. Bodies stay in immutable source files.
use super::{ProjectError, Source, store::LocalProject};
use crate::novel_import::{HeadingRule, ImportIssue};
use sea_orm::{DatabaseConnection, EntityTrait, QueryOrder, QuerySelect, TransactionTrait};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct SourceInfo {
    id: String,
    filename: String,
    encoding: String,
    sha256: String,
    bytes: u32,
    lines: u32,
}
impl From<&Source> for SourceInfo {
    fn from(s: &Source) -> Self {
        Self {
            id: s.id.clone(),
            filename: s.filename.clone(),
            encoding: s.encoding.clone(),
            sha256: s.sha256.clone(),
            bytes: s.text.len() as u32,
            lines: crate::project::line_ranges(&s.text).len() as u32,
        }
    }
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProjectSnapshot {
    id: String,
    title: String,
    description: String,
    revision: u32,
    sources: Vec<SourceInfo>,
    chapters: Vec<super::Chapter>,
    volumes: Vec<super::Volume>,
    corrections: Vec<super::Correction>,
    rules: Vec<HeadingRule>,
    issues: Vec<ImportIssue>,
    can_undo: bool,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProjectListItem {
    id: String,
    title: String,
    description: String,
    revision: u32,
    source_count: u32,
    chapter_count: u32,
}
impl TryFrom<LocalProject> for LocalProjectSnapshot {
    type Error = ProjectError;
    fn try_from(state: LocalProject) -> Result<Self, Self::Error> {
        let p = state.document.project;
        Ok(Self {
            id: p.id,
            title: p.title,
            description: p.description,
            revision: p.revision,
            sources: p.sources.iter().map(SourceInfo::from).collect(),
            chapters: p.chapters,
            volumes: p.volumes,
            corrections: p.corrections,
            rules: serde_json::from_value(state.edit.rules)
                .map_err(|_| ProjectError::InvalidProject)?,
            issues: serde_json::from_value(state.edit.issues)
                .map_err(|_| ProjectError::InvalidProject)?,
            can_undo: state.edit.undo.is_some(),
        })
    }
}
#[derive(sea_orm::FromQueryResult)]
struct Count {
    project_id: String,
    count: i64,
}
fn counts(rows: Vec<Count>) -> Result<HashMap<String, u32>, ProjectError> {
    rows.into_iter()
        .map(|r| {
            Ok((
                r.project_id,
                r.count
                    .try_into()
                    .map_err(|_| ProjectError::InvalidProject)?,
            ))
        })
        .collect()
}
pub(crate) async fn list(
    db: &DatabaseConnection,
) -> Result<Vec<LocalProjectListItem>, ProjectError> {
    use crate::database::entity::{chapter, project, source};
    use sea_orm::sea_query::{Expr, ExprTrait};
    let tx = db.begin().await.map_err(|_| ProjectError::ReadFailed)?;
    let rows = project::Entity::find()
        .order_by_desc(project::Column::UpdatedAt)
        .all(&tx)
        .await
        .map_err(|_| ProjectError::ReadFailed)?;
    let sources = counts(
        source::Entity::find()
            .select_only()
            .column(source::Column::ProjectId)
            .column_as(Expr::col(source::Column::Id).count(), "count")
            .group_by(source::Column::ProjectId)
            .into_model::<Count>()
            .all(&tx)
            .await
            .map_err(|_| ProjectError::ReadFailed)?,
    )?;
    let chapters = counts(
        chapter::Entity::find()
            .select_only()
            .column(chapter::Column::ProjectId)
            .column_as(Expr::col(chapter::Column::Id).count(), "count")
            .group_by(chapter::Column::ProjectId)
            .into_model::<Count>()
            .all(&tx)
            .await
            .map_err(|_| ProjectError::ReadFailed)?,
    )?;
    tx.commit().await.map_err(|_| ProjectError::ReadFailed)?;
    rows.into_iter()
        .map(|r| {
            Ok(LocalProjectListItem {
                source_count: sources.get(&r.id).copied().unwrap_or(0),
                chapter_count: chapters.get(&r.id).copied().unwrap_or(0),
                id: r.id,
                title: r.title,
                description: r.description,
                revision: r
                    .revision
                    .try_into()
                    .map_err(|_| ProjectError::InvalidProject)?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{store, test_support::fixture};

    #[tokio::test]
    async fn metadata_list_never_scans_or_changes_old_files_and_does_not_read_bodies() {
        let (root, db, state) = fixture().await;
        store::save(&db, root.path(), &state, None).await.unwrap();
        let old = root
            .path()
            .join("chapter-imports")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("recovery.json"), "unreadable old data").unwrap();
        let portable = root.path().join("old.castglean");
        std::fs::write(&portable, "old portable data").unwrap();
        std::fs::write(
            root.path()
                .join(format!("{}.txt", state.document.project.sources[0].sha256)),
            "damaged body",
        )
        .unwrap();
        let rows = list(&db).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_count, 1);
        assert_eq!(rows[0].chapter_count, 1);
        assert_eq!(
            std::fs::read_to_string(old.join("recovery.json")).unwrap(),
            "unreadable old data"
        );
        assert_eq!(
            std::fs::read_to_string(portable).unwrap(),
            "old portable data"
        );
        assert!(store::read(&db, root.path(), "project").await.is_err());
    }

    #[tokio::test]
    async fn project_snapshot_contains_source_metadata_and_editing_state_without_full_body() {
        let (_root, _db, state) = fixture().await;
        let snapshot = LocalProjectSnapshot::try_from(state).unwrap();
        let wire = serde_json::to_value(snapshot).unwrap();
        assert!(wire.get("filename").is_none());
        assert!(wire["sources"][0].get("text").is_none());
        assert_eq!(wire["sources"][0]["filename"], "book.txt");
        assert!(wire["rules"].is_array());
        assert_eq!(wire["canUndo"], false);
    }
}
