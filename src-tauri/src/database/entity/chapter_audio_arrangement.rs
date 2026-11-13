//! Independent editing revision; synthesis products remain immutable.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "chapter_audio_arrangements")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub revision: i32,
    pub content: String,
    pub previous_content: Option<String>,
    #[sea_orm(belongs_to, from = "id", to = "id")]
    pub run: BelongsTo<super::chapter_audio_run::Entity>,
}
impl ActiveModelBehavior for ActiveModel {}
