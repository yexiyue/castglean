//! Chapter audio run persistence mapping. Application invariants live in chapter_audio.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "chapter_audio_runs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub chapter_id: String,
    pub analysis_version_id: String,
    pub source_sha256: String,
    pub backend: String,
    pub model: String,
    pub device: String,
    /// 文本处理与引擎语义版本；旧任务未知时不能跨版本续跑。
    pub text_semantics: Option<String>,
    /// queued | running | cancelling | cancelled | failed | interrupted | succeeded
    pub status: String,
    /// queued | loading | generating | concatenating | finished
    pub stage: String,
    pub unit_count: i32,
    pub completed_units: i32,
    pub failed_index: Option<i32>,
    pub error: Option<String>,
    /// 稳定失败码之外的引擎/IO 详情，仅用于诊断，不进入界面。
    pub error_detail: Option<String>,
    pub final_media_id: Option<String>,
    pub final_duration_ms: Option<f64>,
    pub created_at: String,
    pub finished_at: Option<String>,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
