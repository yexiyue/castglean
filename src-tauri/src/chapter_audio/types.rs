//! Chapter audio DTOs; engine and library types never leak here.
use crate::chapter_analysis::ByteRange;
use serde::Serialize;

/// Why generation cannot start yet. Aggregated per kind (and per target for
/// binding-level kinds); `count` is the number of affected segments/targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChapterAudioBlockerKind {
    NoAnalysis,
    UnknownAttribution,
    AmbiguousAttribution,
    MissingBinding,
    VoiceNotPreset,
    MixedCombos,
    VoiceMissing,
    ResourceNotReady,
    AnalysisInvalid,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterAudioBlocker {
    pub kind: ChapterAudioBlockerKind,
    pub count: u32,
    /// Line of the first occurrence inside the chapter (0-based).
    pub line: u32,
    pub range: Option<ByteRange>,
    pub segment_id: Option<String>,
    pub character_id: Option<String>,
    pub character_name: Option<String>,
    /// Machine-free context such as the involved combination identity.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterAudioPlanSummary {
    pub backend: String,
    pub model: String,
    pub unit_count: u32,
    pub narration_units: u32,
    pub character_count: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterAudioCheck {
    pub ready: bool,
    pub blockers: Vec<ChapterAudioBlocker>,
    pub plan: Option<ChapterAudioPlanSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChapterAudioStatus {
    Queued,
    Running,
    Cancelling,
    Cancelled,
    Failed,
    Interrupted,
    Succeeded,
}

impl ChapterAudioStatus {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "queued" => Self::Queued,
            "running" => Self::Running,
            "cancelling" => Self::Cancelling,
            "cancelled" => Self::Cancelled,
            "failed" => Self::Failed,
            "interrupted" => Self::Interrupted,
            "succeeded" => Self::Succeeded,
            _ => return None,
        })
    }
    /// A run that the host may still act upon (cancel or execute).
    pub(crate) fn active(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::Cancelling)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChapterAudioUnitStatus {
    Pending,
    Done,
    Failed,
    Empty,
}

impl ChapterAudioUnitStatus {
    pub(crate) fn parse(value: &str) -> Self {
        match value {
            "done" => Self::Done,
            "failed" => Self::Failed,
            "empty" => Self::Empty,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterAudioRunView {
    pub id: String,
    pub project_id: String,
    pub chapter_id: String,
    pub chapter_title: String,
    pub status: ChapterAudioStatus,
    /// queued | loading | generating | concatenating | finished
    pub stage: String,
    pub backend: String,
    pub model: String,
    pub device: String,
    pub analysis_version_id: String,
    pub unit_count: u32,
    pub completed_units: u32,
    pub revision: u32,
    pub current_index: Option<u32>,
    pub failed_index: Option<u32>,
    pub error: Option<String>,
    pub final_media_id: Option<String>,
    pub final_duration_ms: Option<f64>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterAudioUnitView {
    pub index: u32,
    pub range: ByteRange,
    pub line: u32,
    pub segment_id: String,
    /// narrator | character
    pub target_kind: String,
    pub character_id: Option<String>,
    pub character_name: Option<String>,
    pub voice: String,
    pub status: ChapterAudioUnitStatus,
    pub media_id: Option<String>,
    pub duration_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterAudioStatusView {
    pub run: ChapterAudioRunView,
    pub units: Vec<ChapterAudioUnitView>,
    pub arrangement: super::arrangement::Arrangement,
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
pub(crate) struct ChapterAudioUpdate(pub ChapterAudioRunView);

/// Domain errors, named for stable IPC classification.
#[derive(Debug, Clone, PartialEq, thiserror::Error, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChapterAudioError {
    #[error("chapter_audio_not_found")]
    NotFound,
    #[error("chapter_audio_conflict")]
    Conflict,
    #[error("chapter_audio_busy")]
    Busy,
    #[error("chapter_audio_read_failed")]
    ReadFailed,
    #[error("chapter_audio_write_failed")]
    WriteFailed,
    #[error("chapter_audio_invalid_data")]
    InvalidData,
    #[error("chapter_audio_blocked")]
    Blocked { blockers: Vec<ChapterAudioBlocker> },
}
