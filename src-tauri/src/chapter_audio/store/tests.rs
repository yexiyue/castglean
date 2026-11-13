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
        version_id: "v1".into(),
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
