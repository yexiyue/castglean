//! Analysis persistence mapping. Application invariants live in chapter_analysis.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "analysis_states")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub current_version_id: String,
    pub revision: i32,
    pub human_revision: i32,
    pub last_edit_id: Option<String>,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "current_version_id", to = "id")]
    pub analysis_version: BelongsTo<super::analysis_version::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
