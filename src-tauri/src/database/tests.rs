use super::*;
use sea_orm::{ConnectionTrait, DbBackend, Statement};

async fn execute(db: &DatabaseConnection, sql: &str) -> Result<(), sea_orm::DbErr> {
    db.execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
        .await?;
    Ok(())
}

async fn fixture() -> (tempfile::TempDir, DatabaseConnection) {
    let root = tempfile::tempdir().unwrap();
    let db = open(&root.path().join("test.sqlite3")).await.unwrap();
    execute(&db, "INSERT INTO projects VALUES ('p', 'Title', '', 1, 'importing', '1', '1'), ('other', 'Other', '', 1, 'importing', '1', '1')").await.unwrap();
    (root, db)
}

async fn session(db: &DatabaseConnection, id: &str) {
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "INSERT INTO ai_sessions VALUES (?, 'p', NULL, 'chapter_splitting', '', '{}', '{}', 0, '1', '1')",
        [id.into()],
    )).await.unwrap();
}

async fn run(
    db: &DatabaseConnection,
    id: &str,
    session: &str,
    request: &str,
    status: &str,
) -> Result<(), sea_orm::DbErr> {
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "INSERT INTO ai_runs VALUES (?, ?, 'user', ?, 'hash', NULL, ?, '{}', 1, '{}', '{}', NULL, 0, NULL, 0, NULL, false, NULL, '1', NULL)",
        [id.into(), session.into(), request.into(), status.into()],
    )).await?;
    Ok(())
}

#[tokio::test]
async fn initialization_is_idempotent_and_persistent() {
    let (root, db) = fixture().await;
    schema::initialize(&db).await.unwrap();
    let row = db
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA foreign_keys",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.try_get::<i32>("", "foreign_keys").unwrap(), 1);
    let row = db
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA journal_mode",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.try_get::<String>("", "journal_mode").unwrap(), "wal");
    db.close().await.unwrap();
    let reopened = open(&root.path().join("test.sqlite3")).await.unwrap();
    let row = reopened
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS n FROM projects",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.try_get::<i64>("", "n").unwrap(), 2);
}

#[tokio::test]
async fn foreign_keys_reject_cross_project_sources() {
    let (_root, db) = fixture().await;
    execute(&db, "INSERT INTO sources VALUES ('s', 'p', 0, 'novel.txt', 'utf-8', 'hash', 'raw', 1, 'hash', 'text', 1)").await.unwrap();
    assert!(
        execute(
            &db,
            "INSERT INTO chapters VALUES ('c', 'other', 's', NULL, 'Chapter', 0, 1, NULL, 0, '[]')"
        )
        .await
        .is_err()
    );
    execute(
        &db,
        "INSERT INTO chapters VALUES ('c', 'p', 's', NULL, 'Chapter', 0, 1, NULL, 0, '[]')",
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn active_runs_and_request_ids_are_unique() {
    let (_root, db) = fixture().await;
    session(&db, "s").await;
    run(&db, "r1", "s", "q1", "queued").await.unwrap();
    assert!(run(&db, "r2", "s", "q2", "running").await.is_err());
    execute(&db, "UPDATE ai_runs SET status = 'failed' WHERE id = 'r1'")
        .await
        .unwrap();
    assert!(run(&db, "r2", "s", "q1", "queued").await.is_err());
    run(&db, "r2", "s", "q2", "queued").await.unwrap();
}

#[tokio::test]
async fn message_order_and_run_scope_are_enforced() {
    let (_root, db) = fixture().await;
    session(&db, "s1").await;
    session(&db, "s2").await;
    run(&db, "r", "s1", "q", "queued").await.unwrap();
    assert!(execute(&db, "INSERT INTO ai_messages VALUES ('m', 's2', 'r', 0, 'assistant', 1, '[]', 'complete', NULL, '1')").await.is_err());
    execute(&db, "INSERT INTO ai_messages VALUES ('m', 's1', 'r', 0, 'assistant', 1, '[]', 'complete', NULL, '1')").await.unwrap();
    assert!(execute(&db, "INSERT INTO ai_messages VALUES ('m2', 's1', NULL, 0, 'user', 1, '[]', 'complete', NULL, '1')").await.is_err());
}

#[tokio::test]
async fn unknown_schema_is_rejected_without_resetting_data() {
    let (root, db) = fixture().await;
    execute(&db, "PRAGMA user_version = 999").await.unwrap();
    db.close().await.unwrap();
    assert!(open(&root.path().join("test.sqlite3")).await.is_err());
    let options = SqliteConnectOptions::new().filename(root.path().join("test.sqlite3"));
    let pool = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .unwrap();
    let raw = DatabaseConnection::from(pool);
    let row = raw
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS n FROM projects",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.try_get::<i64>("", "n").unwrap(), 2);
}
