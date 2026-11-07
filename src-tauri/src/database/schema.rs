//! Only the current application schema is supported; old file formats are not imported.
use super::entity::*;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait};

const VERSION: i64 = 1;

pub(super) async fn initialize(db: &DatabaseConnection) -> anyhow::Result<()> {
    let transaction = db.begin().await?;
    let row = transaction
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA user_version",
        ))
        .await?
        .ok_or_else(|| anyhow::anyhow!("missing database schema version"))?;
    let version: i64 = row.try_get("", "user_version")?;
    match version {
        VERSION => {}
        0 => {
            db.get_schema_builder()
                .register(project::Entity)
                .register(source::Entity)
                .register(volume::Entity)
                .register(chapter::Entity)
                .register(project_edit_state::Entity)
                .register(ai_session::Entity)
                .register(ai_run::Entity)
                .register(ai_message::Entity)
                .register(split_proposal::Entity)
                .register(command_receipt::Entity)
                .apply(&transaction)
                .await?;
            for sql in [
                "CREATE UNIQUE INDEX source_project_identity ON sources(id, project_id)",
                "CREATE UNIQUE INDEX volume_source_identity ON volumes(id, source_id)",
                "CREATE UNIQUE INDEX run_session_identity ON ai_runs(id, session_id)",
                "CREATE UNIQUE INDEX source_order ON sources(project_id, ordinal)",
                "CREATE UNIQUE INDEX chapter_order ON chapters(project_id, ordinal)",
                "CREATE UNIQUE INDEX message_order ON ai_messages(session_id, ordinal)",
                "CREATE UNIQUE INDEX run_request ON ai_runs(session_id, request_id)",
                "CREATE UNIQUE INDEX session_active_run ON ai_runs(session_id) WHERE status IN ('queued', 'running', 'cancelling')",
                "CREATE INDEX pending_runs ON ai_runs(status, dispatch_after)",
                "PRAGMA user_version = 1",
            ] {
                transaction
                    .execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
                    .await?;
            }
        }
        other => anyhow::bail!("unsupported database schema version: {other}"),
    }
    transaction.commit().await?;
    Ok(())
}
