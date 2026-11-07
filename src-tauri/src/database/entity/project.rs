//! Database mapping for projects; business validation belongs to its owning module.
use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "projects")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub title: String,
    pub description: String,
    pub revision: i32,
    pub stage: String,
    pub created_at: String,
    pub updated_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
