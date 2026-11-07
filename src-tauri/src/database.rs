//! Application database connection and entity-first schema initialization.
pub(crate) mod entity;
mod schema;
#[cfg(test)]
mod tests;

use apalis_sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sea_orm::DatabaseConnection;
use std::{path::Path, time::Duration};
use tauri::Manager;

pub(crate) async fn open(path: &Path) -> anyhow::Result<DatabaseConnection> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode("wal".parse()?)
        .synchronous("normal".parse()?)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;
    let db = DatabaseConnection::from(pool);
    schema::initialize(&db).await?;
    Ok(db)
}

pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let root = app.path().app_data_dir()?;
    std::fs::create_dir_all(&root)?;
    let db = tauri::async_runtime::block_on(open(&root.join("castglean.sqlite3")))?;
    app.manage(db);
    Ok(())
}
