use super::*;
use sea_orm::{ConnectionTrait, DbBackend, Statement};

async fn empty() -> (tempfile::TempDir, DatabaseConnection, Selections) {
    let (root, db, mut state) = project::test_support::fixture().await;
    state.document.project.sources.clear();
    state.document.project.chapters.clear();
    state.edit.rules = serde_json::to_value(super::super::heading_rules()).unwrap();
    store::save(&db, root.path(), &state, None).await.unwrap();
    (root, db, Selections::default())
}
fn request(preview: &super::super::selection::FilePreview) -> ImportSource {
    ImportSource {
        project_id: "project".into(),
        revision: 1,
        selection_id: preview.id.clone(),
        encoding: preview.encoding.clone(),
        split: true,
        command_id: uuid::Uuid::new_v4().to_string(),
    }
}
#[tokio::test]
async fn frozen_selection_survives_input_removal_and_replay_does_not_require_a_selection() {
    let (root, db, selections) = empty().await;
    let text = "\u{feff}第一章 开始\r\n正文🙂\r第二章 继续\n正文e\u{301}";
    let input = root.path().join("原文.txt");
    std::fs::write(&input, text).unwrap();
    let preview = selections.select(&input).unwrap();
    let request = request(&preview);
    std::fs::write(&input, "已改变的外部文件").unwrap();
    std::fs::remove_file(&input).unwrap();
    let result = confirm(&db, root.path(), &selections, request.clone())
        .await
        .unwrap();
    assert!(selections.get(&preview.id).is_err());
    assert_eq!(
        confirm(&db, root.path(), &selections, request)
            .await
            .unwrap(),
        result
    );
    let saved = store::read(&db, root.path(), "project").await.unwrap();
    assert_eq!(saved.document.project.revision, 2);
    assert_eq!(saved.document.project.sources.len(), 1);
    assert_eq!(saved.document.project.sources[0].text, text);
    assert_eq!(saved.document.project.chapters.len(), 2);
    let source = &saved.document.project.sources[0];
    assert_eq!(
        std::fs::read(root.path().join(format!("{}.raw", source.raw_sha256))).unwrap(),
        text.as_bytes()
    );
    let page = project::read_source_text(&db, root.path(), "project", &source.id, 0, 10)
        .await
        .unwrap();
    assert_eq!(
        page.lines
            .iter()
            .map(|l| l.text.as_str())
            .collect::<String>(),
        text
    );
    assert!(matches!(
        project::read_source_text(&db, root.path(), "other", &source.id, 0, 10).await,
        Err(ProjectError::NotFound)
    ));
    std::fs::write(root.path().join(format!("{}.txt", source.sha256)), "损坏").unwrap();
    assert!(matches!(
        project::read_source_text(&db, root.path(), "project", &source.id, 0, 10).await,
        Err(ProjectError::ChecksumMismatch)
    ));
}

#[tokio::test]
async fn failed_import_receipt_keeps_selection_and_rolls_back_every_database_reference() {
    let (root, db, selections) = empty().await;
    let input = root.path().join("章节.txt");
    std::fs::write(&input, "第一章 标题\n正文").unwrap();
    let preview = selections.select(&input).unwrap();
    let request = request(&preview);
    db.execute_raw(Statement::from_string(DbBackend::Sqlite,"CREATE TRIGGER reject_import BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'receipt failure'); END")).await.unwrap();
    assert!(
        confirm(&db, root.path(), &selections, request.clone())
            .await
            .is_err()
    );
    let saved = store::read(&db, root.path(), "project").await.unwrap();
    assert_eq!(saved.document.project.revision, 1);
    assert!(saved.document.project.sources.is_empty());
    assert!(saved.edit.undo.is_none());
    assert!(selections.get(&preview.id).is_ok());
    db.execute_raw(Statement::from_string(
        DbBackend::Sqlite,
        "DROP TRIGGER reject_import",
    ))
    .await
    .unwrap();
    let result = confirm(&db, root.path(), &selections, request.clone())
        .await
        .unwrap();
    assert_eq!(result.revision, 2);
    assert_eq!(
        confirm(&db, root.path(), &selections, request)
            .await
            .unwrap(),
        result
    );
}

#[tokio::test]
async fn concurrent_confirmations_of_the_same_command_commit_one_source_and_revision() {
    let (root, db, selections) = empty().await;
    let input = root.path().join("章节.txt");
    std::fs::write(&input, "第一章 标题\n正文").unwrap();
    let preview = selections.select(&input).unwrap();
    let request = request(&preview);
    let (a, b) = tokio::join!(
        confirm(&db, root.path(), &selections, request.clone()),
        confirm(&db, root.path(), &selections, request)
    );
    assert_eq!(a.unwrap(), b.unwrap());
    let saved = store::read(&db, root.path(), "project").await.unwrap();
    assert_eq!(saved.document.project.revision, 2);
    assert_eq!(saved.document.project.sources.len(), 1);
}

#[tokio::test]
async fn duplicate_source_is_distinct_from_revision_conflict() {
    let (root, db, selections) = empty().await;
    let input = root.path().join("章节.txt");
    std::fs::write(&input, "第一章 标题\n正文").unwrap();
    let first = selections.select(&input).unwrap();
    confirm(&db, root.path(), &selections, request(&first))
        .await
        .unwrap();
    let second = selections.select(&input).unwrap();
    let mut next = request(&second);
    assert!(matches!(
        confirm(&db, root.path(), &selections, next.clone()).await,
        Err(ProjectError::Conflict)
    ));
    next.revision = 2;
    assert!(matches!(
        confirm(&db, root.path(), &selections, next).await,
        Err(ProjectError::DuplicateSource)
    ));
    assert!(selections.get(&second.id).is_ok());
    assert_eq!(
        store::read(&db, root.path(), "project")
            .await
            .unwrap()
            .document
            .project
            .sources
            .len(),
        1
    );
}

#[tokio::test]
async fn partial_batch_survives_database_reopen_after_duplicate_is_removed() {
    let (root, db, selections) = empty().await;
    let mut revision = 1;
    for (name, text) in [("a.txt", "第一章\n山风"), ("b.txt", "第二章\n灯火")] {
        let path = root.path().join(name);
        std::fs::write(&path, text).unwrap();
        let preview = selections.select(&path).unwrap();
        let mut operation = request(&preview);
        operation.revision = revision;
        revision = confirm(&db, root.path(), &selections, operation)
            .await
            .unwrap()
            .revision;
    }
    let duplicate = selections.select(&root.path().join("a.txt")).unwrap();
    let mut operation = request(&duplicate);
    operation.revision = revision;
    assert!(matches!(
        confirm(&db, root.path(), &selections, operation).await,
        Err(ProjectError::DuplicateSource)
    ));
    selections.release(&duplicate.id).unwrap();
    db.close().await.unwrap();
    let reopened = crate::database::open(&root.path().join("app.sqlite3"))
        .await
        .unwrap();
    let saved = store::read(&reopened, root.path(), "project")
        .await
        .unwrap();
    assert_eq!(saved.document.project.revision, 3);
    assert_eq!(
        saved
            .document
            .project
            .sources
            .iter()
            .map(|s| s.filename.as_str())
            .collect::<Vec<_>>(),
        ["a.txt", "b.txt"]
    );
    assert_eq!(
        saved
            .document
            .project
            .sources
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>(),
        ["第一章\n山风", "第二章\n灯火"]
    );
}
