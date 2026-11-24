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
    pub analysis_version_id: Option<String>,
    pub mode: String,
    pub source_id: String,
    pub source_sha256: String,
    pub backend: String,
    pub model: String,
    pub device: String,
    /// 文本处理与引擎语义版本，续跑时必须一致。
    pub text_semantics: String,
    /// queued | running | cancelling | cancelled | failed | interrupted | succeeded
    pub status: String,
    /// queued | loading | generating | concatenating | finished
    pub stage: String,
    pub unit_count: i32,
    pub completed_units: i32,
    pub revision: i32,
    pub current_index: Option<i32>,
    pub failed_index: Option<i32>,
    pub error: Option<String>,
    /// 稳定失败码之外的引擎/IO 详情，仅用于诊断，不进入界面。
    pub error_detail: Option<String>,
    pub final_media_id: Option<String>,
    pub final_duration_ms: Option<f64>,
    pub created_at: String,
    pub finished_at: Option<String>,
    /// 沿用来源任务；整章生成或没有可沿用单元时为空。
    #[sea_orm(column_type = "Text", nullable)]
    pub parent_run_id: Option<String>,
    /// 直接沿用来源任务音频的已完成单元数，不含空白单元。
    #[sea_orm(default_value = 0)]
    pub inherited_units: i32,
    /// 派生时因锚定边界消失而未继承的停顿数。
    #[sea_orm(default_value = 0)]
    pub dropped_pauses: i32,
    /// 实际重新合成的单元下标（JSON 数组）；沿用与空白单元不在其中。
    #[sea_orm(default_value = "[]")]
    pub redo_indexes: String,
    /// generation | redo | retake
    #[sea_orm(default_value = "generation")]
    pub kind: String,
    /// none | adopted | pending | rejected；每章每种制作方式至多一个 adopted。
    #[sea_orm(default_value = "none")]
    pub adoption: String,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
