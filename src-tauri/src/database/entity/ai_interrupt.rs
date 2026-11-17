//! Durable human-input requests; consumption shares the next run's transaction.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "ai_interrupts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub session_id: String,
    pub run_id: String,
    pub invocation_id: Option<String>,
    pub request: Json,
    pub consumed_by: Option<String>,
    pub response: Option<Json>,
    #[sea_orm(belongs_to, from = "session_id", to = "id")]
    pub session: BelongsTo<super::ai_session::Entity>,
    #[sea_orm(belongs_to, from = "run_id", to = "id")]
    pub run: BelongsTo<super::ai_run::Entity>,
}
impl ActiveModelBehavior for ActiveModel {}
