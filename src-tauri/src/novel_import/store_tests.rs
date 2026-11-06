use super::{DraftEdit, store::ImportState};
use crate::project::ProjectError;
use std::sync::{Arc, Barrier};

fn setup() -> (tempfile::TempDir, ImportState, super::ImportSnapshot) {
    let dir = tempfile::tempdir().unwrap();
    let state = ImportState::new(dir.path().join("drafts"));
    let draft = state.create("测试整书".into(), String::new()).unwrap();
    (dir, state, draft)
}

#[test]
fn frozen_selection_survives_file_changes_and_failed_confirmation_preserves_draft() {
    let (dir, state, draft) = setup();
    let input = dir.path().join("book.txt");
    let text = "\u{feff}第一章 夜\r\n正文😀\r第二章 晨\n正文e\u{301}";
    std::fs::write(&input, text).unwrap();
    let selected = state.select(&input, Some("utf-8")).unwrap();
    std::fs::write(&input, "changed external file").unwrap();
    assert!(
        state
            .confirm(&draft.id, draft.revision, &selected.id, "unknown", true)
            .is_err()
    );
    assert_eq!(
        state.read(&draft.id).unwrap().document.project.revision,
        draft.revision
    );
    let confirmed = state
        .confirm(&draft.id, draft.revision, &selected.id, "utf-8", true)
        .unwrap();
    let record = state.read(&draft.id).unwrap();
    assert_eq!(record.document.project.sources[0].text, text);
    assert_eq!(confirmed.chapters.len(), 2);
    for bytes in [vec![0xff], b" \r\n".to_vec(), b"text\0hidden".to_vec()] {
        std::fs::write(&input, bytes).unwrap();
        assert!(state.select(&input, Some("utf-8")).is_err());
        assert_eq!(
            state.read(&draft.id).unwrap().document.project.revision,
            confirmed.revision
        );
    }
    let reopened = ImportState::new(dir.path().join("drafts"));
    assert_eq!(reopened.list().unwrap()[0].revision, confirmed.revision);
}

#[test]
fn raw_limit_and_ambiguous_encoding_require_explicit_confirmation() {
    let (dir, state, draft) = setup();
    let input = dir.path().join("book.txt");
    std::fs::write(&input, "plain ASCII text").unwrap();
    let selected = state.select(&input, None).unwrap();
    assert_eq!(selected.encoding, "utf-8");
    assert_eq!(
        state.preview(&selected.id, "gb18030").unwrap().encoding,
        "gb18030"
    );
    let confirmed = state
        .confirm(&draft.id, draft.revision, &selected.id, "gb18030", false)
        .unwrap();
    assert_eq!(confirmed.sources[0].encoding, "gb18030");
    std::fs::File::create(&input)
        .unwrap()
        .set_len(32 * 1024 * 1024 + 1)
        .unwrap();
    assert!(matches!(
        state.select(&input, None),
        Err(ProjectError::TooLarge)
    ));
    assert_eq!(
        state.read(&draft.id).unwrap().document.project.revision,
        confirmed.revision
    );
}

#[test]
fn independent_hosts_compare_revision_under_the_same_draft_lock() {
    let (dir, _, draft) = setup();
    let barrier = Arc::new(Barrier::new(2));
    let threads: Vec<_> = (0..2)
        .map(|index| {
            let state = ImportState::new(dir.path().join("drafts"));
            let barrier = barrier.clone();
            let id = draft.id.clone();
            std::thread::spawn(move || {
                barrier.wait();
                state.edit(
                    &id,
                    draft.revision,
                    DraftEdit::Info {
                        title: format!("writer {index}"),
                        description: String::new(),
                    },
                )
            })
        })
        .collect();
    let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| matches!(r, Err(ProjectError::Conflict)))
            .count(),
        1
    );
}

#[cfg(unix)]
#[test]
fn failed_metadata_publish_keeps_the_previous_recoverable_draft() {
    use std::os::unix::fs::PermissionsExt;
    let (dir, state, draft) = setup();
    let folder = dir.path().join("drafts").join(&draft.id);
    // The lock must exist before making the directory read-only.
    state.update(&draft.id, None, |_| Ok(())).unwrap();
    let before = std::fs::read(folder.join("recovery.json")).unwrap();
    std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o500)).unwrap();
    let result = state.edit(
        &draft.id,
        draft.revision,
        DraftEdit::Info {
            title: "should not publish".into(),
            description: String::new(),
        },
    );
    std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(matches!(result, Err(ProjectError::WriteFailed)));
    assert_eq!(std::fs::read(folder.join("recovery.json")).unwrap(), before);
    assert_eq!(
        state.read(&draft.id).unwrap().document.project.title,
        draft.title
    );
}

#[test]
#[ignore = "explicit capacity acceptance: writes a 128 MiB public synthetic book"]
fn initial_capacity_boundaries_roundtrip_with_ten_thousand_chapters() {
    let started = std::time::Instant::now();
    let (dir, state, draft) = setup();
    let mut current = draft;
    for part in 0..4 {
        let mut text = (1..=2500)
            .map(|i| format!("第{}章 合成容量验收\n公开合成正文。\n", part * 2500 + i))
            .collect::<String>();
        while text.len() < 32 * 1024 * 1024 {
            let remaining = 32 * 1024 * 1024 - text.len();
            let count = remaining.min(1024);
            text.extend(std::iter::repeat_n('a', count.saturating_sub(1)));
            text.push('\n');
        }
        let input = dir.path().join(format!("synthetic-{part}.txt"));
        std::fs::write(&input, &text).unwrap();
        let selected = state.select(&input, Some("utf-8")).unwrap();
        current = state
            .confirm(&current.id, current.revision, &selected.id, "utf-8", true)
            .unwrap();
        eprintln!(
            "capacity: {} MiB / {} chapters after {:?}",
            (part + 1) * 32,
            current.chapters.len(),
            started.elapsed()
        );
    }
    assert_eq!(current.chapters.len(), 10000);
    let record = state.read(&current.id).unwrap();
    assert_eq!(
        record
            .document
            .project
            .sources
            .iter()
            .map(|s| s.text.len())
            .sum::<usize>(),
        crate::project::MAX_TOTAL
    );
    let page = state
        .text(&current.id, &current.sources[3].id, 4998, 2)
        .unwrap();
    assert!(!page.lines.is_empty());
    drop(record);
    let extra = dir.path().join("extra.txt");
    std::fs::write(&extra, "one byte beyond the total limit").unwrap();
    let selection = state.select(&extra, None).unwrap();
    assert!(matches!(
        state.confirm(&current.id, current.revision, &selection.id, "utf-8", true),
        Err(ProjectError::TooLarge)
    ));
    let target = dir.path().join("capacity.castglean");
    state
        .save_to(&current.id, current.revision, &target)
        .unwrap();
    let reopened = crate::project::read(&target).unwrap();
    assert_eq!(reopened.project.chapters.len(), 10000);
    assert_eq!(reopened.project.sources.len(), 4);
    eprintln!(
        "capacity roundtrip completed in {:?}; public fixture directory: {}",
        started.elapsed(),
        dir.path().display()
    );
    // Retain the public inputs for the separate desktop responsiveness check.
    let _ = dir.keep();
}
