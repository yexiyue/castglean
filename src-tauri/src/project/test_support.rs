//! Shared source-backed SQLite project fixture.
use super::{Chapter, ProjectDocument, Source, assets, store::*};
use sea_orm::DatabaseConnection;
use serde_json::json;

pub(crate) async fn fixture() -> (tempfile::TempDir, DatabaseConnection, LocalProject) {
    let dir = tempfile::tempdir().unwrap();
    let db = crate::database::open(&dir.path().join("app.sqlite3"))
        .await
        .unwrap();
    let text = "\u{feff}第一章 开始\r\n正文🙂\r第二章 继续\n正文e\u{301}";
    let source = Source {
        id: "source".into(),
        filename: "book.txt".into(),
        encoding: "utf-8".into(),
        raw_sha256: super::hash(text.as_bytes()),
        sha256: super::hash(text.as_bytes()),
        text: text.into(),
    };
    assets::publish_source(dir.path(), &source, text.as_bytes()).unwrap();
    let mut document = ProjectDocument::new("project".into(), "测试小说".into(), String::new());
    document.project.chapters.push(Chapter {
        id: "chapter".into(),
        source_id: source.id.clone(),
        title: "第一章".into(),
        start: 0,
        end: text.len() as u32,
        heading: None,
        volume_id: None,
        predecessor_ids: vec![],
    });
    document.project.sources.push(source);
    let state = LocalProject {
        document,
        edit: EditState {
            rules: json!([]),
            issues: json!([]),
            single_chapter_sources: json!([]),
            undo: None,
        },
    };
    (dir, db, state)
}
