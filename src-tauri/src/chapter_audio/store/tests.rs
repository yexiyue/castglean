//! 存储测试：单活动任务约束、单元计数、取消意图与启动恢复。
use super::*;
use crate::chapter_audio::plan::PlannedUnit;
use crate::voice_binding::BindingTarget;
use sea_orm::{DbBackend, Statement};

async fn db() -> (tempfile::TempDir, DatabaseConnection) {
    let root = tempfile::tempdir().unwrap();
    let db = crate::database::open(&root.path().join("test.sqlite3"))
        .await
        .unwrap();
    for sql in [
        "INSERT INTO projects VALUES ('p', 'Title', '', 1, 'importing', '1', '1')",
        "INSERT INTO sources VALUES ('s', 'p', 0, 'novel.txt', 'utf-8', 'raw', 'raw', 1, 'sha', 'sha', 1)",
    ] {
        db.execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
            .await
            .unwrap();
    }
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        "INSERT INTO chapters VALUES ('c', 'p', 's', NULL, '第一章', 0, 20, 0, 0, '[]')",
    ))
    .await
    .unwrap();
    (root, db)
}

fn plan(units: usize) -> Plan {
    Plan {
        version_id: Some("v1".into()),
        source_id: "s".into(),
        text_semantics: "test-model:test-text".into(),
        source_sha256: "sha".into(),
        backend: "kokoro".into(),
        model: "1.1-zh-g2pw".into(),
        units: (0..units)
            .map(|i| PlannedUnit {
                segment_id: format!("s{i}"),
                range: ByteRange {
                    start: i as u32 * 3,
                    end: i as u32 * 3 + 3,
                },
                line: i as u32,
                target: BindingTarget::Narrator,
                voice: "zf_001".into(),
                empty: i == 0,
            })
            .collect(),
    }
}

#[tokio::test]
async fn only_one_active_run_exists_at_the_database_level() {
    let (_root, db) = db().await;
    insert(&db, "r1", "p", "c", &plan(2)).await.unwrap();
    // 数据库唯一索引兜底：绕过入口约束直接插入活动任务会被拒绝。
    let mut competing = find(&db, "r1").await.unwrap().into_active_model();
    competing.id = Set("r2".into());
    competing.insert(&db).await.unwrap_err();
    assert!(any_active(&db).await.unwrap());
    finish(
        &db,
        "r1",
        Finish {
            status: ChapterAudioStatus::Cancelled,
            error: None,
            detail: None,
            failed: None,
            product: None,
            settled: None,
        },
    )
    .await
    .unwrap();
    assert!(!any_active(&db).await.unwrap());
    // 终态后再启动新任务是允许的。
    insert(&db, "r3", "p", "c", &plan(1)).await.unwrap();
}

#[tokio::test]
async fn unit_completion_advances_counter_atomically() {
    let (_root, db) = db().await;
    insert(&db, "r1", "p", "c", &plan(3)).await.unwrap();
    let rows = units(&db, "r1").await.unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].status, "empty");
    assert_eq!(rows[1].status, "pending");
    // 空白单元没有产物但计入完成。
    let run = complete_unit(&db, "r1", &rows[0].id, None).await.unwrap();
    assert_eq!(run.completed_units, 1);
    let run = complete_unit(&db, "r1", &rows[1].id, Some(("m1", 1250.0)))
        .await
        .unwrap();
    assert_eq!(run.completed_units, 2);
    let updated = units(&db, "r1").await.unwrap();
    assert_eq!(updated[1].status, "done");
    assert_eq!(updated[1].media_id.as_deref(), Some("m1"));
    assert_eq!(updated[1].duration_ms, Some(1250.0));
}

#[tokio::test]
async fn failed_run_records_unit_and_keeps_completed_audio() {
    let (_root, db) = db().await;
    insert(&db, "r1", "p", "c", &plan(2)).await.unwrap();
    let rows = units(&db, "r1").await.unwrap();
    complete_unit(&db, "r1", &rows[0].id, None).await.unwrap();
    finish(
        &db,
        "r1",
        Finish {
            status: ChapterAudioStatus::Failed,
            error: Some("synthesis failed"),
            detail: Some("backend exploded with detail".into()),
            failed: Some((&rows[1].id, 1)),
            product: None,
            settled: None,
        },
    )
    .await
    .unwrap();
    let run = find(&db, "r1").await.unwrap();
    assert_eq!(run.status, "failed");
    assert_eq!(run.failed_index, Some(1));
    assert_eq!(run.completed_units, 1, "completed units are kept");
    let rows = units(&db, "r1").await.unwrap();
    assert_eq!(rows[1].status, "failed");
    assert_eq!(
        rows[1].error_detail.as_deref(),
        Some("backend exploded with detail")
    );
}

#[tokio::test]
async fn cancel_persists_intent_and_is_idempotent_on_terminal_runs() {
    let (_root, db) = db().await;
    insert(&db, "r1", "p", "c", &plan(1)).await.unwrap();
    let run = request_cancel(&db, "r1").await.unwrap();
    assert_eq!(run.status, "cancelling");
    finish(
        &db,
        "r1",
        Finish {
            status: ChapterAudioStatus::Cancelled,
            error: None,
            detail: None,
            failed: None,
            product: None,
            settled: None,
        },
    )
    .await
    .unwrap();
    let run = request_cancel(&db, "r1").await.unwrap();
    assert_eq!(run.status, "cancelled", "terminal runs are untouched");
}

