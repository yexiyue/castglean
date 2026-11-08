//! Read-only version history survives chapter boundary changes and pointer edits.
use super::{query, source, types::*, validation};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VersionCursor {
    pub created_at: String,
    pub id: String,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VersionSummary {
    pub id: String,
    pub chapter_id: String,
    pub source: SourceBinding,
    pub created_at: String,
    pub segment_count: u32,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VersionPage {
    pub versions: Vec<VersionSummary>,
    pub next: Option<VersionCursor>,
}

pub(crate) async fn list(
    db: &impl ConnectionTrait,
    project_id: &str,
    after: Option<VersionCursor>,
) -> Result<VersionPage, AnalysisError> {
    if after
        .as_ref()
        .is_some_and(|c| c.created_at.len() > 64 || c.id.len() > 128)
    {
        return Err(AnalysisError::InvalidData);
    }
    let stamp = after.as_ref().map(|c| c.created_at.clone());
    let id = after.as_ref().map(|c| c.id.clone());
    let rows=db.query_all_raw(Statement::from_sql_and_values(DbBackend::Sqlite,"SELECT id,chapter_id,created_at,json_extract(content,'$.dependencies.source') AS source,json_array_length(content,'$.segments') AS segments FROM analysis_versions WHERE project_id=? AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 31",vec![project_id.into(),stamp.clone().into(),stamp.clone().into(),stamp.into(),id.into()])).await?;
    let more = rows.len() > 30;
    let mut versions = Vec::new();
    for row in rows.into_iter().take(30) {
        let source: SourceBinding = serde_json::from_str(&row.try_get::<String>("", "source")?)
            .map_err(|_| AnalysisError::InvalidData)?;
        let chapter_id: String = row.try_get("", "chapter_id")?;
        if source.project_id != project_id || source.chapter_id != chapter_id {
            return Err(AnalysisError::InvalidData);
        }
        versions.push(VersionSummary {
            id: row.try_get("", "id")?,
            chapter_id,
            created_at: row.try_get("", "created_at")?,
            segment_count: row
                .try_get::<i64>("", "segments")?
                .try_into()
                .map_err(|_| AnalysisError::InvalidData)?,
            source,
        });
    }
    let next = if more {
        versions.last().map(|v| VersionCursor {
            created_at: v.created_at.clone(),
            id: v.id.clone(),
        })
    } else {
        None
    };
    Ok(VersionPage { versions, next })
}

pub(crate) async fn excerpt(
    db: &impl ConnectionTrait,
    root: &Path,
    project_id: &str,
    version_id: &str,
    range: ByteRange,
) -> Result<query::Excerpt, AnalysisError> {
    let version = query::version(db, project_id, version_id).await?;
    let binding = &version.dependencies.source;
    let text = query::read_text(root, binding)?;
    if !validation::range_valid(&text, binding, &range) {
        return Err(AnalysisError::InvalidData);
    }
    let mut end = range.end.min(range.start.saturating_add(8192)) as usize;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    Ok(query::Excerpt {
        range: ByteRange {
            start: range.start,
            end: end as u32,
        },
        line: source::line_at(&text, range.start),
        text: text[range.start as usize..end].into(),
        truncated: end < range.end as usize,
    })
}
