//! Initialize the current application schema in one transaction.
use super::{UnsupportedSchema, entity::*};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait};

const VERSION: i64 = 13;

/// v11 → v12：会话摘要列。
const UPGRADE_12: [&str; 2] = [
    "ALTER TABLE ai_sessions ADD COLUMN context_summary JSON",
    "PRAGMA user_version = 12",
];
/// v12 → v13：章节音频任务的沿用来源、种类与采用状态。
/// 按旧版成功任务的排序初始化每章每种制作方式的采用指针。
const UPGRADE_13: [&str; 9] = [
    "ALTER TABLE chapter_audio_runs ADD COLUMN parent_run_id TEXT",
    "ALTER TABLE chapter_audio_runs ADD COLUMN inherited_units INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE chapter_audio_runs ADD COLUMN dropped_pauses INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE chapter_audio_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'generation'",
    "ALTER TABLE chapter_audio_runs ADD COLUMN adoption TEXT NOT NULL DEFAULT 'none'",
    "ALTER TABLE chapter_audio_runs ADD COLUMN redo_indexes TEXT NOT NULL DEFAULT '[]'",
    "UPDATE chapter_audio_runs SET adoption = 'adopted' WHERE status = 'succeeded' AND id IN \
     (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, chapter_id, mode \
     ORDER BY created_at DESC, id DESC) AS rank FROM chapter_audio_runs WHERE status = 'succeeded') \
     WHERE rank = 1)",
    "CREATE UNIQUE INDEX chapter_audio_adopted ON chapter_audio_runs(project_id, chapter_id, mode) WHERE adoption = 'adopted'",
    "PRAGMA user_version = 13",
];

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
    if version != 0 {
        // 逐级增量升级，任一步失败都在同一事务内整体回滚。
        let mut current = version;
        for (from, statements) in [(11, UPGRADE_12.as_slice()), (12, UPGRADE_13.as_slice())] {
            if current != from {
                continue;
            }
            for sql in statements {
                transaction
                    .execute_raw(Statement::from_string(DbBackend::Sqlite, *sql))
                    .await?;
            }
            current += 1;
        }
        if current != VERSION {
            return Err(UnsupportedSchema { version }.into());
        }
        transaction.commit().await?;
        return Ok(());
    }
    db.get_schema_builder()
        .register(project::Entity)
        .register(source::Entity)
        .register(volume::Entity)
        .register(chapter::Entity)
        .register(project_edit_state::Entity)
        .register(ai_session::Entity)
        .register(ai_invocation::Entity)
        .register(ai_interrupt::Entity)
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
        "CREATE INDEX ai_invocation_run ON ai_invocations(run_id)",
        "CREATE INDEX ai_interrupt_session ON ai_interrupts(session_id, consumed_by)",
        "CREATE INDEX chapter_audio_mode_runs ON chapter_audio_runs(project_id, chapter_id, mode, created_at)",
        "CREATE UNIQUE INDEX chapter_audio_adopted ON chapter_audio_runs(project_id, chapter_id, mode) WHERE adoption = 'adopted'",
        "PRAGMA user_version = 13",
    ] {
        transaction
            .execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}
