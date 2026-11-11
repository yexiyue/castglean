use super::*;
use sea_orm::{ConnectionTrait, DbBackend, EntityTrait, Statement};

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
async fn v1_upgrade_preserves_projects_sources_chapters_and_ai_history() {
    let (root, db) = fixture().await;
    session(&db, "s").await;
    run(&db, "r", "s", "q", "failed").await.unwrap();
    execute(&db, "INSERT INTO sources VALUES ('source', 'p', 0, 'public.txt', 'utf-8', 'hash', 'raw', 1, 'hash', 'text', 1)").await.unwrap();
    execute(&db, "INSERT INTO chapters VALUES ('chapter', 'p', 'source', NULL, '第一章', 0, 1, NULL, 0, '[]')").await.unwrap();
    execute(&db, "INSERT INTO ai_messages VALUES ('m', 's', 'r', 0, 'assistant', 1, '[]', 'complete', NULL, '1')").await.unwrap();
    // Reconstruct the exact preceding schema, without touching application rows.
    for table in [
        "chapter_audio_units",
        "chapter_audio_runs",
        "analysis_candidates",
        "analysis_edits",
        "analysis_states",
        "analysis_windows",
        "analysis_inputs",
        "analysis_versions",
        "character_aliases",
        "characters",
        "casting_inputs",
        "casting_suggestions",
        "character_voice_profiles",
        "voice_binding_edits",
        "voice_bindings",
    ] {
        execute(&db, &format!("DROP TABLE {table}")).await.unwrap();
    }
    execute(&db, "ALTER TABLE ai_runs DROP COLUMN workspace_context")
        .await
        .unwrap();
    execute(&db, "PRAGMA user_version = 1").await.unwrap();
    db.close().await.unwrap();
    let upgraded = open(&root.path().join("test.sqlite3")).await.unwrap();
    for (table, expected) in [
        ("projects", 2),
        ("sources", 1),
        ("chapters", 1),
        ("ai_sessions", 1),
        ("ai_runs", 1),
        ("ai_messages", 1),
        ("analysis_versions", 0),
    ] {
        let row = upgraded
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("SELECT COUNT(*) AS n FROM {table}"),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "n").unwrap(), expected);
    }
    let version = upgraded
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA user_version",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(version.try_get::<i64>("", "user_version").unwrap(), 6);
}

