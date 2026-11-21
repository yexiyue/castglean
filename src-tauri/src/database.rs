//! Application database connection and entity-first schema initialization.
pub(crate) mod entity;
mod reset;
mod schema;
pub(crate) use reset::archive_incompatible;
#[cfg(test)]
mod tests;

use apalis_sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sea_orm::DatabaseConnection;
use std::{path::Path, time::Duration};
use tauri::Manager;

const DATABASE_FILE: &str = "castglean.sqlite3";

#[derive(Debug, thiserror::Error)]
#[error("unsupported database schema version: {version}")]
pub(crate) struct UnsupportedSchema {
    pub(crate) version: i64,
}

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
    if let Err(error) = schema::initialize(&db).await {
        db.close().await?;
        return Err(error);
    }
    Ok(db)
}

pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let root = crate::storage::data(app);
    let started = std::time::Instant::now();
    let db = tauri::async_runtime::block_on(open(&root.join(DATABASE_FILE)))?;
    let version = tauri::async_runtime::block_on(async {
        use sea_orm::{ConnectionTrait, Statement};
        db.query_one_raw(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "PRAGMA user_version",
        ))
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<i64>("", "user_version").ok())
        .unwrap_or(0)
    });
    tracing::info!(
        event = "database_ready",
        schema = version,
        duration_ms = started.elapsed().as_millis() as u64,
    );
    app.manage(db);
    Ok(())
}