#[tokio::test]
async fn cancellation_cannot_be_overwritten_by_stage_or_success() {
    let (_root, db) = db().await;
    insert(&db, "r1", "p", "c", &plan(1)).await.unwrap();
    request_cancel(&db, "r1").await.unwrap();
    let stage = set_stage(&db, "r1", ChapterAudioStatus::Running, "generating")
        .await
        .unwrap();
    assert_eq!(stage.status, "cancelling");
    let result = finish(
        &db,
        "r1",
        Finish {
            status: ChapterAudioStatus::Succeeded,
            error: None,
            detail: None,
            failed: None,
            product: Some(("final", 100.0)),
            settled: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(result.status, "cancelled");
    assert!(result.final_media_id.is_none());
    assert_eq!(request_cancel(&db, "r1").await.unwrap().status, "cancelled");
    assert!(!any_active(&db).await.unwrap());
}

#[tokio::test]
async fn concurrent_cancel_and_finish_never_leave_an_active_run() {
    let (_root, db) = db().await;
    for index in 0..25 {
        let id = format!("race-{index}");
        insert(&db, &id, "p", "c", &plan(1)).await.unwrap();
        let (cancelled, finished) = tokio::join!(
            request_cancel(&db, &id),
            finish(
                &db,
                &id,
                Finish {
                    status: ChapterAudioStatus::Succeeded,
                    error: None,
                    detail: None,
                    failed: None,
                    product: Some(("final", 100.0)),
                    settled: None,
                }
            ),
        );
        cancelled.unwrap();
        finished.unwrap();
        let row = find(&db, &id).await.unwrap();
        assert!(
            matches!(row.status.as_str(), "cancelled" | "succeeded"),
            "{}",
            row.status
        );
        assert!(!any_active(&db).await.unwrap());
    }
}

#[tokio::test]
async fn recovery_marks_inflight_runs_interrupted_and_rebuilds_media() {
    let (root, db) = db().await;
    insert(&db, "r1", "p", "c", &plan(2)).await.unwrap();
    set_stage(&db, "r1", ChapterAudioStatus::Running, "generating")
        .await
        .unwrap();
    let rows = units(&db, "r1").await.unwrap();
    complete_unit(&db, "r1", &rows[0].id, Some(("media-done", 800.0)))
        .await
        .unwrap();

    let state = ChapterAudioState::new(root.path().join("chapter-audio"));
    // 模拟上次进程退出：产物目录中只有已完成单元。
    std::fs::create_dir_all(state.run_dir("r1")).unwrap();
    std::fs::write(state.unit_path("r1", 0), b"wav").unwrap();
    state.publish_media("media-done", state.unit_path("r1", 0));
    drop(state);

    // 新进程状态：恢复 + 重建映射。
    let state = ChapterAudioState::new(root.path().join("chapter-audio"));
    recover(&db, &state).await.unwrap();
    let run = find(&db, "r1").await.unwrap();
    assert_eq!(run.status, "interrupted");
    assert_eq!(run.completed_units, 1, "completed units survive restart");
    assert!(state.media_path("media-done").is_some());
    assert!(state.media_path("media-missing").is_none());
    assert!(!any_active(&db).await.unwrap());
}

#[tokio::test]
async fn latest_playable_skips_a_newer_run_with_missing_media() {
    let (root, db) = db().await;
    let state = ChapterAudioState::new(root.path().join("chapter-audio"));
    for (id, available) in [("r1", true), ("r2", false)] {
        insert(&db, id, "p", "c", &plan(1)).await.unwrap();
        let rows = units(&db, id).await.unwrap();
        complete_unit(&db, id, &rows[0].id, Some((id, 100.0)))
            .await
            .unwrap();
        finish(
            &db,
            id,
            Finish {
                status: ChapterAudioStatus::Succeeded,
                error: None,
                detail: None,
                failed: None,
                product: None,
                settled: None,
            },
        )
        .await
        .unwrap();
        if available {
            std::fs::create_dir_all(state.run_dir(id)).unwrap();
            let path = state.unit_path(id, 0);
            std::fs::write(&path, b"wav").unwrap();
            assert!(state.publish_media(id, path));
        }
    }
    let mode = Some(ChapterAudioMode::MultiRole);
    assert_eq!(
        latest_for_chapter(&db, "p", "c", mode)
            .await
            .unwrap()
            .unwrap()
            .id,
        "r2"
    );
    assert_eq!(
        latest_playable(&db, &state, "p", "c", mode)
            .await
            .unwrap()
            .unwrap()
            .id,
        "r1"
    );
}

#[tokio::test]
async fn status_view_hides_products_without_files() {
    let (root, db) = db().await;
    insert(&db, "r1", "p", "c", &plan(2)).await.unwrap();
    let rows = units(&db, "r1").await.unwrap();
    complete_unit(&db, "r1", &rows[1].id, Some(("media-done", 900.0)))
        .await
        .unwrap();
    finish(
        &db,
        "r1",
        Finish {
            status: ChapterAudioStatus::Succeeded,
            error: None,
            detail: None,
            failed: None,
            product: Some(("media-final", 2100.0)),
            settled: None,
        },
    )
    .await
    .unwrap();
    let state = ChapterAudioState::new(root.path().join("chapter-audio"));
    let view = status_view(&db, &state, &find(&db, "r1").await.unwrap())
        .await
        .unwrap();
    assert_eq!(view.run.chapter_title, "第一章");
    assert!(
        view.run.final_media_id.is_none(),
        "missing file hides the id"
    );
    assert!(view.units[1].media_id.is_none());
    // 文件落盘后身份可见。
    std::fs::create_dir_all(state.run_dir("r1")).unwrap();
    std::fs::write(state.final_path("r1"), b"wav").unwrap();
    state.publish_media("media-final", state.final_path("r1"));
    let view = status_view(&db, &state, &find(&db, "r1").await.unwrap())
        .await
        .unwrap();
    assert_eq!(view.run.final_media_id.as_deref(), Some("media-final"));
    assert_eq!(view.run.final_duration_ms, Some(2100.0));
    std::fs::remove_file(state.final_path("r1")).unwrap();
    let view = status_view(&db, &state, &find(&db, "r1").await.unwrap())
        .await
        .unwrap();
    assert!(
        view.run.final_media_id.is_none(),
        "removed files are unavailable immediately"
    );
}

#[tokio::test]
async fn execution_position_is_explicit_and_revision_survives_resume() {
    let (_root, db) = db().await;
    insert(&db, "r1", "p", "c", &plan(4)).await.unwrap();
    let loading = set_stage(&db, "r1", ChapterAudioStatus::Running, "loading")
        .await
        .unwrap();
    assert_eq!(loading.current_index, None);
    let units = units(&db, "r1").await.unwrap();
    let done = complete_unit(&db, "r1", &units[3].id, Some(("m", 100.0)))
        .await
        .unwrap();
    let executing = begin_unit(&db, "r1", 1).await.unwrap();
    assert_eq!(executing.current_index, Some(1));
    assert!(executing.revision > done.revision);
    let cancelled = request_cancel(&db, "r1").await.unwrap();
    let late = begin_unit(&db, "r1", 2).await.unwrap();
    assert_eq!(late.current_index, Some(1));
    assert_eq!(late.revision, cancelled.revision);
    recover(&db, &ChapterAudioState::new(std::env::temp_dir()))
        .await
        .unwrap();
    let recovered = find(&db, "r1").await.unwrap();
    assert_eq!(recovered.current_index, None);
    assert!(recovered.revision > cancelled.revision);
    let resumed = resume(&db, "r1").await.unwrap();
    assert_eq!(resumed.current_index, None);
    assert!(resumed.revision > recovered.revision);
}

#[tokio::test]
async fn narration_has_its_own_run_and_resume_identity() {
    let (root, db) = db().await;
    let mut narration = plan(4);
    narration.version_id = None;
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        "UPDATE chapters SET end = 12 WHERE id = 'c'",
    ))
    .await
    .unwrap();
    insert(&db, "narration", "p", "c", &narration)
        .await
        .unwrap();
    let state = ChapterAudioState::new(root.path().join("chapter-audio"));
    recover(&db, &state).await.unwrap();
    let row = find(&db, "narration").await.unwrap();
    let saved = units(&db, &row.id).await.unwrap();
    assert_eq!(row.status, "interrupted");
    assert!(resumable(&row, &narration, &saved));
    assert!(!resumable(&row, &plan(4), &saved));
    assert!(super::super::arrangement::valid(&db, &row).await.unwrap());

    for sql in [
        "INSERT INTO analysis_versions VALUES ('v1','p','c',NULL,'{}','1')",
        "INSERT INTO analysis_states VALUES ('c','p','v1',1,0,NULL)",
    ] {
        db.execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
            .await
            .unwrap();
    }
    insert(&db, "cast", "p", "c", &plan(4)).await.unwrap();
    for (mode, id) in [
        (ChapterAudioMode::Narrator, "narration"),
        (ChapterAudioMode::MultiRole, "cast"),
    ] {
        assert_eq!(
            latest_for_chapter(&db, "p", "c", Some(mode))
                .await
                .unwrap()
                .unwrap()
                .id,
            id,
        );
    }
    assert!(super::super::arrangement::valid(&db, &row).await.unwrap());
    narration.units[0].voice = "other-voice".into();
    assert!(!resumable(&row, &narration, &saved));
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        "UPDATE chapters SET end = 11 WHERE id = 'c'",
    ))
    .await
    .unwrap();
    assert!(!super::super::arrangement::valid(&db, &row).await.unwrap());
}

