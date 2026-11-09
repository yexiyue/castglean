//! Project-scoped reads return metadata or bounded annotations, never full novel bodies.
use super::{types::*, validation};
use crate::database::entity::{
    analysis_candidate, analysis_state, analysis_version, chapter, character, source,
};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use std::path::Path;

impl From<sea_orm::DbErr> for AnalysisError {
    fn from(_: sea_orm::DbErr) -> Self {
        Self::ReadFailed
    }
}

pub(crate) async fn binding(
    db: &impl ConnectionTrait,
    project_id: &str,
    chapter_id: &str,
) -> Result<SourceBinding, AnalysisError> {
    let c = chapter::Entity::find_by_id(chapter_id)
        .one(db)
        .await?
        .filter(|c| c.project_id == project_id)
        .ok_or(AnalysisError::NotFound)?;
    let s = source::Entity::find_by_id(&c.source_id)
        .one(db)
        .await?
        .filter(|s| s.project_id == project_id)
        .ok_or(AnalysisError::InvalidData)?;
    Ok(SourceBinding {
        project_id: project_id.into(),
        chapter_id: chapter_id.into(),
        source_id: c.source_id,
        sha256: s.text_sha256,
        start: c.start.try_into().map_err(|_| AnalysisError::InvalidData)?,
        end: c.end.try_into().map_err(|_| AnalysisError::InvalidData)?,
    })
}

pub(crate) fn read_text(root: &Path, binding: &SourceBinding) -> Result<String, AnalysisError> {
    crate::project::source_asset_text(root, &binding.sha256)
        .map_err(|_| AnalysisError::SourceChanged)
}

/// Read and verify immutable source bytes before acquiring a SQLite writer slot.
/// Callers must compare this binding with the authoritative binding under the lock.
pub(crate) async fn prepare_text(
    db: &sea_orm::DatabaseConnection,
    root: &Path,
    project_id: &str,
    chapter_id: &str,
) -> Result<(SourceBinding, String), AnalysisError> {
    let source = binding(db, project_id, chapter_id).await?;
    let text = read_text(root, &source)?;
    Ok((source, text))
}

pub(crate) async fn characters(
    db: &impl ConnectionTrait,
    project_id: &str,
) -> Result<Vec<Character>, AnalysisError> {
    character::Entity::find()
        .filter(character::Column::ProjectId.eq(project_id))
        .order_by_asc(character::Column::Id)
        .all(db)
        .await?
        .into_iter()
        .map(|row| {
            let c: Character =
                serde_json::from_value(row.content).map_err(|_| AnalysisError::InvalidData)?;
            if c.project_id != project_id
                || c.id != row.id
                || c.revision != row.revision as u32
                || c.display_name != row.display_name
                || serde_json::to_value(c.status)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_owned))
                    .as_deref()
                    != Some(row.status.as_str())
            {
                return Err(AnalysisError::InvalidData);
            }
            Ok(c)
        })
        .collect()
}

