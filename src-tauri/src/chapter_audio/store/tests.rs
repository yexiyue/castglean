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
        source_sha256: "sha".into(),
        backend: "kokoro".into(),
        model: "1.1-zh".into(),
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
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        "INSERT INTO chapter_audio_runs VALUES ('r2', 'p', 'c', 'v', 'sha', 'kokoro', \
         '1.1-zh', 'cpu', 'queued', 'queued', 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, '1', \
         NULL)",
    ))
    .await
    .unwrap_err();
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
