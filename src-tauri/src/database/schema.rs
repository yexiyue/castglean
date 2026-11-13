//! Initialize the current application schema in one transaction.
use super::entity::*;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait};

const VERSION: i64 = 8;

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
    if version == VERSION {
        transaction.commit().await?;
        return Ok(());
    }
    if version == 7 {
        for sql in [
            "ALTER TABLE chapter_audio_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE chapter_audio_runs ADD COLUMN current_index INTEGER",
            "CREATE TABLE chapter_audio_arrangements (id TEXT PRIMARY KEY NOT NULL REFERENCES chapter_audio_runs(id), revision INTEGER NOT NULL, content TEXT NOT NULL, previous_content TEXT)",
            "PRAGMA user_version = 8",
        ] {
            transaction
                .execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
                .await?;
        }
        transaction.commit().await?;
        return Ok(());
    }
    anyhow::ensure!(
        version == 0,
        "unsupported database schema version: {version}"
    );

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
        .register(analysis_input::Entity)
        .register(analysis_window::Entity)
        .register(analysis_version::Entity)
        .register(analysis_state::Entity)
        .register(analysis_candidate::Entity)
        .register(analysis_edit::Entity)
        .register(character::Entity)
        .register(character_alias::Entity)
        .register(voice_binding::Entity)
        .register(voice_binding_edit::Entity)
        .register(character_voice_profile::Entity)
        .register(casting_input::Entity)
        .register(casting_suggestion::Entity)
        .register(chapter_audio_run::Entity)
        .register(chapter_audio_unit::Entity)
        .register(chapter_audio_arrangement::Entity)
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
        "CREATE UNIQUE INDEX analysis_window_order ON analysis_windows(input_id, ordinal)",
        "CREATE UNIQUE INDEX analysis_run_version ON analysis_versions(run_id) WHERE run_id IS NOT NULL",
        "CREATE INDEX analysis_chapter_versions ON analysis_versions(project_id, chapter_id)",
        "CREATE INDEX analysis_chapter_candidates ON analysis_candidates(project_id, chapter_id, status)",
        "CREATE INDEX project_characters ON characters(project_id, status)",
        "CREATE UNIQUE INDEX voice_binding_target ON voice_bindings(project_id, target_kind, character_id)",
        "CREATE INDEX voice_binding_audit ON voice_binding_edits(binding_id, revision)",
        "CREATE UNIQUE INDEX voice_profile_target ON character_voice_profiles(project_id, target_kind, character_id)",
        "CREATE INDEX casting_suggestions_project ON casting_suggestions(project_id)",
        "CREATE UNIQUE INDEX chapter_audio_unit_order ON chapter_audio_units(run_id, \"index\")",
        "CREATE INDEX chapter_audio_chapter_runs ON chapter_audio_runs(project_id, chapter_id)",
        "CREATE UNIQUE INDEX chapter_audio_single_active ON chapter_audio_runs((1)) WHERE status IN ('queued', 'running', 'cancelling')",
        "PRAGMA user_version = 8",
    ] {
        transaction
            .execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}
