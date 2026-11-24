//! Chapter audio DTOs; engine and library types never leak here.
use crate::chapter_analysis::ByteRange;
use serde::Serialize;

/// Why generation cannot start yet. Aggregated per kind (and per target for
/// binding-level kinds); `count` is the number of affected segments/targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChapterAudioMode {
    Narrator,
    MultiRole,
}

impl ChapterAudioMode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Narrator => "narrator",
            Self::MultiRole => "multi_role",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, ChapterAudioError> {
        match value {
            "narrator" => Ok(Self::Narrator),
            "multi_role" => Ok(Self::MultiRole),
            _ => Err(ChapterAudioError::InvalidData),
        }
    }
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ChapterAudioInput {
    Narrator {
        voice: Option<crate::voice_binding::VoiceRef>,
    },
    MultiRole,
}

/// 发起意图。续跑只接受冻结输入一致；新建可指定沿用来源；重录只重做指定单元。
#[derive(serde::Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ChapterAudioStart {
    Resume { run_id: String },
    Fresh { inherit_from: Option<String> },
    Retake { run_id: String, units: Vec<u32> },
}

/// 任务种类：整章生成、按当前计划局部重做、同输入重录。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChapterAudioKind {
    Generation,
    Redo,
    Retake,
}

impl ChapterAudioKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Generation => "generation",
            Self::Redo => "redo",
            Self::Retake => "retake",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, ChapterAudioError> {
        match value {
            "generation" => Ok(Self::Generation),
            "redo" => Ok(Self::Redo),
            "retake" => Ok(Self::Retake),
            _ => Err(ChapterAudioError::InvalidData),
        }
    }
}

/// 版本采用状态。每章每种制作方式至多一个 `Adopted`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChapterAudioAdoption {
    None,
    Adopted,
    Pending,
    Rejected,
}

impl ChapterAudioAdoption {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Adopted => "adopted",
            Self::Pending => "pending",
            Self::Rejected => "rejected",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, ChapterAudioError> {
        match value {
            "none" => Ok(Self::None),
            "adopted" => Ok(Self::Adopted),
            "pending" => Ok(Self::Pending),
            "rejected" => Ok(Self::Rejected),
            _ => Err(ChapterAudioError::InvalidData),
        }
    }
}

/// 给定沿用来源时的重做范围；数量不含空白单元。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterAudioRedo {
    pub inheritable_units: u32,
    pub redo_units: u32,
    pub redo_indexes: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChapterAudioBlockerKind {
    NoAnalysis,
    UnknownAttribution,
    UnassignedAttribution,
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
    /// 仅在给出沿用来源且计划就绪时返回。
    pub redo: Option<ChapterAudioRedo>,
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
    pub mode: ChapterAudioMode,
    pub analysis_version_id: Option<String>,
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
    pub kind: ChapterAudioKind,
    pub adoption: ChapterAudioAdoption,
    pub parent_run_id: Option<String>,
    pub inherited_units: u32,
    pub dropped_pauses: u32,
    /// 实际重新合成的单元下标。
    pub redo_indexes: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChapterAudioTaskView {
    pub run: ChapterAudioRunView,
    pub preview_unit_index: Option<u32>,
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
