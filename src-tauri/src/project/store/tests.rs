use super::*;
use sea_orm::{DbBackend, Statement};
use serde_json::json;

use super::super::test_support::fixture;

#[tokio::test]
async fn project_roundtrip_preserves_bytes_corrections_identity_and_undo() {
    let (dir, db, mut state) = fixture().await;
    save(&db, dir.path(), &state, None).await.unwrap();
    let original = state.document.clone();
    state.edit.undo = Some(UndoState {
        document: original.clone(),
        rules: json!([]),
        issues: json!([]),
        single_chapter_sources: json!([]),
    });
    state.document.project.title = "人工更正".into();
    state.document.project.revision = 2;
    state
        .document
        .project
        .corrections
        .push(super::super::Correction {
            source_id: "source".into(),
            line: 0,
            include: true,
            title: Some("人工标题".into()),
            volume_id: None,
        });
    save(&db, dir.path(), &state, Some(1)).await.unwrap();
    db.close().await.unwrap();
    let db = crate::database::open(&dir.path().join("app.sqlite3"))
        .await
        .unwrap();
    let restored = read(&db, dir.path(), "project").await.unwrap();
    assert_eq!(
        json(&restored.document).unwrap(),
        json(&state.document).unwrap()
    );
    assert_eq!(
        json(&restored.edit.undo.unwrap().document).unwrap(),
        json(&original).unwrap()
    );
    let row = project_edit_state::Entity::find_by_id("project")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let undo = row.undo.unwrap().to_string();
    assert!(!undo.contains("正文"));
    assert!(!undo.contains("\"text\""));
}

#[tokio::test]
async fn failed_write_rolls_back_revision_title_and_partition() {
    let (dir, db, mut state) = fixture().await;
    save(&db, dir.path(), &state, None).await.unwrap();
    // Fail after the revision CAS and partition deletion, rather than before the transaction.
    db.execute_raw(Statement::from_string(DbBackend::Sqlite,
        "CREATE TRIGGER reject_chapter BEFORE INSERT ON chapters BEGIN SELECT RAISE(ABORT, 'injected failure'); END"))
        .await.unwrap();
    state.document.project.revision = 2;
    state.document.project.title = "不能提交".into();
    assert!(save(&db, dir.path(), &state, Some(1)).await.is_err());
    let restored = read(&db, dir.path(), "project").await.unwrap();
    assert_eq!(restored.document.project.revision, 1);
    assert_eq!(restored.document.project.title, "测试小说");
    assert_eq!(restored.document.project.chapters[0].id, "chapter");
}

