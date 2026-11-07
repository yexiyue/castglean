//! Database mapping for ai_sessions; business validation belongs to its owning module.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "ai_sessions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub chapter_id: Option<String>,
    pub task_kind: String,
    pub title: String,
    pub configuration: Json,
    pub budget: Json,
    pub next_sequence: i64,
    pub created_at: String,
    pub updated_at: String,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
