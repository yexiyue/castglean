//! Durable professional-agent invocation facts, independent of UI subscription.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "ai_invocations")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub run_id: String,
    pub session_id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub message_id: Option<String>,
    pub status: String,
    pub error: Option<String>,
    #[sea_orm(belongs_to, from = "run_id", to = "id")]
    pub run: BelongsTo<super::ai_run::Entity>,
    #[sea_orm(belongs_to, from = "session_id", to = "id")]
    pub session: BelongsTo<super::ai_session::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
