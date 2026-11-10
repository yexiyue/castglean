//! Shared real-SQLite fixtures for session and executor boundary tests.
use super::*;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

pub(super) async fn sql(db: &DatabaseConnection, query: &str) {
    db.execute_raw(Statement::from_string(DbBackend::Sqlite, query))
        .await
        .unwrap();
}

pub(super) async fn fixture() -> (tempfile::TempDir, DatabaseConnection, SessionInfo) {
    let root = tempfile::tempdir().unwrap();
    let db = crate::database::open(&root.path().join("app.sqlite3"))
        .await
        .unwrap();
    sql(&db, "INSERT INTO projects VALUES ('p', 'Book', '', 1, 'importing', '1', '1'), ('other', 'Other', '', 1, 'importing', '1', '1')").await;
    sql(&db, "INSERT INTO sources VALUES ('s', 'p', 0, 'book.txt', 'utf-8', 'hash', 'raw', 1, 'hash', 'text', 1)").await;
    let session = super::service::create(
        &db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "p".into(),
            task_kind: "chapter_splitting".into(),
            chapter_id: None,
            title: "分章".into(),
        },
    )
    .await
    .unwrap();
    (root, db, session)
}

pub(super) fn request(session: &SessionInfo) -> StartRun {
    StartRun {
        workspace_context: None,
        session_id: session.id.clone(),
        request_id: uuid::Uuid::new_v4().to_string(),
        configuration: Configuration {
            reasoning: None,
            selection: crate::llm::ModelSelection {
                connection_id: "connection".into(),
                model_id: "model".into(),
            },
            revision: 1,
        },
        confirm_rebind: false,
        expected_project_revision: 1,
        trigger: Trigger::Message {
            message: "检查目录".into(),
        },
    }
}
