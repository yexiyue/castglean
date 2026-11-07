//! Database mapping for volumes; business validation belongs to its owning module.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "volumes")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub source_id: String,
    pub title: String,
    pub line: i32,
    pub manual: bool,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "(source_id, project_id)", to = "(id, project_id)")]
    pub source: BelongsTo<super::source::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