#[tokio::test]
async fn pauses_are_revisioned_idempotent_and_undoable_after_reopen() {
    use crate::chapter_audio::arrangement::{self, ChapterPauseEdit};
    let (root, db) = db().await;
    insert(&db, "r1", "p", "c", &plan(4)).await.unwrap();
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        "UPDATE chapters SET end = 12 WHERE id = 'c'",
    ))
    .await
    .unwrap();
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        "INSERT INTO analysis_versions VALUES ('v1','p','c',NULL,'{}','1')",
    ))
    .await
    .unwrap();
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        "INSERT INTO analysis_states VALUES ('c','p','v1',1,0,NULL)",
    ))
    .await
    .unwrap();
    db.execute_raw(Statement::from_string(DbBackend::Sqlite, r#"INSERT INTO voice_bindings VALUES ('b','p','narrator','',1,'{"formatVersion":1,"voice":{"kind":"preset","backend":"kokoro","model":"1.1-zh-g2pw","voice":"zf_001"},"origin":null,"updatedAt":"1"}')"#)).await.unwrap();
    let first = arrangement::edit(
        &db,
        "p",
        "r1",
        0,
        "op1",
        ChapterPauseEdit::Set {
            after_index: 1,
            duration_ms: 500,
        },
    )
    .await
    .unwrap();
    assert_eq!(first.revision, 1);
    let replay = arrangement::edit(
        &db,
        "p",
        "r1",
        0,
        "op1",
        ChapterPauseEdit::Set {
            after_index: 1,
            duration_ms: 500,
        },
    )
    .await
    .unwrap();
    assert_eq!(replay.revision, 1);
    assert!(
        arrangement::edit(&db, "other", "r1", 1, "bad", ChapterPauseEdit::Undo)
            .await
            .is_err()
    );
    assert!(
        arrangement::edit(&db, "p", "r1", 0, "conflict", ChapterPauseEdit::Undo)
            .await
            .is_err()
    );
    assert!(
        arrangement::edit(
            &db,
            "p",
            "r1",
            1,
            "invalid",
            ChapterPauseEdit::Set {
                after_index: 3,
                duration_ms: 500
            }
        )
        .await
        .is_err()
    );
    assert!(
        arrangement::edit(
            &db,
            "p",
            "r1",
            1,
            "invalid-time",
            ChapterPauseEdit::Set {
                after_index: 2,
                duration_ms: 501
            }
        )
        .await
        .is_err()
    );
    let second = arrangement::edit(
        &db,
        "p",
        "r1",
        1,
        "op2",
        ChapterPauseEdit::Move {
            after_index: 1,
            to_index: 2,
        },
    )
    .await
    .unwrap();
    assert_eq!(second.pauses[0].after_index, 2);
    db.close().await.unwrap();
    let reopened = crate::database::open(&root.path().join("test.sqlite3"))
        .await
        .unwrap();
    let undone = arrangement::edit(&reopened, "p", "r1", 2, "undo", ChapterPauseEdit::Undo)
        .await
        .unwrap();
    assert_eq!(undone.revision, 3);
    assert_eq!(undone.pauses[0].after_index, 1);
    assert!(!undone.can_undo);
    let removed = arrangement::edit(
        &reopened,
        "p",
        "r1",
        3,
        "remove",
        ChapterPauseEdit::Set {
            after_index: 1,
            duration_ms: 0,
        },
    )
    .await
    .unwrap();
    assert!(removed.pauses.is_empty());
    arrangement::edit(
        &reopened,
        "p",
        "r1",
        4,
        "add-again",
        ChapterPauseEdit::Set {
            after_index: 1,
            duration_ms: 500,
        },
    )
    .await
    .unwrap();
    arrangement::edit(
        &reopened,
        "p",
        "r1",
        5,
        "add-other",
        ChapterPauseEdit::Set {
            after_index: 2,
            duration_ms: 500,
        },
    )
    .await
    .unwrap();
    assert!(
        arrangement::edit(
            &reopened,
            "p",
            "r1",
            6,
            "occupied",
            ChapterPauseEdit::Move {
                after_index: 1,
                to_index: 2
            }
        )
        .await
        .is_err()
    );
    let current_units = units(&reopened, "r1").await.unwrap();
    let (edited, completed) = tokio::join!(
        arrangement::edit(
            &reopened,
            "p",
            "r1",
            6,
            "concurrent",
            ChapterPauseEdit::Set {
                after_index: 1,
                duration_ms: 600
            }
        ),
        complete_unit(
            &reopened,
            "r1",
            &current_units[1].id,
            Some(("parallel-media", 100.0))
        )
    );
    assert_eq!(edited.unwrap().revision, 7);
    assert_eq!(completed.unwrap().completed_units, 1);
    // A changed chapter boundary invalidates the frozen arrangement without deleting its units.
    let before_boundary = units(&reopened, "r1").await.unwrap();
    reopened
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE chapters SET end = 9 WHERE id = 'c'",
        ))
        .await
        .unwrap();
    assert!(
        arrangement::read(&reopened, &find(&reopened, "r1").await.unwrap())
            .await
            .unwrap()
            .stale
    );
    let after_boundary = units(&reopened, "r1").await.unwrap();
    assert!(
        arrangement::edit(
            &reopened,
            "p",
            "r1",
            7,
            "boundary-stale-edit",
            ChapterPauseEdit::Undo
        )
        .await
        .is_err()
    );
    assert_eq!(
        before_boundary
            .iter()
            .map(|unit| &unit.id)
            .collect::<Vec<_>>(),
        after_boundary
            .iter()
            .map(|unit| &unit.id)
            .collect::<Vec<_>>()
    );
    assert_eq!(before_boundary[1].media_id, after_boundary[1].media_id);
    reopened
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE chapters SET end = 12 WHERE id = 'c'",
        ))
        .await
        .unwrap();
    reopened
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE voice_bindings SET content = json_set(content, '$.voice.voice', 'zf_002')",
        ))
        .await
        .unwrap();
    assert!(
        arrangement::read(&reopened, &find(&reopened, "r1").await.unwrap())
            .await
            .unwrap()
            .stale
    );
    assert!(
        arrangement::edit(
            &reopened,
            "p",
            "r1",
            6,
            "stale-edit",
            ChapterPauseEdit::Undo
        )
        .await
        .is_err()
    );
    insert(&reopened, "r2", "p", "c", &plan(4))
        .await
        .unwrap_err();
    // 一个新任务即使范围相同也不隐式继承旧停顿。
    let mut other = find(&reopened, "r1").await.unwrap();
    other.id = "not-saved".into();
    assert!(
        arrangement::read(&reopened, &other)
            .await
            .unwrap()
            .pauses
            .is_empty()
    );
}