#[tokio::test]
async fn concurrent_revision_cas_commits_only_one_edit() {
    let (dir, db, mut state) = fixture().await;
    save(&db, dir.path(), &state, None).await.unwrap();
    state.document.project.revision = 2;
    let (a, b) = tokio::join!(
        save(&db, dir.path(), &state, Some(1)),
        save(&db, dir.path(), &state, Some(1))
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    assert!(matches!(a.err().or(b.err()), Some(ProjectError::Conflict)));
}

#[tokio::test]
async fn corrupted_source_is_neither_read_nor_republished() {
    let (dir, db, state) = fixture().await;
    save(&db, dir.path(), &state, None).await.unwrap();
    let source = &state.document.project.sources[0];
    let path = dir.path().join(format!("{}.txt", source.sha256));
    std::fs::write(&path, "damaged").unwrap();
    assert!(matches!(
        read(&db, dir.path(), "project").await,
        Err(ProjectError::ChecksumMismatch)
    ));
    assert!(matches!(
        assets::publish_source(dir.path(), source, source.text.as_bytes()),
        Err(ProjectError::ChecksumMismatch)
    ));
    assert_eq!(std::fs::read_to_string(path).unwrap(), "damaged");
}

#[tokio::test]
async fn published_files_survive_failed_commit_without_a_success_record() {
    let (dir, db, state) = fixture().await;
    db.execute_raw(Statement::from_string(DbBackend::Sqlite,
        "CREATE TRIGGER reject_project BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'injected failure'); END"))
        .await.unwrap();
    assert!(save(&db, dir.path(), &state, None).await.is_err());
    assert!(matches!(
        read(&db, dir.path(), "project").await,
        Err(ProjectError::NotFound)
    ));
    assert_eq!(
        assets::text(dir.path(), &state.document.project.sources[0].sha256).unwrap(),
        state.document.project.sources[0].text
    );
}

#[tokio::test]
async fn undo_can_remove_source_then_reimport_without_stale_ordinals() {
    let (dir, db, mut state) = fixture().await;
    save(&db, dir.path(), &state, None).await.unwrap();
    let previous = state.document.clone();
    state.document.project.sources.clear();
    state.document.project.chapters.clear();
    state.document.project.revision = 2;
    state.edit.undo = Some(UndoState {
        document: previous.clone(),
        rules: json!([]),
        issues: json!([]),
        single_chapter_sources: json!([]),
    });
    save(&db, dir.path(), &state, Some(1)).await.unwrap();
    assert!(
        read(&db, dir.path(), "project")
            .await
            .unwrap()
            .document
            .project
            .sources
            .is_empty()
    );
    state.document = previous;
    state.document.project.revision = 3;
    save(&db, dir.path(), &state, Some(2)).await.unwrap();
    assert_eq!(
        read(&db, dir.path(), "project")
            .await
            .unwrap()
            .document
            .project
            .chapters
            .len(),
        1
    );
}

#[tokio::test]
async fn existing_source_identity_cannot_be_rebound_to_other_bytes() {
    let (dir, db, mut state) = fixture().await;
    save(&db, dir.path(), &state, None).await.unwrap();
    let old_hash = state.document.project.sources[0].sha256.clone();
    let source = &mut state.document.project.sources[0];
    source.text = "不同正文".into();
    source.sha256 = super::super::hash(source.text.as_bytes());
    source.raw_sha256 = source.sha256.clone();
    assets::publish_source(dir.path(), source, source.text.as_bytes()).unwrap();
    state.document.project.chapters[0].end = source.text.len() as u32;
    state.document.project.revision = 2;
    assert!(matches!(
        save(&db, dir.path(), &state, Some(1)).await,
        Err(ProjectError::Conflict)
    ));
    assert_eq!(
        read(&db, dir.path(), "project")
            .await
            .unwrap()
            .document
            .project
            .sources[0]
            .sha256,
        old_hash
    );
}

#[tokio::test]
async fn gbk_raw_copy_survives_deleted_input_and_retains_its_own_digest() {
    let (dir, db, mut state) = fixture().await;
    let text = "\u{feff}第一章\r\n中文正文\r第二章\n继续";
    // GBK has no BOM encoding; preserve the confirmed bytes without inventing one.
    let text = text.trim_start_matches('\u{feff}');
    let (raw, _, errors) = encoding_rs::GBK.encode(text);
    assert!(!errors);
    let input = dir.path().join("original.txt");
    std::fs::write(&input, &raw).unwrap();
    let source = &mut state.document.project.sources[0];
    source.encoding = "gbk".into();
    source.text = text.into();
    source.sha256 = super::super::hash(text.as_bytes());
    source.raw_sha256 = super::super::hash(&raw);
    assert_ne!(source.raw_sha256, source.sha256);
    assets::publish_source(dir.path(), source, &raw).unwrap();
    state.document.project.chapters[0].end = text.len() as u32;
    save(&db, dir.path(), &state, None).await.unwrap();
    std::fs::remove_file(input).unwrap();
    let restored = read(&db, dir.path(), "project").await.unwrap();
    assert_eq!(restored.document.project.sources[0].text, text);
    assert_eq!(
        std::fs::read(dir.path().join(format!(
            "{}.raw",
            restored.document.project.sources[0].raw_sha256
        )))
        .unwrap(),
        raw.as_ref()
    );
}

#[test]
fn raw_and_decoded_text_must_correspond() {
    let dir = tempfile::tempdir().unwrap();
    let source = Source {
        id: "s".into(),
        filename: "a.txt".into(),
        encoding: "utf-8".into(),
        raw_sha256: super::super::hash(b"original"),
        text: "other".into(),
        sha256: super::super::hash(b"other"),
    };
    assert!(matches!(
        assets::publish_source(dir.path(), &source, b"original"),
        Err(ProjectError::ChecksumMismatch)
    ));
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn undo_metadata_cannot_select_another_project_identity() {
    let (dir, db, mut state) = fixture().await;
    state.edit.undo = Some(UndoState {
        document: state.document.clone(),
        rules: json!([]),
        issues: json!([]),
        single_chapter_sources: json!([]),
    });
    save(&db, dir.path(), &state, None).await.unwrap();
    let row = project_edit_state::Entity::find_by_id("project")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let mut undo = row.undo.unwrap();
    undo["document"]["project"]["id"] = json!("other-project");
    project_edit_state::Entity::update_many()
        .col_expr(
            project_edit_state::Column::Undo,
            sea_orm::sea_query::Expr::value(undo),
        )
        .filter(project_edit_state::Column::ProjectId.eq("project"))
        .exec(&db)
        .await
        .unwrap();
    assert!(matches!(
        read(&db, dir.path(), "project").await,
        Err(ProjectError::InvalidProject)
    ));
}
