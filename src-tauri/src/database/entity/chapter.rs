//! Database mapping for chapters; business validation belongs to its owning module.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "chapters")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub source_id: String,
    pub volume_id: Option<String>,
    pub title: String,
    pub start: i32,
    pub end: i32,
    pub heading: Option<i32>,
    pub ordinal: i32,
    pub predecessor_ids: Json,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "(source_id, project_id)", to = "(id, project_id)")]
    pub source: BelongsTo<super::source::Entity>,
    #[sea_orm(belongs_to, from = "(volume_id, source_id)", to = "(id, source_id)")]
    pub volume: BelongsTo<Option<super::volume::Entity>>,
}

impl ActiveModelBehavior for ActiveModel {}