#[tokio::test]
async fn playback_stops_at_gaps_and_summaries_are_bounded() {
    let (root, db) = db().await;
    let state = ChapterAudioState::new(root.path().join("audio"));
    insert(&db, "r1", "p", "c", &plan(4)).await.unwrap();
    std::fs::create_dir_all(state.run_dir("r1")).unwrap();
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 24000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let rows = units(&db, "r1").await.unwrap();
    for index in [1, 3] {
        let path = state.unit_path("r1", index);
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for _ in 0..2400 {
            writer.write_sample(123i16).unwrap();
        }
        writer.finalize().unwrap();
        let media = format!("{index:032x}");
        state.publish_media(&media, path);
        complete_unit(&db, "r1", &rows[index as usize].id, Some((&media, 100.0)))
            .await
            .unwrap();
    }
    let result = crate::chapter_audio::playback::prepare(&db, &state, "p", "r1", 1)
        .await
        .unwrap();
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.gap_index, Some(2));
    assert!(
        crate::chapter_audio::playback::prepare(&db, &state, "other", "r1", 0)
            .await
            .is_err()
    );
    let text = "山风月色星河夜色";
    let digest = crate::project::hash(text.as_bytes());
    std::fs::write(root.path().join(format!("{digest}.txt")), text).unwrap();
    let summaries =
        crate::chapter_audio::playback::summaries(root.path(), &digest, rows.clone(), 1, 2)
            .unwrap();
    assert_eq!(summaries.len(), 2);
    assert_eq!(summaries[0].1, "风");
    assert!(crate::chapter_audio::playback::summaries(root.path(), &digest, rows, 0, 129).is_err());
}

