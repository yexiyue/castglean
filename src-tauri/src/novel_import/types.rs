//! Small UI snapshots; source text is fetched by bounded ranges, never copied per chapter.
use super::detection::{HeadingRule, ImportIssue};
use crate::project::{Chapter, Correction, Source, Volume};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceInfo {
    pub id: String,
    pub filename: String,
    pub encoding: String,
    pub sha256: String,
    pub bytes: u32,
    pub lines: u32,
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
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportSnapshot {
    pub id: String,
    pub title: String,
    pub description: String,
    pub revision: u32,
    pub sources: Vec<SourceInfo>,
    pub chapters: Vec<Chapter>,
    pub volumes: Vec<Volume>,
    pub corrections: Vec<Correction>,
    pub rules: Vec<HeadingRule>,
    pub issues: Vec<ImportIssue>,
    pub filename: Option<String>,
    pub can_undo: bool,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePreview {
    pub id: String,
    pub filename: String,
    pub encoding: String,
    pub bytes: u32,
    pub samples: Vec<String>,
}
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
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum DraftEdit {
    Info {
        title: String,
        description: String,
    },
    Boundary {
        correction: Correction,
    },
    Rules {
        rules: Vec<HeadingRule>,
    },
    Volume {
        source_id: String,
        line: u32,
        title: String,
    },
    Undo,
}
