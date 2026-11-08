//! Versioned stored contracts; deserialization is not application validation.
use serde::{Deserialize, Serialize};

/// Versioned diagnostic payloads are validated by their domain, never exposed as backend types.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisDiagnosticDocument {
    pub version: u32,
    #[specta(type = specta_typescript::Unknown)]
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceBinding {
    pub project_id: String,
    pub chapter_id: String,
    pub source_id: String,
    pub sha256: String,
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ByteRange {
    pub start: u32,
    pub end: u32,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SegmentKind {
    Narration,
    Speech,
    Thought,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReviewStatus {
    Unreviewed,
    Confirmed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Attribution {
    Narrator,
    Resolved { character_id: String },
    Unknown,
    Ambiguous { character_ids: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Evidence {
    pub range: ByteRange,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Segment {
    pub id: String,
    pub range: ByteRange,
    pub kind: SegmentKind,
    pub attribution: Attribution,
    pub review: ReviewStatus,
    pub evidence: Vec<Evidence>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CharacterRevision {
    pub id: String,
    pub revision: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ContextRevision {
    pub chapter_id: String,
    pub version_id: String,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Dependencies {
    pub source: SourceBinding,
    pub analysis_revision: u32,
    pub human_revision: u32,
    pub characters: Vec<CharacterRevision>,
    pub contexts: Vec<ContextRevision>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CharacterStatus {
    Candidate,
    Confirmed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Character {
    pub id: String,
    pub project_id: String,
    pub display_name: String,
    pub status: CharacterStatus,
    pub revision: u32,
    pub origin: SourceBinding,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProtectedField {
    Kind,
    Attribution,
    Boundary,
    Review,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Protection {
    pub range: ByteRange,
    pub fields: Vec<ProtectedField>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisVersion {
    pub format_version: u32,
    pub id: String,
    pub parent_id: Option<String>,
    pub run_id: Option<String>,
    pub dependencies: Dependencies,
    pub segments: Vec<Segment>,
    pub protections: Vec<Protection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AnalysisError {
    #[error("analysis_not_found")]
    NotFound,
    #[error("analysis_invalid_data")]
    InvalidData,
    #[error("analysis_source_changed")]
    SourceChanged,
    #[error("analysis_conflict")]
    Conflict,
    #[error("analysis_read_failed")]
    ReadFailed,
    #[error("analysis_write_failed")]
    WriteFailed,
    #[error("analysis_capacity_exceeded")]
    CapacityExceeded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredAlias {
    pub format_version: u32,
    pub source: SourceBinding,
    pub evidence: Evidence,
    pub confirmed: bool,
}
