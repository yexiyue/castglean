//! Queue infrastructure; application run state remains authoritative in the application tables.
use apalis_sqlite::SqliteStorage;
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use tauri::Manager;
mod runtime;
pub(crate) use runtime::Runtime;

/// The application has one AI runtime owner. A second process must not interpret
/// a live owner's runs as interrupted during startup recovery.
struct RuntimeOwner {
    _lock: File,
    id: String,
}

fn acquire_owner(root: &Path) -> anyhow::Result<RuntimeOwner> {
    let lock = File::options()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("ai-runtime.lock"))?;
    match lock.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => anyhow::bail!("AI runtime already has an owner"),
        Err(std::fs::TryLockError::Error(error)) => return Err(error.into()),
    }
    Ok(RuntimeOwner {
        _lock: lock,
        id: uuid::Uuid::new_v4().to_string(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RunJob {
    pub run_id: String,
}

async fn setup(db: &DatabaseConnection) -> anyhow::Result<()> {
    // The app owns pool pragmas. SqliteStorage::setup additionally sets
    // synchronous=OFF on a shared connection, so use its schema migrator only.
    SqliteStorage::migrations()
        .run(db.get_sqlite_connection_pool())
        .await?;
    Ok(())
}

pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let root = app.path().app_data_dir()?;
    let owner = acquire_owner(&root)?;
    let db = app.state::<DatabaseConnection>();
    tauri::async_runtime::block_on(setup(db.inner()))?;
    tauri::async_runtime::block_on(crate::ai::runs::interrupt_previous(db.inner(), &owner.id))?;
    let queue = SqliteStorage::<RunJob>::new(db.get_sqlite_connection_pool());
    let runtime = Runtime::new(
        owner,
        db.inner().clone(),
        root.join("project-sources"),
        app.state::<std::sync::Arc<crate::llm::LlmState>>()
            .inner()
            .clone(),
    );
    app.manage(runtime.clone());
    app.manage(runtime.stream());
    runtime::start(runtime, queue);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};

    #[tokio::test]
    async fn queue_schema_preserves_pragmas_on_every_shared_pool_connection() {
        let root = tempfile::tempdir().unwrap();
        let db = crate::database::open(&root.path().join("app.sqlite3"))
            .await
            .unwrap();
        setup(&db).await.unwrap();
        setup(&db).await.unwrap();
        let mut connections = Vec::new();
        for _ in 0..4 {
            connections.push(db.begin().await.unwrap());
        }
        for connection in connections {
            for (pragma, expected) in [
                ("foreign_keys", 1),
                ("synchronous", 1),
                ("busy_timeout", 5000),
            ] {
                let row = connection
                    .query_one_raw(Statement::from_string(
                        DbBackend::Sqlite,
                        format!("PRAGMA {pragma}"),
                    ))
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(
                    row.try_get_by_index::<i32>(0).unwrap(),
                    expected,
                    "{pragma}"
                );
            }
            let row = connection
                .query_one_raw(Statement::from_string(
                    DbBackend::Sqlite,
                    "PRAGMA journal_mode",
                ))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(row.try_get_by_index::<String>(0).unwrap(), "wal");
            connection.rollback().await.unwrap();
        }
    }
    #[test]
    fn a_live_runtime_owner_prevents_a_second_startup_recovery() {
        let root = tempfile::tempdir().unwrap();
        let owner = acquire_owner(root.path()).unwrap();
        let first = owner.id.clone();
        assert!(acquire_owner(root.path()).is_err());
        drop(owner);
        assert_ne!(acquire_owner(root.path()).unwrap().id, first);
    }
}
