//! Database mapping for sources; business validation belongs to its owning module.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "sources")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub ordinal: i32,
    pub filename: String,
    pub encoding: String,
    pub raw_sha256: String,
    pub raw_path: String,
    pub raw_bytes: i64,
    pub text_sha256: String,
    pub text_path: String,
    pub text_bytes: i64,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