pub(crate) async fn version(
    db: &impl ConnectionTrait,
    project_id: &str,
    id: &str,
) -> Result<AnalysisVersion, AnalysisError> {
    let row = analysis_version::Entity::find_by_id(id)
        .one(db)
        .await?
        .filter(|v| v.project_id == project_id)
        .ok_or(AnalysisError::NotFound)?;
    let v: AnalysisVersion =
        serde_json::from_value(row.content).map_err(|_| AnalysisError::InvalidData)?;
    if v.format_version != 1
        || v.id != row.id
        || v.dependencies.source.project_id != project_id
        || v.dependencies.source.chapter_id != row.chapter_id
    {
        return Err(AnalysisError::InvalidData);
    }
    Ok(v)
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisSnapshot {
    pub binding: SourceBinding,
    pub revision: u32,
    pub human_revision: u32,
    pub version_id: Option<String>,
    pub stale: bool,
    pub segment_count: u32,
    pub unreviewed_count: u32,
    pub candidate_ids: Vec<String>,
    pub can_undo: bool,
}

pub(crate) async fn snapshot(
    db: &impl ConnectionTrait,
    root: &Path,
    project_id: &str,
    chapter_id: &str,
) -> Result<AnalysisSnapshot, AnalysisError> {
    let binding = binding(db, project_id, chapter_id).await?;
    let text = read_text(root, &binding)?;
    let state = analysis_state::Entity::find_by_id(chapter_id)
        .one(db)
        .await?
        .filter(|s| s.project_id == project_id);
    let mut snapshot = AnalysisSnapshot {
        binding,
        revision: 0,
        human_revision: 0,
        version_id: None,
        stale: false,
        segment_count: 0,
        unreviewed_count: 0,
        candidate_ids: vec![],
        can_undo: false,
    };
    if let Some(state) = state {
        let v = version(db, project_id, &state.current_version_id).await?;
        snapshot.stale = v.dependencies.source != snapshot.binding;
        // Historical versions must still be structurally valid over their bound source.
        if !snapshot.stale {
            validation::validate(&v, &text, &characters(db, project_id).await?)?;
        }
        snapshot.revision = state
            .revision
            .try_into()
            .map_err(|_| AnalysisError::InvalidData)?;
        snapshot.human_revision = state
            .human_revision
            .try_into()
            .map_err(|_| AnalysisError::InvalidData)?;
        snapshot.segment_count = v.segments.len() as u32;
        snapshot.unreviewed_count = v
            .segments
            .iter()
            .filter(|s| s.review == ReviewStatus::Unreviewed)
            .count() as u32;
        snapshot.version_id = Some(v.id);
        snapshot.can_undo = state.last_edit_id.is_some() && !snapshot.stale;
    }
    snapshot.candidate_ids = analysis_candidate::Entity::find()
        .filter(analysis_candidate::Column::ProjectId.eq(project_id))
        .filter(analysis_candidate::Column::ChapterId.eq(chapter_id))
        .filter(analysis_candidate::Column::Status.eq("pending"))
        .order_by_asc(analysis_candidate::Column::Id)
        .all(db)
        .await?
        .into_iter()
        .map(|c| c.id)
        .collect();
    Ok(snapshot)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SegmentPage {
    pub segments: Vec<Segment>,
    pub next_start: Option<u32>,
}

pub(crate) async fn segments(
    db: &impl ConnectionTrait,
    root: &Path,
    project_id: &str,
    version_id: &str,
    range: ByteRange,
    after: Option<u32>,
) -> Result<SegmentPage, AnalysisError> {
    let v = version(db, project_id, version_id).await?;
    let text = read_text(root, &v.dependencies.source)?;
    if !validation::range_valid(&text, &v.dependencies.source, &range) {
        return Err(AnalysisError::InvalidData);
    }
    let mut segments: Vec<_> = v
        .segments
        .into_iter()
        .filter(|s| {
            s.range.start < range.end
                && s.range.end > range.start
                && after.is_none_or(|start| s.range.start > start)
        })
        .take(501)
        .collect();
    let more = segments.len() > 500;
    if more {
        segments.pop();
    }
    let next_start = if more {
        segments.last().map(|s| s.range.start)
    } else {
        None
    };
    Ok(SegmentPage {
        segments,
        next_start,
    })
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectorySummary {
    pub chapter_id: String,
    pub version_id: String,
    pub revision: u32,
    pub segment_count: u32,
    pub unreviewed_count: u32,
    pub stale: bool,
}
/// Aggregate in SQLite: directory navigation never loads all annotation documents into React.
pub(crate) async fn directory(
    db: &impl ConnectionTrait,
    project_id: &str,
) -> Result<Vec<DirectorySummary>, AnalysisError> {
    let rows=db.query_all_raw(sea_orm::Statement::from_sql_and_values(sea_orm::DbBackend::Sqlite,
        "SELECT s.id AS chapter_id, s.current_version_id AS version_id, s.revision, json_array_length(v.content, '$.segments') AS segment_count, (SELECT COUNT(*) FROM json_each(v.content, '$.segments') j WHERE json_extract(j.value, '$.review')='unreviewed') AS unreviewed_count, CASE WHEN c.id IS NULL OR c.start != json_extract(v.content, '$.dependencies.source.start') OR c.end != json_extract(v.content, '$.dependencies.source.end') OR c.source_id != json_extract(v.content, '$.dependencies.source.sourceId') OR src.text_sha256 != json_extract(v.content, '$.dependencies.source.sha256') THEN 1 ELSE 0 END AS stale FROM analysis_states s JOIN analysis_versions v ON v.id=s.current_version_id LEFT JOIN chapters c ON c.id=s.id AND c.project_id=s.project_id LEFT JOIN sources src ON src.id=c.source_id WHERE s.project_id=? ORDER BY c.ordinal", [project_id.into()])).await?;
    rows.into_iter()
        .map(|r| {
            Ok(DirectorySummary {
                chapter_id: r.try_get("", "chapter_id")?,
                version_id: r.try_get("", "version_id")?,
                revision: r
                    .try_get::<i32>("", "revision")?
                    .try_into()
                    .map_err(|_| AnalysisError::InvalidData)?,
                segment_count: r
                    .try_get::<i64>("", "segment_count")?
                    .try_into()
                    .map_err(|_| AnalysisError::InvalidData)?,
                unreviewed_count: r
                    .try_get::<i64>("", "unreviewed_count")?
                    .try_into()
                    .map_err(|_| AnalysisError::InvalidData)?,
                stale: r.try_get::<i32>("", "stale")? != 0,
            })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Excerpt {
    pub range: ByteRange,
    pub text: String,
    pub line: u32,
    pub truncated: bool,
}
pub(crate) async fn excerpt(
    db: &impl ConnectionTrait,
    root: &Path,
    project_id: &str,
    chapter_id: &str,
    range: ByteRange,
) -> Result<Excerpt, AnalysisError> {
    let binding = binding(db, project_id, chapter_id).await?;
    let text = read_text(root, &binding)?;
    if !validation::range_valid(&text, &binding, &range) {
        return Err(AnalysisError::InvalidData);
    }
    let mut end = range.end.min(range.start.saturating_add(8192)) as usize;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    Ok(Excerpt {
        range: ByteRange {
            start: range.start,
            end: end as u32,
        },
        text: text[range.start as usize..end].into(),
        line: super::source::line_at(&text, range.start),
        truncated: end < range.end as usize,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IssueCursor {
    pub chapter_ordinal: u32,
    pub start: u32,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Issue {
    pub chapter_id: String,
    pub version_id: String,
    pub segment: Segment,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IssuePage {
    pub issues: Vec<Issue>,
    pub next: Option<IssueCursor>,
}
/// Cursor paging over matching current annotations only; this never starts analysis.
/// Numeric search terms are one-based source lines; remaining text retains substring matching.
pub(crate) async fn issues(
    db: &impl ConnectionTrait,
    root: &Path,
    project_id: &str,
    chapter_id: Option<&str>,
    after: Option<IssueCursor>,
    query: &str,
) -> Result<IssuePage, AnalysisError> {
    if query.chars().count() > 200 {
        return Err(AnalysisError::InvalidData);
    }
    let mut lines = Vec::new();
    let mut words = Vec::new();
    for term in query.split_whitespace() {
        if term.bytes().all(|b| b.is_ascii_digit()) {
            lines.push(
                term.parse::<u32>()
                    .map_err(|_| AnalysisError::InvalidData)?,
            );
        } else {
            words.push(term);
        }
    }
    let text_query = words.join(" ");
    let (mut ordinal, mut start) = after.as_ref().map_or((-1_i64, -1_i64), |c| {
        (i64::from(c.chapter_ordinal), i64::from(c.start))
    });
    // Reuse the most recent immutable source across rows and scan batches without
    // retaining the whole book. Never turn a missing/corrupt source into no matches.
    let mut source_hash = String::new();
    let mut source_text = String::new();
    let mut source_lines = Vec::new();
    let mut result = Vec::new();
    let mut last = None;
    loop {
        let rows=db.query_all_raw(sea_orm::Statement::from_sql_and_values(sea_orm::DbBackend::Sqlite,
            "SELECT c.id AS chapter_id, c.ordinal AS chapter_ordinal, c.source_id, c.start AS chapter_start, c.end AS chapter_end, src.text_sha256, v.id AS version_id, j.value AS segment FROM analysis_states s JOIN chapters c ON c.id=s.id AND c.project_id=s.project_id JOIN sources src ON src.id=c.source_id JOIN analysis_versions v ON v.id=s.current_version_id JOIN json_each(v.content, '$.segments') j WHERE s.project_id=? AND (? IS NULL OR c.id=?) AND c.start=json_extract(v.content, '$.dependencies.source.start') AND c.end=json_extract(v.content, '$.dependencies.source.end') AND c.source_id=json_extract(v.content, '$.dependencies.source.sourceId') AND src.text_sha256=json_extract(v.content, '$.dependencies.source.sha256') AND json_extract(j.value,'$.review')='unreviewed' AND (?='' OR instr(lower(c.title || ' ' || COALESCE(json_extract(j.value,'$.reason'),'') || ' ' || json_extract(j.value,'$.attribution.state') || ' ' || json_extract(j.value,'$.kind')),lower(?))>0) AND (c.ordinal>? OR (c.ordinal=? AND json_extract(j.value,'$.range.start')>?)) ORDER BY c.ordinal,json_extract(j.value,'$.range.start') LIMIT 101",
            vec![project_id.into(),chapter_id.map(str::to_owned).into(),chapter_id.map(str::to_owned).into(),text_query.clone().into(),text_query.clone().into(),ordinal.into(),ordinal.into(),start.into()])).await?;
        let exhausted = rows.len() < 101;
        for row in rows {
            let segment: Segment = serde_json::from_str(&row.try_get::<String>("", "segment")?)
                .map_err(|_| AnalysisError::InvalidData)?;
            ordinal = i64::from(row.try_get::<i32>("", "chapter_ordinal")?);
            start = i64::from(segment.range.start);
            if !lines.is_empty() {
                let binding = SourceBinding {
                    project_id: project_id.into(),
                    chapter_id: row.try_get("", "chapter_id")?,
                    source_id: row.try_get("", "source_id")?,
                    sha256: row.try_get("", "text_sha256")?,
                    start: row
                        .try_get::<i32>("", "chapter_start")?
                        .try_into()
                        .map_err(|_| AnalysisError::InvalidData)?,
                    end: row
                        .try_get::<i32>("", "chapter_end")?
                        .try_into()
                        .map_err(|_| AnalysisError::InvalidData)?,
                };
                if source_hash != binding.sha256 {
                    // Release the previous source before allocating the next one.
                    drop(std::mem::take(&mut source_text));
                    drop(std::mem::take(&mut source_lines));
                    source_text = read_text(root, &binding)?;
                    source_lines = crate::project::line_ranges(&source_text);
                    source_hash.clone_from(&binding.sha256);
                }
                if !validation::range_valid(&source_text, &binding, &segment.range) {
                    return Err(AnalysisError::InvalidData);
                }
                // Match every line touched by the half-open range, including a
                // continuation line of a multi-line segment, never the next line.
                let first =
                    source_lines.partition_point(|(_, end)| *end <= segment.range.start) + 1;
                let last = source_lines.partition_point(|(_, end)| *end < segment.range.end) + 1;
                if !lines
                    .iter()
                    .all(|line| first <= *line as usize && *line as usize <= last)
                {
                    continue;
                }
            }
            if result.len() == 100 {
                return Ok(IssuePage {
                    issues: result,
                    next: last,
                });
            }
            last = Some(IssueCursor {
                chapter_ordinal: ordinal.try_into().map_err(|_| AnalysisError::InvalidData)?,
                start: segment.range.start,
            });
            result.push(Issue {
                chapter_id: row.try_get("", "chapter_id")?,
                version_id: row.try_get("", "version_id")?,
                segment,
            });
        }
        if exhausted {
            return Ok(IssuePage {
                issues: result,
                next: None,
            });
        }
    }
}

/// Bounded annotation context for the project assistant; no source text is duplicated.
pub(crate) async fn inspect(
    db: &impl sea_orm::ConnectionTrait,
    project_id: &str,
    chapter_id: &str,
    page: u32,
) -> Result<serde_json::Value, AnalysisError> {
    if page > 100_000 {
        return Err(AnalysisError::CapacityExceeded);
    }
    let source = binding(db, project_id, chapter_id).await?;
    let Some(state) = super::store::state(db, project_id, chapter_id).await? else {
        return Ok(serde_json::json!({"chapter_id":chapter_id,"status":"not_analyzed"}));
    };
    let version = version(db, project_id, &state.current_version_id).await?;
    let value = serde_json::json!({"chapter_id":chapter_id,"stale":version.dependencies.source != source,
        "revision":state.revision,"segments":version.segments.iter().skip(page as usize * 5).take(5).collect::<Vec<_>>(),
        "next_page":((page as usize + 1) * 5 < version.segments.len()).then_some(page + 1),
        "characters":characters(db, project_id).await?.iter().map(|c| serde_json::json!({"id":c.id,"name":c.display_name,"status":c.status})).take(30).collect::<Vec<_>>()});
    if serde_json::to_vec(&value)
        .map_err(|_| AnalysisError::InvalidData)?
        .len()
        > 16 * 1024
    {
        return Err(AnalysisError::CapacityExceeded);
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn line_issue_fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
        let (root, db, mut project) = crate::project::test_support::fixture().await;
        let mut text = String::from("\u{feff}前言\r\n");
        let chapter_start = text.len() as u32;
        let mut annotations = Vec::new();
        for index in 0..251 {
            let start = text.len() as u32;
            if index < 120 {
                text.push('甲');
                if index == 119 {
                    text.push_str("\r\n");
                }
            } else if index < 250 {
                text.push_str("乙😀");
                if index == 249 {
                    text.push_str("\n尾\r");
                }
            } else {
                text.push('终');
            }
            let range = ByteRange {
                start,
                end: text.len() as u32,
            };
            annotations.push(Segment {
                id: format!("s{index}"),
                range: range.clone(),
                kind: if (120..250).contains(&index) {
                    SegmentKind::Speech
                } else {
                    SegmentKind::Narration
                },
                attribution: if (120..250).contains(&index) {
                    Attribution::Unknown
                } else {
                    Attribution::Narrator
                },
                review: ReviewStatus::Unreviewed,
                evidence: vec![Evidence {
                    range,
                    reason: "证据".into(),
                }],
                reason: if (120..250).contains(&index) {
                    "待复核"
                } else {
                    "叙述"
                }
                .into(),
            });
        }
        let source = &mut project.document.project.sources[0];
        source.text = text.clone();
        source.sha256 = crate::project::hash(text.as_bytes());
        source.raw_sha256 = source.sha256.clone();
        crate::project::publish_source(root.path(), source, text.as_bytes()).unwrap();
        let split = annotations[120].range.start;
        let chapter = &mut project.document.project.chapters[0];
        chapter.start = chapter_start;
        chapter.end = split;
        // Keep full source coverage, including the prefix, as required by project storage.
        let mut prefix = chapter.clone();
        prefix.id = "prefix".into();
        prefix.start = 0;
        prefix.end = chapter_start;
        let mut second = chapter.clone();
        second.id = "second".into();
        second.title = "目标章".into();
        second.start = split;
        second.end = text.len() as u32;
        project.document.project.chapters.insert(0, prefix);
        project.document.project.chapters.push(second);
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        for (chapter, segments) in [
            ("chapter", annotations[..120].to_vec()),
            ("second", annotations[120..].to_vec()),
        ] {
            let version = AnalysisVersion {
                format_version: 1,
                id: format!("v-{chapter}"),
                parent_id: None,
                run_id: None,
                dependencies: Dependencies {
                    source: binding(&db, "project", chapter).await.unwrap(),
                    analysis_revision: 0,
                    human_revision: 0,
                    characters: vec![],
                    contexts: vec![],
                },
                segments,
                protections: vec![],
            };
            let tx = sea_orm::TransactionTrait::begin(&db).await.unwrap();
            super::super::store::insert_version(&tx, &version, &text)
                .await
                .unwrap();
            super::super::store::set_current(&tx, &version, 0, false, None)
                .await
                .unwrap();
            tx.commit().await.unwrap();
        }
        (root, db)
    }

    #[tokio::test]
    async fn issue_line_search_filters_before_paging_and_combines_with_type_and_text() {
        let (root, db) = line_issue_fixture().await;
        // Matching annotations begin after a full scan batch. Text/type filters
        // and numeric source lines must apply before the 100 matching-row limit.
        for query in ["3", "3 speech", "3 待复核", "speech 3", "待复核"] {
            let first = issues(&db, root.path(), "project", None, None, query)
                .await
                .unwrap();
            assert_eq!(first.issues.len(), 100, "{query}");
            assert_eq!(first.issues[0].segment.id, "s120", "{query}");
            let cursor = first.next.unwrap();
            assert_eq!(
                cursor.start,
                first.issues.last().unwrap().segment.range.start
            );
            let second = issues(&db, root.path(), "project", None, Some(cursor), query)
                .await
                .unwrap();
            assert_eq!(second.issues.len(), 30, "{query}");
            assert_eq!(second.issues[0].segment.id, "s220", "{query}");
            assert_eq!(second.issues.last().unwrap().segment.id, "s249", "{query}");
            assert!(second.next.is_none(), "{query}");
        }
        assert!(
            issues(&db, root.path(), "project", None, None, "3 narration")
                .await
                .unwrap()
                .issues
                .is_empty()
        );
        assert!(
            issues(&db, root.path(), "project", Some("chapter"), None, "3")
                .await
                .unwrap()
                .issues
                .is_empty()
        );
        assert_eq!(
            issues(
                &db,
                root.path(),
                "project",
                Some("second"),
                None,
                "3 目标章"
            )
            .await
            .unwrap()
            .issues
            .len(),
            100
        );
    }

    #[tokio::test]
    async fn issue_lines_use_absolute_source_ranges_and_half_open_unicode_boundaries() {
        let (root, db) = line_issue_fixture().await;
        // BOM/CRLF prefix is line one; the first analyzed chapter starts at line two.
        assert!(
            issues(&db, root.path(), "project", None, None, "1")
                .await
                .unwrap()
                .issues
                .is_empty()
        );
        let line_two = issues(&db, root.path(), "project", None, None, "2")
            .await
            .unwrap();
        assert_eq!(line_two.issues[0].segment.id, "s0");
        let line_four = issues(&db, root.path(), "project", None, None, "4")
            .await
            .unwrap();
        assert_eq!(line_four.issues.len(), 1);
        assert_eq!(line_four.issues[0].segment.id, "s249");
        // A multi-line speech segment ends immediately before line five.
        let line_five = issues(&db, root.path(), "project", None, None, "5")
            .await
            .unwrap();
        assert_eq!(line_five.issues.len(), 1);
        assert_eq!(line_five.issues[0].segment.id, "s250");
        assert!(line_five.next.is_none());
        assert!(
            issues(&db, root.path(), "project", None, None, "999")
                .await
                .unwrap()
                .issues
                .is_empty()
        );
    }

    #[tokio::test]
    async fn issue_line_search_reports_missing_or_corrupt_sources_and_database_failure() {
        let (root, db) = line_issue_fixture().await;
        let source = binding(&db, "project", "chapter").await.unwrap();
        let path = root.path().join(format!("{}.txt", source.sha256));
        let original = std::fs::read(&path).unwrap();
        std::fs::write(&path, "损坏").unwrap();
        assert_eq!(
            issues(&db, root.path(), "project", None, None, "3")
                .await
                .unwrap_err(),
            AnalysisError::SourceChanged
        );
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            issues(&db, root.path(), "project", None, None, "3")
                .await
                .unwrap_err(),
            AnalysisError::SourceChanged
        );
        std::fs::write(path, original).unwrap();
        db.execute_unprepared("DROP TABLE analysis_states")
            .await
            .unwrap();
        assert_eq!(
            issues(&db, root.path(), "project", None, None, "3")
                .await
                .unwrap_err(),
            AnalysisError::ReadFailed
        );
    }

    #[tokio::test]
    async fn large_annotation_and_issue_queries_are_paged_without_source_bodies() {
        let (root, db, mut project) = crate::project::test_support::fixture().await;
        let text = "甲".repeat(1100);
        let source = &mut project.document.project.sources[0];
        source.text = text.clone();
        source.sha256 = crate::project::hash(text.as_bytes());
        source.raw_sha256 = source.sha256.clone();
        crate::project::publish_source(root.path(), source, text.as_bytes()).unwrap();
        project.document.project.chapters[0].end = text.len() as u32;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        let source = binding(&db, "project", "chapter").await.unwrap();
        let annotations = (0..1100)
            .map(|i| Segment {
                id: format!("s{i}"),
                range: ByteRange {
                    start: i * 3,
                    end: (i + 1) * 3,
                },
                kind: SegmentKind::Narration,
                attribution: Attribution::Narrator,
                review: ReviewStatus::Unreviewed,
                evidence: vec![Evidence {
                    range: ByteRange {
                        start: i * 3,
                        end: (i + 1) * 3,
                    },
                    reason: "证据".into(),
                }],
                reason: "旁白".into(),
            })
            .collect();
        let v = AnalysisVersion {
            format_version: 1,
            id: "version".into(),
            parent_id: None,
            run_id: None,
            dependencies: Dependencies {
                source: source.clone(),
                analysis_revision: 0,
                human_revision: 0,
                characters: vec![],
                contexts: vec![],
            },
            segments: annotations,
            protections: vec![],
        };
        let tx = sea_orm::TransactionTrait::begin(&db).await.unwrap();
        super::super::store::insert_version(&tx, &v, &text)
            .await
            .unwrap();
        super::super::store::set_current(&tx, &v, 0, false, None)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let mut after = None;
        let mut count = 0;
        loop {
            let page = segments(
                &db,
                root.path(),
                "project",
                "version",
                ByteRange {
                    start: 0,
                    end: text.len() as u32,
                },
                after,
            )
            .await
            .unwrap();
            assert!(page.segments.len() <= 500);
            count += page.segments.len();
            after = page.next_start;
            if after.is_none() {
                break;
            }
        }
        assert_eq!(count, 1100);
        let mut cursor = None;
        let mut count = 0;
        loop {
            let page = issues(&db, root.path(), "project", None, cursor, "")
                .await
                .unwrap();
            assert!(page.issues.len() <= 100);
            count += page.issues.len();
            cursor = page.next;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(count, 1100);
        assert!(
            issues(&db, root.path(), "other", None, None, "")
                .await
                .unwrap()
                .issues
                .is_empty()
        );
        let summary = directory(&db, "project").await.unwrap();
        assert_eq!(summary[0].unreviewed_count, 1100);
        assert!(!serde_json::to_string(&summary).unwrap().contains(&text));
        // Historical versions remain readable when the current chapter is removed.
        for index in 0..32 {
            let mut historical = v.clone();
            historical.id = format!("history-{index:02}");
            super::super::store::insert_version(&db, &historical, &text)
                .await
                .unwrap();
        }
        project.document.project.chapters[0].id = "replacement-chapter".into();
        let previous_revision = project.document.project.revision;
        project.document.project.revision += 1;
        crate::project::store::save(&db, root.path(), &project, Some(previous_revision))
            .await
            .unwrap();
        let page = super::super::history::list(&db, "project", None)
            .await
            .unwrap();
        assert_eq!(page.versions.len(), 30);
        let second = super::super::history::list(&db, "project", page.next)
            .await
            .unwrap();
        assert_eq!(second.versions.len(), 3);
        assert!(second.next.is_none());
        let mut ids: std::collections::HashSet<_> = page.versions.iter().map(|v| &v.id).collect();
        ids.extend(second.versions.iter().map(|v| &v.id));
        assert_eq!(ids.len(), 33);
        assert!(
            super::super::history::list(&db, "other", None)
                .await
                .unwrap()
                .versions
                .is_empty()
        );
        let excerpt = super::super::history::excerpt(
            &db,
            root.path(),
            "project",
            "version",
            ByteRange { start: 0, end: 3 },
        )
        .await
        .unwrap();
        assert_eq!(excerpt.text, "甲");
        assert_eq!(
            super::super::history::excerpt(
                &db,
                root.path(),
                "other",
                "version",
                ByteRange { start: 0, end: 3 }
            )
            .await
            .unwrap_err(),
            AnalysisError::NotFound
        );
        std::fs::write(root.path().join(format!("{}.txt", source.sha256)), "损坏").unwrap();
        assert_eq!(
            super::super::history::excerpt(
                &db,
                root.path(),
                "project",
                "version",
                ByteRange { start: 0, end: 3 }
            )
            .await
            .unwrap_err(),
            AnalysisError::SourceChanged
        );
    }
}