#[tokio::test]
async fn real_structure_edit_preserves_manual_correction_and_existing_wav() {
    use crate::chapter_audio::arrangement;
    use crate::project::{self, edits::ProjectEdit};
    let (root, db, state) = project::test_support::fixture().await;
    project::store::save(&db, root.path(), &state, None)
        .await
        .unwrap();
    // Use the normal deterministic partitioner, then protect the first title manually.
    let id = uuid::Uuid::new_v4().to_string();
    project::edits::apply(
        &db,
        root.path(),
        "project",
        1,
        &id,
        ProjectEdit::Rules {
            rules: crate::project::detection::builtin(),
        },
    )
    .await
    .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    project::edits::apply(
        &db,
        root.path(),
        "project",
        2,
        &id,
        ProjectEdit::Boundary {
            correction: project::Correction {
                source_id: "source".into(),
                line: 0,
                include: true,
                title: Some("人工标题".into()),
                volume_id: None,
            },
        },
    )
    .await
    .unwrap();
    let before = project::store::read(&db, root.path(), "project")
        .await
        .unwrap();
    let chapter = before
        .document
        .project
        .chapters
        .iter()
        .find(|chapter| chapter.heading == Some(0))
        .unwrap();
    let chapter_id = chapter.id.clone();
    for sql in [
        format!("INSERT INTO analysis_versions VALUES ('v1','project','{chapter_id}',NULL,'{{}}','1')"),
        format!("INSERT INTO analysis_states VALUES ('{chapter_id}','project','v1',1,1,NULL)"),
        r#"INSERT INTO voice_bindings VALUES ('b','project','narrator','',1,'{"formatVersion":1,"voice":{"kind":"preset","backend":"kokoro","model":"1.1-zh-g2pw","voice":"zf_001"},"origin":null,"updatedAt":"1"}')"#.into(),
    ] { db.execute_raw(Statement::from_string(DbBackend::Sqlite, sql)).await.unwrap(); }
    let plan = Plan {
        version_id: Some("v1".into()),
        source_id: "source".into(),
        source_sha256: before.document.project.sources[0].sha256.clone(),
        backend: "kokoro".into(),
        model: "1.1-zh-g2pw".into(),
        text_semantics: "test".into(),
        units: vec![PlannedUnit {
            segment_id: "segment".into(),
            range: ByteRange {
                start: chapter.start,
                end: chapter.end,
            },
            line: 0,
            target: BindingTarget::Narrator,
            voice: "zf_001".into(),
            empty: false,
        }],
    };
    insert(&db, "history-run", "project", &chapter_id, &plan)
        .await
        .unwrap();
    let audio = ChapterAudioState::new(root.path().join("chapter-audio"));
    std::fs::create_dir_all(audio.run_dir("history-run")).unwrap();
    let path = audio.unit_path("history-run", 0);
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 24000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&path, spec).unwrap();
    writer.write_sample::<i16>(123).unwrap();
    writer.finalize().unwrap();
    let unit = units(&db, "history-run").await.unwrap().remove(0);
    complete_unit(&db, "history-run", &unit.id, Some(("history-media", 1.0)))
        .await
        .unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let run = find(&db, "history-run").await.unwrap();
    assert!(!arrangement::read(&db, &run).await.unwrap().stale);
    let id = uuid::Uuid::new_v4().to_string();
    project::edits::apply(
        &db,
        root.path(),
        "project",
        3,
        &id,
        ProjectEdit::Boundary {
            correction: project::Correction {
                source_id: "source".into(),
                line: 1,
                include: true,
                title: Some("新增章节".into()),
                volume_id: None,
            },
        },
    )
    .await
    .unwrap();
    let after = project::store::read(&db, root.path(), "project")
        .await
        .unwrap();
    assert!(
        after
            .document
            .project
            .chapters
            .iter()
            .any(|chapter| chapter.id == chapter_id && chapter.title == "人工标题")
    );
    assert_eq!(
        after.document.project.sources[0].sha256,
        before.document.project.sources[0].sha256
    );
    assert!(
        arrangement::read(&db, &find(&db, "history-run").await.unwrap())
            .await
            .unwrap()
            .stale
    );
    assert_eq!(
        units(&db, "history-run").await.unwrap()[0]
            .media_id
            .as_deref(),
        Some("history-media")
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
}

#[tokio::test]
async fn assistant_tasks_restore_the_same_run_and_check_ready_media() {
    let (root, db) = db().await;
    let state = ChapterAudioState::new(root.path().join("chapter-audio"));
    let plan = plan(3);
    for index in 0..6 {
        let id = format!("recent-{index}");
        insert(&db, &id, "p", "c", &plan).await.unwrap();
        let terminal = finish(
            &db,
            &id,
            Finish {
                status: ChapterAudioStatus::Cancelled,
                error: None,
                detail: None,
                failed: None,
                product: None,
                settled: None,
            },
        )
        .await
        .unwrap();
        let mut terminal = terminal.into_active_model();
        terminal.finished_at = Set(Some("1".into()));
        terminal.update(&db).await.unwrap();
    }
    let id = "recent-0";
    resume(&db, id).await.unwrap();
    let unit = units(&db, id).await.unwrap().remove(1);
    complete_unit(&db, id, &unit.id, Some(("media-done", 900.0)))
        .await
        .unwrap();
    let path = state.unit_path(id, 1);
    std::fs::create_dir_all(state.run_dir(id)).unwrap();
    std::fs::write(&path, b"wav").unwrap();
    state.publish_media("media-done", path.clone());
    let tasks = recent_tasks(&db, &state, "p").await.unwrap();
    assert_eq!(tasks.len(), 5);
    assert_eq!(tasks[0].run.id, id);
    assert_eq!(tasks[0].preview_unit_index, Some(1));
    assert_eq!(tasks[0].run.completed_units, 1);
    assert!(
        recent_tasks(&db, &state, "another-project")
            .await
            .unwrap()
            .is_empty()
    );

    drop(db);
    let reopened = crate::database::open(&root.path().join("test.sqlite3"))
        .await
        .unwrap();
    let recovered_state = ChapterAudioState::new(root.path().join("chapter-audio"));
    recover(&reopened, &recovered_state).await.unwrap();
    let now = recent_tasks(&reopened, &recovered_state, "p")
        .await
        .unwrap();
    let restored = now.iter().find(|task| task.run.id == id).unwrap();
    assert_eq!(restored.run.status, ChapterAudioStatus::Interrupted);
    assert_eq!(restored.preview_unit_index, Some(1));
    assert_eq!(restored.run.completed_units, 1);
    std::fs::remove_file(path).unwrap();
    let missing = recent_tasks(&reopened, &recovered_state, "p")
        .await
        .unwrap();
    assert_eq!(
        missing
            .iter()
            .find(|task| task.run.id == id)
            .unwrap()
            .preview_unit_index,
        None
    );
    assert!(!any_active(&reopened).await.unwrap());
}

fn audio_state(root: &tempfile::TempDir) -> ChapterAudioState {
    ChapterAudioState::new(root.path().join("audio"))
}

