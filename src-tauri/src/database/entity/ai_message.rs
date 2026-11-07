//! Database mapping for ai_messages; business validation belongs to its owning module.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "ai_messages")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub session_id: String,
    pub run_id: Option<String>,
    pub ordinal: i64,
    pub role: String,
    pub version: i32,
    pub parts: crate::ai::messages::MessageParts,
    pub status: String,
    pub usage: Option<Json>,
    pub created_at: String,
    #[sea_orm(belongs_to, from = "session_id", to = "id")]
    pub session: BelongsTo<super::ai_session::Entity>,
    #[sea_orm(belongs_to, from = "(run_id, session_id)", to = "(id, session_id)")]
    pub run: BelongsTo<Option<super::ai_run::Entity>>,
}

impl ActiveModelBehavior for ActiveModel {}
