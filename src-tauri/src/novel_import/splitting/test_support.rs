//! Source-backed runtime fixtures shared by candidate and graph tests.
use crate::{
    ai::{self, runs::Lease, *},
    project::{
        store::{self as projects, LocalProject},
        test_support::fixture,
    },
};
use sea_orm::DatabaseConnection;
use tokio_util::sync::CancellationToken;
pub(crate) async fn running(db: &DatabaseConnection, state: &LocalProject) -> Lease {
    let session = ai::create_session(
        db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: state.document.project.id.clone(),
            task_kind: "chapter_splitting".into(),
            chapter_id: None,
            title: "分章检查".into(),
        },
    )
    .await
    .unwrap();
    let run = ai::start_run(
        db,
        StartRun {
            workspace_context: None,
            session_id: session.id,
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
            expected_project_revision: state.document.project.revision,
            trigger: Trigger::Message {
                message: "检查分章".into(),
            },
        },
        None,
    )
    .await
    .unwrap();
    ai::runs::claim(db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap()
}

pub(crate) async fn fixture_saved() -> (tempfile::TempDir, DatabaseConnection, LocalProject, Lease)
{
    let (root, db, state) = fixture().await;
    projects::save(&db, root.path(), &state, None)
        .await
        .unwrap();
    let lease = running(&db, &state).await;
    (root, db, state, lease)
}

pub(crate) fn tool_context(
    root: &std::path::Path,
    db: &DatabaseConnection,
    lease: &Lease,
) -> crate::ai::assistant::tools::WorkspaceTools {
    crate::ai::assistant::tools::WorkspaceTools {
        catalog: None,
        experiment: None,
        root: root.into(),
        db: db.clone(),
        lease: lease.clone(),
        dispatch: ai::dispatch::ToolDispatch::new(db.clone(), lease.clone()),
        token: CancellationToken::new(),
        workers: std::sync::Arc::new(tokio::sync::Semaphore::new(1)),
    }
}
