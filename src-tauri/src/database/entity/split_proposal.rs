//! Database mapping for split_proposals; business validation belongs to its owning module.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "split_proposals")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub run_id: String,
    pub base_revision: i32,
    pub source_hashes: Json,
    pub version: i32,
    pub content: Json,
    pub status: String,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "run_id", to = "id")]
    pub run: BelongsTo<super::ai_run::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
