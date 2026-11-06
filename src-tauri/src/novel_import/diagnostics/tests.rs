use super::*;
use crate::novel_import::store::ImportState;
pub(super) fn fixture() -> (tempfile::TempDir, ImportState, String) {
    let root = tempfile::tempdir().unwrap();
    let state = ImportState::new(root.path().join("drafts"));
    let snapshot = state.create("Book".into(), String::new()).unwrap();
    let input = root.path().join("book.txt");
    std::fs::write(&input, "第一章 开始\n正文\n第二章 继续\n正文").unwrap();
    let selected = state.select(&input, Some("utf-8")).unwrap();
    state
        .confirm(&snapshot.id, snapshot.revision, &selected.id, "utf-8", true)
        .unwrap();
    state
            .update(&snapshot.id, None, |r| {
                r.diagnostics.push(DiagnosticRecord {
                    id: "session".into(),
                    run_id: "run".into(),
                    graph_version: 1,
                    selection: crate::llm::ModelSelection {
                        connection_id: "c".into(),
                        model_id: "m".into(),
                    },
                    configuration_revision: 1,
                    base_revision: r.document.project.revision,
                    hashes: current_hashes(r),
                    status: DiagnosticStatus::Running,
                    messages: vec![DiagnosticMessage { id: "user".into(), role: "user".into(), interrupted: false, parts: vec![DiagnosticPart::Text { text: "请用工具测试一条匹配章节标题的规则，并提交方案，即使当前章节数正确也需要候选供我确认。".into() }] }, DiagnosticMessage { id: "assistant".into(), role: "assistant".into(), interrupted: false, parts: vec![] }],
                    proposals: vec![],
                    calls: vec![],
                    requests: 0,
                    turn_requests: 0,
                    tool_calls: 0,
                    input_bytes: 0,
                    tool_bytes: 0,
                    in_flight: false,
                    error: None,
                    started_at: String::new(),
                    input_tokens: None,
                    output_tokens: None,
                    graph: None,
                });
                Ok(())
            })
            .unwrap();
    (root, state, snapshot.id)
}

#[test]
fn failed_dispatch_budget_is_durable_across_reload_and_model_changes() {
    let (_root, state, draft) = fixture();
    for _ in 0..8 {
        state
            .update(&draft, None, |r| {
                budget::reserve_request(record_mut(r, "session")?, 1024)
            })
            .unwrap();
    }
    assert!(
        state
            .update(&draft, None, |r| budget::reserve_request(
                record_mut(r, "session")?,
                1024
            ))
            .is_err()
    );
    state
        .update(&draft, None, |r| {
            let d = record_mut(r, "session")?;
            d.selection.model_id = "another".into();
            d.turn_requests = 0;
            d.requests = 64;
            Ok(())
        })
        .unwrap();
    assert!(
        state
            .update(&draft, None, |r| budget::reserve_request(
                record_mut(r, "session")?,
                1024
            ))
            .is_err()
    );
    assert_eq!(state.read(&draft).unwrap().diagnostics[0].calls.len(), 8);
    assert_eq!(
        state.read(&draft).unwrap().diagnostics[0].calls[0]
            .selection
            .model_id,
        "m"
    );
}

#[test]
fn undo_restores_rules_and_single_file_mode_survives_redetection() {
    let (_root, state, draft) = fixture();
    let original = state.read(&draft).unwrap();
    let changed = state
        .edit(
            &draft,
            original.document.project.revision,
            crate::novel_import::DraftEdit::Rules { rules: vec![] },
        )
        .unwrap();
    assert_eq!(changed.chapters.len(), 1);
    let restored = state
        .edit(
            &draft,
            changed.revision,
            crate::novel_import::DraftEdit::Undo,
        )
        .unwrap();
    assert_eq!(restored.chapters.len(), 2);
    assert_eq!(restored.rules.len(), original.rules.len());
    assert!(!restored.can_undo);
    state
        .update(&draft, None, |r| {
            r.single_chapter_sources
                .push(r.document.project.sources[0].id.clone());
            r.recalculate(&tokio_util::sync::CancellationToken::new())
        })
        .unwrap();
    assert_eq!(
        state.read(&draft).unwrap().document.project.chapters.len(),
        1
    );
}

