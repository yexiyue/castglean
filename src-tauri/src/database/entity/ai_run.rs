//! Database mapping for ai_runs; business validation belongs to its owning module.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "ai_runs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub session_id: String,
    pub trigger_message_id: String,
    pub request_id: String,
    pub request_hash: String,
    pub retry_of: Option<String>,
    pub status: String,
    pub configuration: Json,
    pub base_revision: i32,
    pub source_hashes: Json,
    pub budget: Json,
    pub checkpoint: Option<Json>,
    pub dispatch_after: i64,
    pub dispatched_at: Option<i64>,
    pub generation: i64,
    pub owner_instance: Option<String>,
    pub cancel_requested: bool,
    pub error: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
    #[sea_orm(belongs_to, from = "session_id", to = "id")]
    pub session: BelongsTo<super::ai_session::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
