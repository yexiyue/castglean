//! Chapter audio unit persistence mapping. Application invariants live in chapter_audio.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "chapter_audio_units")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub run_id: String,
    /// Zero-based order within the run; concatenated ranges partition the chapter.
    pub index: i32,
    pub segment_id: String,
    pub range_start: i32,
    pub range_end: i32,
    /// Zero-based source line of the unit start, for locating without rereading text.
    pub line: i32,
    /// narrator | character
    pub target_kind: String,
    /// Empty for the narrator target.
    pub character_id: String,
    /// Resolved preset voice id at plan time.
    pub voice: String,
    /// pending | running | done | failed | empty
    pub status: String,
    pub media_id: Option<String>,
    pub duration_ms: Option<f64>,
    pub error: Option<String>,
    /// 稳定失败码之外的引擎/IO 详情，仅用于诊断，不进入界面。
    pub error_detail: Option<String>,
    #[sea_orm(belongs_to, from = "run_id", to = "id")]
    pub run: BelongsTo<super::chapter_audio_run::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
