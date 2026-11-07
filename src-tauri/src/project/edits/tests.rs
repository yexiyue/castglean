use super::*;
use crate::project::{self, test_support::fixture};
use sea_orm::{ConnectionTrait, DbBackend, Statement};

async fn edit(
    db: &DatabaseConnection,
    root: &Path,
    revision: u32,
    change: ProjectEdit,
) -> CommandResult {
    apply(
        db,
        root,
        "project",
        revision,
        &uuid::Uuid::new_v4().to_string(),
        change,
    )
    .await
    .unwrap()
}
#[tokio::test]
async fn manual_edits_preserve_source_identity_corrections_and_undo_without_replaying_receipts() {
    let (root, db, state) = fixture().await;
    store::save(&db, root.path(), &state, None).await.unwrap();
    let rules = novel_import::heading_rules();
    edit(
        &db,
        root.path(),
        1,
        ProjectEdit::Rules {
            rules: rules.clone(),
        },
    )
    .await;
    let split = store::read(&db, root.path(), "project").await.unwrap();
    let first = split
        .document
        .project
        .chapters
        .iter()
        .find(|c| c.heading == Some(0))
        .unwrap()
        .id
        .clone();
    edit(
        &db,
        root.path(),
        2,
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
    .await;
    edit(&db, root.path(), 3, ProjectEdit::Rules { rules }).await;
    edit(
        &db,
        root.path(),
        4,
        ProjectEdit::Volume {
            source_id: "source".into(),
            line: 0,
            title: "人工卷".into(),
        },
    )
    .await;
    let command = uuid::Uuid::new_v4().to_string();
    let info = ProjectEdit::Info {
        title: "修改名称".into(),
        description: "说明".into(),
    };
    let result = apply(&db, root.path(), "project", 5, &command, info.clone())
        .await
        .unwrap();
    let saved = store::read(&db, root.path(), "project").await.unwrap();
    assert_eq!(
        saved.document.project.sources[0].sha256,
        state.document.project.sources[0].sha256
    );
    assert_eq!(
        saved
            .document
            .project
            .chapters
            .iter()
            .find(|c| c.heading == Some(0))
            .unwrap()
            .id,
        first
    );
    assert!(
        saved
            .document
            .project
            .chapters
            .iter()
            .any(|c| c.title == "人工标题")
    );
    assert!(
        saved
            .document
            .project
            .volumes
            .iter()
            .any(|v| v.manual && v.title == "人工卷")
    );
    assert_eq!(saved.document.project.title, "修改名称");
    undo(
        &db,
        root.path(),
        "project",
        6,
        &uuid::Uuid::new_v4().to_string(),
    )
    .await
    .unwrap();
    assert_eq!(
        apply(&db, root.path(), "project", 5, &command, info)
            .await
            .unwrap(),
        result
    );
    let restored = store::read(&db, root.path(), "project").await.unwrap();
    assert_eq!(restored.document.project.revision, 7);
    assert_eq!(
        restored.document.project.title,
        state.document.project.title
    );
    assert!(
        restored
            .document
            .project
            .chapters
            .iter()
            .any(|c| c.id == first && c.title == "人工标题")
    );
}

#[tokio::test]
async fn failed_edit_receipt_rolls_back_all_project_changes() {
    let (root, db, state) = fixture().await;
    store::save(&db, root.path(), &state, None).await.unwrap();
    db.execute_raw(Statement::from_string(DbBackend::Sqlite,"CREATE TRIGGER reject_edit BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'receipt failure'); END")).await.unwrap();
    assert!(
        apply(
            &db,
            root.path(),
            "project",
            1,
            &uuid::Uuid::new_v4().to_string(),
            ProjectEdit::Info {
                title: "不应保存".into(),
                description: String::new()
            }
        )
        .await
        .is_err()
    );
    let saved = store::read(&db, root.path(), "project").await.unwrap();
    assert_eq!(saved.document.project.revision, 1);
    assert_eq!(saved.document.project.title, state.document.project.title);
    assert_eq!(
        saved.document.project.chapters[0].id,
        state.document.project.chapters[0].id
    );
    assert!(saved.edit.undo.is_none());
}