#[tokio::test]
async fn migration_failure_rolls_back_ddl_and_version() {
    let (_root, db) = fixture().await;
    for table in [
        "chapter_audio_units",
        "chapter_audio_runs",
        "analysis_candidates",
        "analysis_edits",
        "analysis_states",
        "analysis_windows",
        "analysis_inputs",
        "analysis_versions",
        "character_aliases",
        "characters",
        "casting_inputs",
        "casting_suggestions",
        "character_voice_profiles",
        "voice_binding_edits",
        "voice_bindings",
    ] {
        execute(&db, &format!("DROP TABLE {table}")).await.unwrap();
    }
    execute(&db, "ALTER TABLE ai_runs DROP COLUMN workspace_context")
        .await
        .unwrap();
    execute(&db, "PRAGMA user_version = 1").await.unwrap();
    // Fail late, after table creation, by colliding with the migration's index.
    execute(&db, "CREATE INDEX analysis_window_order ON projects(title)")
        .await
        .unwrap();
    assert!(schema::initialize(&db).await.is_err());
    let version = db
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA user_version",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(version.try_get::<i64>("", "user_version").unwrap(), 1);
    let tables = db.query_one_raw(Statement::from_string(DbBackend::Sqlite, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'analysis_%'")).await.unwrap().unwrap();
    assert_eq!(tables.try_get::<i64>("", "n").unwrap(), 0);
    execute(&db, "DROP INDEX analysis_window_order")
        .await
        .unwrap();
    schema::initialize(&db).await.unwrap();
}

#[tokio::test]
async fn v3_upgrade_creates_binding_tables_and_enforces_target_uniqueness() {
    let (root, db) = fixture().await;
    execute(
        &db,
        "INSERT INTO characters VALUES ('ch', 'p', 'A', 'confirmed', 1, '{}')",
    )
    .await
    .unwrap();
    for table in [
        "chapter_audio_units",
        "chapter_audio_runs",
        "voice_bindings",
        "voice_binding_edits",
        "character_voice_profiles",
        "casting_inputs",
        "casting_suggestions",
    ] {
        execute(&db, &format!("DROP TABLE {table}")).await.unwrap();
    }
    execute(&db, "PRAGMA user_version = 3").await.unwrap();
    db.close().await.unwrap();
    let upgraded = open(&root.path().join("test.sqlite3")).await.unwrap();
    let preserved = upgraded
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS n FROM characters",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(preserved.try_get::<i64>("", "n").unwrap(), 1);
    execute(
        &upgraded,
        "INSERT INTO voice_bindings VALUES ('b1', 'p', 'narrator', '', 1, '{}')",
    )
    .await
    .unwrap();
    assert!(
        execute(
            &upgraded,
            "INSERT INTO voice_bindings VALUES ('b2', 'p', 'narrator', '', 1, '{}')"
        )
        .await
        .is_err(),
        "one binding row per target"
    );
    execute(
        &upgraded,
        "INSERT INTO voice_bindings VALUES ('b3', 'p', 'character', 'ch', 1, '{}')",
    )
    .await
    .unwrap();
    assert!(
        execute(
            &upgraded,
            "INSERT INTO voice_bindings VALUES ('b4', 'other', 'narrator', '', 1, '{}')"
        )
        .await
        .is_ok(),
        "targets are unique per project, not globally"
    );
    assert!(
        execute(
            &upgraded,
            "INSERT INTO character_voice_profiles VALUES ('v1', 'p', 'narrator', '', 1, '{}')"
        )
        .await
        .is_ok()
            && execute(
                &upgraded,
                "INSERT INTO character_voice_profiles VALUES ('v2', 'p', 'narrator', '', 1, '{}')"
            )
            .await
            .is_err(),
        "one profile row per target"
    );
    let version = upgraded
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA user_version",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(version.try_get::<i64>("", "user_version").unwrap(), 6);
}

#[tokio::test]
async fn v4_upgrade_creates_chapter_audio_tables() {
    let (root, db) = fixture().await;
    for table in ["chapter_audio_runs", "chapter_audio_units"] {
        execute(&db, &format!("DROP TABLE {table}")).await.unwrap();
    }
    execute(&db, "PRAGMA user_version = 4").await.unwrap();
    db.close().await.unwrap();
    let upgraded = open(&root.path().join("test.sqlite3")).await.unwrap();
    assert!(
        execute(
            &upgraded,
            "INSERT INTO chapter_audio_runs (id, project_id, chapter_id, analysis_version_id, \
             source_sha256, backend, model, device, status, stage, unit_count, completed_units, \
             failed_index, error, error_detail, final_media_id, final_duration_ms, created_at, \
             finished_at) VALUES ('r1', 'p', 'c', 'v', 'sha', 'kokoro', '1.1-zh', 'cpu', \
             'succeeded', 'finished', 1, 1, NULL, NULL, NULL, NULL, NULL, '1', NULL)"
        )
        .await
        .is_ok(),
        "run row shape matches the entity"
    );
    for (id, ok) in [("u1", true), ("u2", false)] {
        let result = execute(
            &upgraded,
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
             '1.1-zh', 'cpu', '{status}', 'queued', 1, 0, NULL, NULL, NULL, NULL, NULL, \
             '1', NULL)"
        )
    };
    assert!(execute(&upgraded, &active("r2", "queued")).await.is_ok());
    assert!(
        execute(&upgraded, &active("r3", "running")).await.is_err(),
        "at most one active run exists at a time"
    );
    let version = upgraded
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA user_version",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(version.try_get::<i64>("", "user_version").unwrap(), 6);
}

#[tokio::test]
async fn v5_upgrade_adds_error_detail_and_keeps_runs() {
    let (root, db) = fixture().await;
    execute(
        &db,
        "ALTER TABLE chapter_audio_runs DROP COLUMN error_detail",
    )
    .await
    .unwrap();
    execute(
        &db,
        "ALTER TABLE chapter_audio_units DROP COLUMN error_detail",
    )
    .await
    .unwrap();
    execute(
        &db,
        "INSERT INTO chapter_audio_runs (id, project_id, chapter_id, analysis_version_id, \
         source_sha256, backend, model, device, status, stage, unit_count, completed_units, \
         failed_index, error, final_media_id, final_duration_ms, created_at, finished_at) \
         VALUES ('r1', 'p', 'c', 'v', 'sha', 'kokoro', '1.1-zh', 'cpu', 'failed', 'finished', \
         2, 1, 1, 'unit_synthesis_failed', NULL, NULL, '1', '2')",
    )
    .await
    .unwrap();
    execute(&db, "PRAGMA user_version = 5").await.unwrap();
    db.close().await.unwrap();
    let upgraded = open(&root.path().join("test.sqlite3")).await.unwrap();
    let row = upgraded
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT error, error_detail FROM chapter_audio_runs WHERE id = 'r1'",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        row.try_get::<String>("", "error").unwrap(),
        "unit_synthesis_failed"
    );
    assert!(
        row.try_get::<Option<String>>("", "error_detail")
            .unwrap()
            .is_none()
    );
    let version = upgraded
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA user_version",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(version.try_get::<i64>("", "user_version").unwrap(), 6);
}

#[tokio::test]
async fn v2_upgrade_adds_nullable_run_context_without_rewriting_history() {
    let (root, db) = fixture().await;
    session(&db, "s").await;
    run(&db, "r", "s", "request", "failed").await.unwrap();
    for table in [
        "chapter_audio_units",
        "chapter_audio_runs",
        "casting_inputs",
        "casting_suggestions",
        "character_voice_profiles",
        "voice_binding_edits",
        "voice_bindings",
    ] {
        execute(&db, &format!("DROP TABLE {table}")).await.unwrap();
    }
    execute(&db, "ALTER TABLE ai_runs DROP COLUMN workspace_context")
        .await
        .unwrap();
    execute(&db, "PRAGMA user_version = 2").await.unwrap();
    db.close().await.unwrap();
    let upgraded = open(&root.path().join("test.sqlite3")).await.unwrap();
    let run = super::entity::ai_run::Entity::find_by_id("r")
        .one(&upgraded)
        .await
        .unwrap()
        .unwrap();
    assert!(run.workspace_context.is_none());
    assert_eq!(run.request_id, "request");
    assert_eq!(run.status, "failed");
}
