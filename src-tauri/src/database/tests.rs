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
        "INSERT INTO ai_runs VALUES (?, ?, 'user', ?, 'hash', NULL, ?, '{}', 1, '{}', '{}', NULL, NULL, 0, NULL, 0, NULL, false, NULL, '1', NULL)",
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

#[tokio::test]
async fn current_schema_enforces_chapter_audio_constraints() {
    let (_root, db) = fixture().await;
    assert!(
        execute(
            &db,
            "INSERT INTO chapter_audio_runs (id, project_id, chapter_id, analysis_version_id, \
             source_sha256, backend, model, device, status, stage, unit_count, completed_units, \
             failed_index, error, error_detail, final_media_id, final_duration_ms, created_at, \
             finished_at, revision, current_index) VALUES ('r1', 'p', 'c', 'v', 'sha', 'kokoro', '1.1-zh', 'cpu', \
             'succeeded', 'finished', 1, 1, NULL, NULL, NULL, NULL, NULL, '1', NULL, 0, NULL)"
        )
        .await
        .is_ok(),
        "run row shape matches the entity"
    );
    for (id, ok) in [("u1", true), ("u2", false)] {
        let result = execute(
            &db,
            &format!(
                "INSERT INTO chapter_audio_units (id, run_id, \"index\", segment_id, \
                 range_start, range_end, line, target_kind, character_id, voice, status, \
                 media_id, duration_ms, error, error_detail) VALUES ('{id}', 'r1', 0, 's', \
                 0, 3, 0, 'narrator', '', 'zf_001', 'done', NULL, NULL, NULL, NULL)"
            ),
        )
        .await;
        assert_eq!(result.is_ok(), ok, "unit order is unique within a run");
    }
    let active = |id: &str, status: &str| {
        format!(
            "INSERT INTO chapter_audio_runs VALUES ('{id}', 'p', 'c', 'v', 'sha', 'kokoro', \
             '1.1-zh', 'cpu', NULL, '{status}', 'queued', 1, 0, 0, NULL, NULL, NULL, NULL, NULL, NULL, \
             '1', NULL)"
        )
    };
    assert!(execute(&db, &active("r2", "queued")).await.is_ok());
    assert!(
        execute(&db, &active("r3", "running")).await.is_err(),
        "at most one active run exists at a time"
    );
    let version = db
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA user_version",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(version.try_get::<i64>("", "user_version").unwrap(), 8);
}

#[tokio::test]
async fn older_schema_versions_are_rejected_without_rewriting() {
    for version in 1..7 {
        let (root, db) = fixture().await;
        execute(&db, &format!("PRAGMA user_version = {version}"))
            .await
            .unwrap();
        db.close().await.unwrap();
        assert!(open(&root.path().join("test.sqlite3")).await.is_err());
        let options = SqliteConnectOptions::new().filename(root.path().join("test.sqlite3"));
        let raw = DatabaseConnection::from(
            SqlitePoolOptions::new()
                .connect_with(options)
                .await
                .unwrap(),
        );
        let row = raw
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "PRAGMA user_version",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "user_version").unwrap(), version);
    }
}

#[tokio::test]
async fn initialization_failure_rolls_back_all_schema_changes() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("test.sqlite3");
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true);
    let raw = DatabaseConnection::from(
        SqlitePoolOptions::new()
            .connect_with(options)
            .await
            .unwrap(),
    );
    execute(&raw, "CREATE TABLE marker (value TEXT)")
        .await
        .unwrap();
    execute(&raw, "CREATE INDEX source_order ON marker(value)")
        .await
        .unwrap();
    raw.close().await.unwrap();

    assert!(open(&path).await.is_err());
    let options = SqliteConnectOptions::new().filename(&path);
    let raw = DatabaseConnection::from(
        SqlitePoolOptions::new()
            .connect_with(options)
            .await
            .unwrap(),
    );
    let tables = raw
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('marker', 'projects')",
        ))
        .await
        .unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].try_get::<String>("", "name").unwrap(), "marker");
}

#[tokio::test]
async fn schema_seven_migrates_without_removing_projects_and_failure_rolls_back() {
    let (_root, db) = fixture().await;
    execute(&db, "DROP TABLE chapter_audio_arrangements")
        .await
        .unwrap();
    execute(&db, "ALTER TABLE chapter_audio_runs DROP COLUMN revision")
        .await
        .unwrap();
    execute(
        &db,
        "ALTER TABLE chapter_audio_runs DROP COLUMN current_index",
    )
    .await
    .unwrap();
    execute(&db, "PRAGMA user_version = 7").await.unwrap();
    schema::initialize(&db).await.unwrap();
    let row = db
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS n FROM projects",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.try_get::<i64>("", "n").unwrap(), 2);
    // 模拟中途迁移失败：同名表已存在，不得保留部分 ALTER。
    execute(&db, "ALTER TABLE chapter_audio_runs DROP COLUMN revision")
        .await
        .unwrap();
    execute(
        &db,
        "ALTER TABLE chapter_audio_runs DROP COLUMN current_index",
    )
    .await
    .unwrap();
    execute(&db, "PRAGMA user_version = 7").await.unwrap();
    assert!(schema::initialize(&db).await.is_err());
    assert!(
        execute(&db, "SELECT revision FROM chapter_audio_runs")
            .await
            .is_err()
    );
}
