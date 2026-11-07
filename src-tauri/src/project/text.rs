//! Bounded source reads use the database-owned hash, never a caller-supplied path.
use super::{ProjectError, assets};
use sea_orm::{DatabaseConnection, EntityTrait};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextLine {
    pub line: u32,
    pub start: u32,
    pub end: u32,
    pub text: String,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextPage {
    pub source_id: String,
    pub sha256: String,
    pub lines: Vec<TextLine>,
    pub next_line: Option<u32>,
}

pub(crate) async fn read(
    db: &DatabaseConnection,
    root: &Path,
    id: &str,
    source_id: &str,
    line: u32,
    count: u32,
) -> Result<TextPage, ProjectError> {
    if count == 0 || count > 100 {
        return Err(ProjectError::TooLarge);
    }
    let row = crate::database::entity::source::Entity::find_by_id(source_id)
        .one(db)
        .await
        .map_err(|_| ProjectError::ReadFailed)?
        .filter(|s| s.project_id == id)
        .ok_or(ProjectError::NotFound)?;
    let text = assets::text(root, &row.text_sha256)?;
    if text.len() as i64 != row.text_bytes {
        return Err(ProjectError::ChecksumMismatch);
    }
    let source = super::Source {
        id: row.id,
        filename: row.filename,
        encoding: row.encoding,
        raw_sha256: row.raw_sha256,
        sha256: row.text_sha256,
        text,
    };
    page(&source, line, count)
}

pub(crate) fn page(
    source: &super::Source,
    line: u32,
    count: u32,
) -> Result<TextPage, ProjectError> {
    if count == 0 || count > 100 {
        return Err(ProjectError::TooLarge);
    }
    let ranges = super::line_ranges(&source.text);
    if line as usize >= ranges.len() {
        return Err(ProjectError::NotFound);
    }
    let mut lines = Vec::new();
    let mut bytes = 0;
    for (i, &(a, b)) in ranges
        .iter()
        .enumerate()
        .skip(line as usize)
        .take(count as usize)
    {
        if b - a > 8192 {
            return Err(ProjectError::TooLarge);
        }
        if bytes + (b - a) > 8192 {
            break;
        }
        bytes += b - a;
        lines.push(TextLine {
            line: i as u32,
            start: a,
            end: b,
            text: source.text[a as usize..b as usize].into(),
        });
    }
    let next = line + lines.len() as u32;
    Ok(TextPage {
        source_id: source.id.clone(),
        sha256: source.sha256.clone(),
        lines,
        next_line: (next < ranges.len() as u32).then_some(next),
    })
}