fn has_audio_in(state: &ChapterAudioState) -> impl Fn(&unit::Model) -> bool + '_ {
    move |unit: &unit::Model| {
        unit.media_id
            .as_deref()
            .and_then(|id| state.media_path(id))
            .is_some()
    }
}

/// 把章节范围、采用的分析和旁白绑定对齐到测试计划，供采用与编排校验读取。
async fn current_plan(db: &DatabaseConnection, end: i32) {
    for sql in [
        format!("UPDATE chapters SET end = {end} WHERE id = 'c'"),
        "INSERT INTO analysis_versions VALUES ('v1','p','c',NULL,'{}','1')".to_owned(),
        "INSERT INTO analysis_states VALUES ('c','p','v1',1,0,NULL)".to_owned(),
        r#"INSERT INTO voice_bindings VALUES ('b','p','narrator','',1,'{"formatVersion":1,"voice":{"kind":"preset","backend":"kokoro","model":"1.1-zh-g2pw","voice":"zf_001"},"origin":null,"updatedAt":"1"}')"#.to_owned(),
    ] {
        db.execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
            .await
            .unwrap();
    }
}

/// 把任务里的待合成单元写成真实可播放的 WAV，并以成功终态提交。
async fn generated(db: &DatabaseConnection, state: &ChapterAudioState, run_id: &str) -> run::Model {
    std::fs::create_dir_all(state.run_dir(run_id)).unwrap();
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 24000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    for row in units(db, run_id)
        .await
        .unwrap()
        .into_iter()
        .filter(|row| row.status == "pending")
    {
        let index = u32::try_from(row.index).unwrap();
        let path = state.unit_path(run_id, index);
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for _ in 0..2400 {
            writer.write_sample(123i16).unwrap();
        }
        writer.finalize().unwrap();
        let media = media_id();
        state.publish_media(&media, path);
        complete_unit(db, run_id, &row.id, Some((&media, 100.0)))
            .await
            .unwrap();
    }
    finish(
        db,
        run_id,
        Finish {
            status: ChapterAudioStatus::Succeeded,
            error: None,
            detail: None,
            failed: None,
            product: Some(("final", 300.0)),
            settled: None,
        },
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn derived_runs_inherit_identical_units_and_only_redo_changed_ones() {
    let (root, db) = db().await;
    let state = audio_state(&root);
    current_plan(&db, 12).await;
    insert(&db, "base", "p", "c", &plan(4)).await.unwrap();
    let base = generated(&db, &state, "base").await;
    assert_eq!(base.adoption, "adopted", "a finished chapter is adopted");
    let base_units = units(&db, "base").await.unwrap();

    // 只改第 2 个单元的声音：其余单元沿用，只有它需要重做。
    let mut changed = plan(4);
    changed.units[2].voice = "zf_002".into();
    changed.units[2].target = BindingTarget::Character {
        character_id: "speaker".into(),
    };
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        r#"INSERT INTO voice_bindings VALUES ('speaker-binding','p','character','speaker',1,'{"formatVersion":1,"voice":{"kind":"preset","backend":"kokoro","model":"1.1-zh-g2pw","voice":"zf_002"},"origin":null,"updatedAt":"1"}')"#,
    ))
    .await
    .unwrap();
    let scope = redo_scope(&base_units, &changed, has_audio_in(&state));
    assert_eq!(scope.summary().inheritable_units, 2);
    assert_eq!(scope.summary().redo_indexes, vec![2]);
    let derived = derive(
        &db,
        &state,
        Derivation {
            run_id: "redo",
            project_id: "p",
            chapter_id: "c",
            plan: &changed,
            parent: &base,
            kind: ChapterAudioKind::Redo,
        },
        &scope,
    )
    .await
    .unwrap();
    assert_eq!(derived.parent_run_id.as_deref(), Some("base"));
    assert_eq!(derived.kind, "redo");
    assert_eq!(derived.inherited_units, 2);
    assert_eq!(
        derived.completed_units, 2,
        "inherited audio counts as settled"
    );
    assert_eq!(derived.adoption, "none");
    let rows = units(&db, "redo").await.unwrap();
    let statuses: Vec<_> = rows.iter().map(|row| row.status.as_str()).collect();
    assert_eq!(statuses, ["empty", "done", "pending", "done"]);
    // 沿用单元有自己的产物身份，文件在派生目录内且内容与来源一致。
    for index in [1usize, 3] {
        let media = rows[index].media_id.clone().unwrap();
        assert_ne!(Some(&media), base_units[index].media_id.as_ref());
        let path = state.media_path(&media).unwrap();
        assert_eq!(path, state.unit_path("redo", index as u32));
        assert_eq!(
            std::fs::read(&path).unwrap(),
            std::fs::read(state.unit_path("base", index as u32)).unwrap()
        );
    }
    assert_eq!(rows[2].media_id, None);
    // 来源任务、其采用状态与产物不变。
    assert_eq!(find(&db, "base").await.unwrap(), base);
    assert_eq!(units(&db, "base").await.unwrap(), base_units);

    let done = generated(&db, &state, "redo").await;
    assert_eq!(done.adoption, "adopted", "a finished redo is adopted");
    assert_eq!(
        find(&db, "base").await.unwrap().adoption,
        "none",
        "the previous version yields"
    );

    // 新进程的启动恢复从数据库重建沿用单元的产物登记。
    let restarted = ChapterAudioState::new(root.path().join("audio"));
    recover(&db, &restarted).await.unwrap();
    let view = status_view(&db, &restarted, &done).await.unwrap();
    assert_eq!(view.run.kind, ChapterAudioKind::Redo);
    assert_eq!(view.run.inherited_units, 2);
    for (index, unit) in view.units.iter().enumerate() {
        assert_eq!(
            unit.media_id.is_some(),
            index != 0,
            "every audible unit stays playable after restart ({index})"
        );
    }
    assert!(
        complete(&db, &restarted, &done).await.unwrap(),
        "the adopted version resolves as the current version"
    );
}

