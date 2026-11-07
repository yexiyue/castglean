//! Database mapping for project_edit_state; business validation belongs to its owning module.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "project_edit_state")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub project_id: String,
    pub version: i32,
    pub rules: Json,
    pub corrections: Json,
    pub issues: Json,
    pub undo: Option<Json>,
    pub single_chapter_sources: Json,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
