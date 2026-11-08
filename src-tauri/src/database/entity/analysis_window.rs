//! Analysis persistence mapping. Application invariants live in chapter_analysis.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "analysis_windows")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub input_id: String,
    pub ordinal: i32,
    pub content: Json,
    pub status: String,
    #[sea_orm(belongs_to, from = "input_id", to = "id")]
    pub analysis_input: BelongsTo<super::analysis_input::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