#[tokio::test]
async fn result_frozen_before_a_binding_change_does_not_replace_the_adopted_version() {
    let (root, db) = db().await;
    let state = audio_state(&root);
    current_plan(&db, 12).await;
    insert(&db, "base", "p", "c", &plan(4)).await.unwrap();
    assert_eq!(generated(&db, &state, "base").await.adoption, "adopted");

    insert(&db, "stale", "p", "c", &plan(4)).await.unwrap();
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        "DELETE FROM voice_bindings WHERE id = 'b'",
    ))
    .await
    .unwrap();

    let result = generated(&db, &state, "stale").await;
    assert_eq!(result.status, "succeeded");
    assert_eq!(result.adoption, "none");
    assert_eq!(find(&db, "base").await.unwrap().adoption, "adopted");
    assert!(complete(&db, &state, &result).await.unwrap());
}

#[tokio::test]
async fn units_without_readable_audio_or_with_other_inputs_are_redone() {
    let (root, db) = db().await;
    let state = audio_state(&root);
    insert(&db, "base", "p", "c", &plan(4)).await.unwrap();
    generated(&db, &state, "base").await;
    let base = find(&db, "base").await.unwrap();
    let base_units = units(&db, "base").await.unwrap();
    assert!(same_inputs(&base, &plan(4)));
    for mutated in [
        run::Model {
            model: "other-model".into(),
            ..base.clone()
        },
        run::Model {
            text_semantics: "new-model:test-text".into(),
            ..base.clone()
        },
        run::Model {
            mode: "narrator".into(),
            ..base.clone()
        },
    ] {
        assert!(!same_inputs(&mutated, &plan(4)));
    }
    // 产物文件已不存在的单元不沿用，回到重做。
    std::fs::remove_file(state.unit_path("base", 1)).unwrap();
    let scope = redo_scope(&base_units, &plan(4), has_audio_in(&state));
    assert_eq!(scope.summary().inheritable_units, 2);
    assert_eq!(scope.summary().redo_indexes, vec![1]);
    let derived = derive(
        &db,
        &state,
        Derivation {
            run_id: "redo",
            project_id: "p",
            chapter_id: "c",
            plan: &plan(4),
            parent: &base,
            kind: ChapterAudioKind::Redo,
        },
        &scope,
    )
    .await
    .unwrap();
    assert_eq!(derived.inherited_units, 2);
    assert_eq!(
        units(&db, "redo").await.unwrap()[1].status,
        "pending",
        "the unit with the missing file is synthesized again"
    );
}

#[tokio::test]
async fn retakes_wait_for_an_explicit_decision() {
    let (root, db) = db().await;
    let state = audio_state(&root);
    current_plan(&db, 12).await;
    insert(&db, "v1", "p", "c", &plan(4)).await.unwrap();
    let first = generated(&db, &state, "v1").await;
    let first_units = units(&db, "v1").await.unwrap();
    for invalid in [&[][..], &[0u32][..], &[9u32][..]] {
        assert_eq!(
            retake_scope(&first_units, invalid).unwrap_err(),
            ChapterAudioError::InvalidData
        );
    }
    let scope = retake_scope(&first_units, &[2, 2]).unwrap();
    assert_eq!(scope.redo_indexes, vec![2]);
    derive(
        &db,
        &state,
        Derivation {
            run_id: "take",
            project_id: "p",
            chapter_id: "c",
            plan: &plan(4),
            parent: &first,
            kind: ChapterAudioKind::Retake,
        },
        &scope,
    )
    .await
    .unwrap();
    // 未完成的重录版本不能被采用，也不能导出。
    let unfinished = find(&db, "take").await.unwrap();
    assert_eq!(
        decide(&db, &state, "p", "take", "early", Decision::Adopt)
            .await
            .unwrap_err(),
        ChapterAudioError::Conflict
    );
    assert_eq!(
        crate::chapter_audio::export::require_adopted(&unfinished).unwrap_err(),
        ChapterAudioError::Conflict
    );

    let done = generated(&db, &state, "take").await;
    assert_eq!(done.kind, "retake");
    assert_eq!(done.adoption, "pending", "a retake waits for the user");
    let multi = ChapterAudioMode::MultiRole;
    assert_eq!(
        latest_playable(&db, &state, "p", "c", Some(multi))
            .await
            .unwrap()
            .unwrap()
            .id,
        "v1",
        "the current version stays playable"
    );
    assert_eq!(
        latest_for_chapter(&db, "p", "c", None)
            .await
            .unwrap()
            .unwrap()
            .id,
        "take",
        "the pending retake is the chapter status"
    );
    assert_eq!(
        crate::chapter_audio::export::require_adopted(&done).unwrap_err(),
        ChapterAudioError::Conflict,
        "a pending version cannot be exported"
    );
    // 放弃只作用于待采用版本；重放不重复提交，同一操作换内容冲突。
    assert_eq!(
        decide(&db, &state, "p", "v1", "not-pending", Decision::Reject)
            .await
            .unwrap_err(),
        ChapterAudioError::Conflict
    );
    assert_eq!(
        decide(&db, &state, "p", "take", "op-reject", Decision::Reject)
            .await
            .unwrap()
            .adoption,
        "rejected"
    );
    decide(&db, &state, "p", "take", "op-reject", Decision::Reject)
        .await
        .unwrap();
    assert_eq!(
        decide(&db, &state, "p", "take", "op-reject", Decision::Adopt)
            .await
            .unwrap_err(),
        ChapterAudioError::Conflict
    );
    assert_eq!(
        latest_for_chapter(&db, "p", "c", None)
            .await
            .unwrap()
            .unwrap()
            .id,
        "v1",
        "a rejected version is not the chapter status"
    );
    assert_eq!(versions(&db, "p", "c", multi).await.unwrap().len(), 1);

    // 再次重录并采用：先前的当前版本让位。
    let scope = retake_scope(&first_units, &[3]).unwrap();
    derive(
        &db,
        &state,
        Derivation {
            run_id: "take2",
            project_id: "p",
            chapter_id: "c",
            plan: &plan(4),
            parent: &first,
            kind: ChapterAudioKind::Retake,
        },
        &scope,
    )
    .await
    .unwrap();
    let second = generated(&db, &state, "take2").await;
    assert_eq!(second.adoption, "pending");
    assert_eq!(
        decide(&db, &state, "p", "take2", "op-adopt", Decision::Adopt)
            .await
            .unwrap()
            .adoption,
        "adopted"
    );
    decide(&db, &state, "p", "take2", "op-adopt", Decision::Adopt)
        .await
        .unwrap();
    assert_eq!(
        decide(&db, &state, "p", "take2", "op-adopt", Decision::Reject)
            .await
            .unwrap_err(),
        ChapterAudioError::Conflict
    );
    assert_eq!(find(&db, "v1").await.unwrap().adoption, "none");
    let adopted = find(&db, "take2").await.unwrap();
    assert!(crate::chapter_audio::export::require_adopted(&adopted).is_ok());
    assert_eq!(
        crate::chapter_audio::export::require_adopted(&find(&db, "v1").await.unwrap()).unwrap_err(),
        ChapterAudioError::Conflict,
        "a superseded version cannot be exported"
    );
    // 产物缺失的版本不能被采用。
    std::fs::remove_file(state.unit_path("v1", 3)).unwrap();
    assert_eq!(
        decide(&db, &state, "p", "v1", "readopt-missing", Decision::Adopt)
            .await
            .unwrap_err(),
        ChapterAudioError::Conflict
    );

    // 重新采用先前的版本：较新的版本让位，章节状态与当前版本都回到它。
    std::fs::copy(state.unit_path("take2", 3), state.unit_path("v1", 3)).unwrap();
    decide(&db, &state, "p", "v1", "readopt", Decision::Adopt)
        .await
        .unwrap();
    assert_eq!(find(&db, "take2").await.unwrap().adoption, "none");
    for current in [
        latest_for_chapter(&db, "p", "c", None)
            .await
            .unwrap()
            .unwrap(),
        latest_playable(&db, &state, "p", "c", None)
            .await
            .unwrap()
            .unwrap(),
    ] {
        assert_eq!(current.id, "v1");
        assert_eq!(current.adoption, "adopted");
    }
}

