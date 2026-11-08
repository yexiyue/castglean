//! Analysis persistence mapping. Application invariants live in chapter_analysis.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "character_aliases")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub character_id: String,
    pub name: String,
    pub content: Json,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "character_id", to = "id")]
    pub character: BelongsTo<super::character::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