#[test]
fn draft_mutation_holds_run_registry_until_publication() {
    let (_root, state, draft) = fixture();
    let state = std::sync::Arc::new(state);
    let worker = state.clone();
    let (entered, entering) = std::sync::mpsc::channel();
    let (release, released) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || {
        worker.update_idle(&draft, None, |r| {
            entered.send(()).unwrap();
            released.recv().unwrap();
            r.document.project.title = "Manual edit".into();
            Ok(())
        })
    });
    entering
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    assert!(state.running.try_lock().is_err());
    release.send(()).unwrap();
    thread.join().unwrap().unwrap();
    assert!(state.running.try_lock().is_ok());
}

#[test]
fn manual_edit_after_portable_reopen_keeps_the_saved_partition() {
    let (_root, state, draft) = fixture();
    let record = state.read(&draft).unwrap();
    state
        .edit(
            &draft,
            record.document.project.revision,
            crate::novel_import::DraftEdit::Rules { rules: vec![] },
        )
        .unwrap();
    let saved = state.export_document(&draft).unwrap();
    let source = saved.project.sources[0].id.clone();
    let exact_text = saved.project.sources[0].text.clone();
    let opened = state.install(saved, "book.castglean".into()).unwrap();
    let edited = state
        .edit(
            &opened.id,
            opened.revision,
            crate::novel_import::DraftEdit::Boundary {
                correction: crate::project::Correction {
                    source_id: source,
                    line: 0,
                    include: true,
                    title: Some("Manual title".into()),
                    volume_id: None,
                },
            },
        )
        .unwrap();
    assert_eq!(edited.chapters.len(), 1);
    assert_eq!(edited.chapters[0].title, "Manual title");
    assert_eq!(
        state.export_document(&opened.id).unwrap().project.sources[0].text,
        exact_text
    );
}

#[test]
fn manual_volumes_and_explicit_groups_survive_rule_redetection() {
    let (_root, state, draft) = fixture();
    let original = state.read(&draft).unwrap();
    let source = original.document.project.sources[0].id.clone();
    let first = state
        .edit(
            &draft,
            original.document.project.revision,
            crate::novel_import::DraftEdit::Volume {
                source_id: source.clone(),
                line: 0,
                title: "First volume".into(),
            },
        )
        .unwrap();
    let first_volume = first.volumes[0].id.clone();
    assert!(
        first
            .chapters
            .iter()
            .all(|chapter| chapter.volume_id.as_ref() == Some(&first_volume))
    );
    let second = state
        .edit(
            &draft,
            first.revision,
            crate::novel_import::DraftEdit::Volume {
                source_id: source.clone(),
                line: 2,
                title: "Second volume".into(),
            },
        )
        .unwrap();
    assert_ne!(second.chapters[0].volume_id, second.chapters[1].volume_id);
    let explicit = state
        .edit(
            &draft,
            second.revision,
            crate::novel_import::DraftEdit::Boundary {
                correction: crate::project::Correction {
                    source_id: source,
                    line: 2,
                    include: true,
                    title: None,
                    volume_id: Some(first_volume.clone()),
                },
            },
        )
        .unwrap();
    let detected = state
        .edit(
            &draft,
            explicit.revision,
            crate::novel_import::DraftEdit::Rules {
                rules: original.rules,
            },
        )
        .unwrap();
    assert_eq!(detected.volumes.len(), 2);
    assert!(detected.volumes.iter().all(|volume| volume.manual));
    assert!(
        detected
            .chapters
            .iter()
            .all(|chapter| chapter.volume_id.as_ref() == Some(&first_volume))
    );
}

#[test]
fn wire_history_and_tool_result_budgets_survive_reopen() {
    let (root, state, draft) = fixture();
    state
        .update(&draft, None, |r| {
            let d = record_mut(r, "session")?;
            for _ in 0..4 {
                budget::reserve_request(d, 1024)?;
                // The actual provider body includes all retransmitted history.
                budget::account_wire(d, 128 * 1024)?;
            }
            for _ in 0..24 {
                budget::reserve_tool(d)?;
            }
            for _ in 0..8 {
                budget::account_tool(d, 8192)?;
            }
            Ok(())
        })
        .unwrap();
    let reopened = ImportState::new(root.path().join("drafts"));
    assert!(
        reopened
            .update(&draft, None, |r| budget::reserve_request(
                record_mut(r, "session")?,
                1
            ))
            .is_err()
    );
    assert!(
        reopened
            .update(&draft, None, |r| budget::reserve_tool(record_mut(
                r, "session"
            )?))
            .is_err()
    );
    assert!(
        reopened
            .update(&draft, None, |r| budget::account_tool(
                record_mut(r, "session")?,
                1
            ))
            .is_err()
    );
    let d = reopened.read(&draft).unwrap().diagnostics.remove(0);
    assert_eq!(
        (d.requests, d.tool_calls, d.input_bytes, d.tool_bytes),
        (4, 24, 512 * 1024, 64 * 1024)
    );
    assert!(d.input_tokens.is_none() && d.output_tokens.is_none());
}

