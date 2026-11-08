//! Analysis persistence mapping. Application invariants live in chapter_analysis.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "analysis_candidates")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub chapter_id: String,
    pub version_id: String,
    pub base_version_id: Option<String>,
    pub base_revision: i32,
    pub content: Json,
    pub status: String,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "version_id", to = "id")]
    pub analysis_version: BelongsTo<super::analysis_version::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
