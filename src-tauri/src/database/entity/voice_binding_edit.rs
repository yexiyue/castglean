//! Voice binding audit mapping. Application invariants live in voice_binding.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "voice_binding_edits")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub binding_id: String,
    pub operation: String,
    pub revision: i32,
    pub before: Option<Json>,
    pub after: Option<Json>,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "binding_id", to = "id")]
    pub voice_binding: BelongsTo<super::voice_binding::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