#[test]
fn recovery_preserves_committed_effects_and_interrupts_only_unfinished_work() {
    for cut in ["before_node", "after_node", "after_tool", "during_model"] {
        let (root, state, draft) = fixture();
        state
            .update(&draft, None, |r| {
                let d = record_mut(r, "session")?;
                d.graph = Some(
                    graph_flow::Session::new_from_task(
                        "session".into(),
                        if cut == "before_node" {
                            "prepare"
                        } else {
                            "diagnose"
                        },
                    )
                    .with_graph_id("chapter-splitting-v1"),
                );
                budget::reserve_request(d, 1024)?;
                d.messages
                    .last_mut()
                    .unwrap()
                    .parts
                    .push(DiagnosticPart::Text {
                        text: "committed partial reply".into(),
                    });
                d.messages
                    .last_mut()
                    .unwrap()
                    .parts
                    .push(DiagnosticPart::Tool {
                        id: "tool".into(),
                        name: "directory".into(),
                        input: "{}".into(),
                        output: if cut == "after_tool" {
                            Some("committed result".into())
                        } else {
                            None
                        },
                        failed: false,
                    });
                Ok(())
            })
            .unwrap();
        let reopened = ImportState::new(root.path().join("drafts"));
        let snapshot = reopened
            .recover_diagnostic_snapshot(&draft, None)
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.status, DiagnosticStatus::Interrupted, "{cut}");
        assert_eq!(snapshot.requests, 1);
        assert_eq!(snapshot.calls[0].status, ModelCallStatus::Interrupted);
        let parts = &snapshot.messages.last().unwrap().parts;
        assert!(parts.iter().any(
            |p| matches!(p,DiagnosticPart::Text { text } if text == "committed partial reply")
        ));
        assert!(parts.iter().any(|p| matches!(p,DiagnosticPart::Tool {output:Some(text),..} if text == if cut == "after_tool" { "committed result" } else { "interrupted" })));
        assert_eq!(
            reopened
                .recover_diagnostic_snapshot(&draft, None)
                .unwrap()
                .unwrap()
                .sequence,
            snapshot.sequence
        );
    }
}

#[test]
fn subscription_and_concurrent_publication_always_deliver_the_latest_sequence() {
    let (_root, state, draft) = fixture();
    let state = std::sync::Arc::new(state);
    let received = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u64>::new()));
    let capture = received.clone();
    let channel = tauri::ipc::Channel::new(move |message| {
        let value: serde_json::Value = message.deserialize()?;
        capture
            .lock()
            .unwrap()
            .push(value["sequence"].as_u64().unwrap());
        Ok(())
    });
    let writer = state.clone();
    let id = draft.clone();
    let update = std::thread::spawn(move || {
        for _ in 0..8 {
            writer.update(&id, None, |_| Ok(())).unwrap();
            writer.notify(&id, "session");
        }
    });
    state
        .subscribe_diagnostic(
            &draft,
            "session",
            &uuid::Uuid::new_v4().to_string(),
            channel,
        )
        .unwrap();
    update.join().unwrap();
    let latest = state
        .diagnostic_snapshot(&draft, "session")
        .unwrap()
        .sequence;
    assert_eq!(received.lock().unwrap().last(), Some(&(latest as u64)));
    // A reconnect immediately gets authoritative state, even without another event.
    let capture = received.clone();
    let channel = tauri::ipc::Channel::new(move |message| {
        let value: serde_json::Value = message.deserialize()?;
        capture
            .lock()
            .unwrap()
            .push(value["sequence"].as_u64().unwrap());
        Ok(())
    });
    state
        .subscribe_diagnostic(
            &draft,
            "session",
            &uuid::Uuid::new_v4().to_string(),
            channel,
        )
        .unwrap();
    assert_eq!(received.lock().unwrap().last(), Some(&(latest as u64)));
}