#[tokio::test]
async fn derived_runs_inherit_pauses_that_still_anchor_to_a_boundary() {
    use crate::chapter_audio::arrangement::{self, ChapterPauseEdit};
    let (root, db) = db().await;
    let state = audio_state(&root);
    current_plan(&db, 15).await;
    insert(&db, "base", "p", "c", &plan(5)).await.unwrap();
    let base = generated(&db, &state, "base").await;
    for (operation, expected, after_index, duration_ms) in
        [("pause-1", 0, 1u32, 500u32), ("pause-2", 1, 3u32, 300u32)]
    {
        arrangement::edit(
            &db,
            "p",
            "base",
            expected,
            operation,
            ChapterPauseEdit::Set {
                after_index,
                duration_ms,
            },
        )
        .await
        .unwrap();
    }

    // 新计划把第 1、2 个单元并为 3–9 的一个单元，并在 15–18 新增一个单元：
    // 锚定在字节 6 的停顿失去边界，锚定在字节 12 的停顿映射到新的第 2 个单元。
    let spoken = |segment_id: &str, start: u32, end: u32| PlannedUnit {
        segment_id: segment_id.into(),
        range: ByteRange { start, end },
        line: 0,
        target: BindingTarget::Narrator,
        voice: "zf_001".into(),
        empty: false,
    };
    let merged = Plan {
        units: vec![
            PlannedUnit {
                empty: true,
                ..spoken("s0", 0, 3)
            },
            spoken("s1", 3, 9),
            spoken("s2", 9, 12),
            spoken("s3", 12, 15),
            spoken("s4", 15, 18),
        ],
        ..plan(5)
    };
    let scope = redo_scope(
        &units(&db, "base").await.unwrap(),
        &merged,
        has_audio_in(&state),
    );
    assert_eq!(
        scope.summary().redo_indexes,
        vec![1, 4],
        "a merged range and a new range are synthesized"
    );
    let derived = derive(
        &db,
        &state,
        Derivation {
            run_id: "redo",
            project_id: "p",
            chapter_id: "c",
            plan: &merged,
            parent: &base,
            kind: ChapterAudioKind::Redo,
        },
        &scope,
    )
    .await
    .unwrap();
    assert_eq!(derived.dropped_pauses, 1);
    let inherited = arrangement::read(&db, &derived).await.unwrap();
    assert_eq!(inherited.revision, 1);
    assert!(!inherited.can_undo, "inherited pauses are not a user edit");
    assert_eq!(
        inherited.pauses,
        vec![arrangement::Pause {
            after_index: 2,
            duration_ms: 300,
        }]
    );
    let source = arrangement::read(&db, &base).await.unwrap();
    assert_eq!(source.revision, 2);
    assert_eq!(
        source.pauses.len(),
        2,
        "the source arrangement is unchanged"
    );
}

#[tokio::test]
async fn redo_preview_is_read_only_and_only_reports_compatible_sources() {
    let (root, db) = db().await;
    let audio = root.path().join("audio");
    let state = audio_state(&root);
    insert(&db, "base", "p", "c", &plan(4)).await.unwrap();
    generated(&db, &state, "base").await;
    let mut changed = plan(4);
    changed.units[2].voice = "zf_002".into();

    let summary = redo_preview(&db, &state, &changed, "p", "c", "base")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (
            summary.inheritable_units,
            summary.redo_units,
            summary.redo_indexes
        ),
        (2, 1, vec![2])
    );
    // 来源不存在、不属于本章或执行配置与当前计划不同：不报告范围，也不报错。
    assert_eq!(
        redo_preview(&db, &state, &changed, "p", "c", "missing")
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        redo_preview(&db, &state, &changed, "p", "other", "base")
            .await
            .unwrap(),
        None
    );
    let mut other_model = changed.clone();
    other_model.model = "other-model".into();
    assert_eq!(
        redo_preview(&db, &state, &other_model, "p", "c", "base")
            .await
            .unwrap(),
        None
    );
    // 预检只读：没有新任务，也没有为沿用准备任何副本。
    assert_eq!(run::Entity::find().count(&db).await.unwrap(), 1);
    let mut entries = std::fs::read_dir(&audio)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    entries.sort();
    assert_eq!(entries, vec![std::ffi::OsString::from("base")]);
}
