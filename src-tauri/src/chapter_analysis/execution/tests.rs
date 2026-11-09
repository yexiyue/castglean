use super::*;
use crate::ai::{messages::MessagePart, runs};
use crate::database::entity::analysis_window;
use crate::database::entity::character;
use crate::{
    ai::{Configuration, CreateSession, StartRun, Trigger},
    llm::ModelSelection,
    project,
};
use sea_orm::{ActiveModelTrait, ConnectionTrait, EntityTrait, Set, TransactionTrait};

async fn fixture() -> (tempfile::TempDir, DatabaseConnection, String) {
    let (root, db, state) = project::test_support::fixture().await;
    project::store::save(&db, root.path(), &state, None)
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    ai::create_session(
        &db,
        CreateSession {
            id: id.clone(),
            project_id: "project".into(),
            chapter_id: Some("chapter".into()),
            task_kind: "chapter_analysis".into(),
            title: "分析".into(),
        },
    )
    .await
    .unwrap();
    (root, db, id)
}
async fn imported_fixture() -> (tempfile::TempDir, DatabaseConnection, String) {
    use crate::novel_import::{
        confirm::{ImportSource, confirm},
        selection::Selections,
    };
    let (root, db, mut state) = project::test_support::fixture().await;
    let text = state.document.project.sources[0].text.clone();
    state.document.project.sources.clear();
    state.document.project.chapters.clear();
    state.edit.rules = serde_json::to_value(crate::novel_import::heading_rules()).unwrap();
    project::store::save(&db, root.path(), &state, None)
        .await
        .unwrap();
    let path = root.path().join("公开合成原文.txt");
    std::fs::write(&path, &text).unwrap();
    let selections = Selections::default();
    let preview = selections.select(&path).unwrap();
    confirm(
        &db,
        root.path(),
        &selections,
        ImportSource {
            project_id: "project".into(),
            revision: 1,
            selection_id: preview.id,
            encoding: preview.encoding,
            split: true,
            command_id: uuid::Uuid::new_v4().to_string(),
        },
    )
    .await
    .unwrap();
    let mut state = project::store::read(&db, root.path(), "project")
        .await
        .unwrap();
    assert_eq!(state.document.project.chapters.len(), 2);
    assert_eq!(state.document.project.sources[0].text, text);
    let previous = state.document.project.revision;
    state.document.project.revision += 1;
    state.document.project.chapters[0].id = "chapter".into();
    project::store::save(&db, root.path(), &state, Some(previous))
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    ai::create_session(
        &db,
        CreateSession {
            id: id.clone(),
            project_id: "project".into(),
            chapter_id: Some("chapter".into()),
            task_kind: "chapter_analysis".into(),
            title: "导入后的章节分析".into(),
        },
    )
    .await
    .unwrap();
    (root, db, id)
}
async fn start(db: &DatabaseConnection, session: &str) -> (Lease, input::Input, Output) {
    let run = ai::start_analysis_run(
        db,
        StartRun {
            workspace_context: None,
            session_id: session.into(),
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: Configuration {
                selection: ModelSelection {
                    connection_id: "connection".into(),
                    model_id: "model".into(),
                },
                revision: 1,
            },
            confirm_rebind: false,
            expected_project_revision: crate::database::entity::project::Entity::find_by_id(
                "project",
            )
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .revision as u32,
            trigger: Trigger::Message {
                message: "分析本章".into(),
            },
        },
    )
    .await
    .unwrap();
    let lease = runs::claim(db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    let input = input::read(db, &run.id).await.unwrap();
    let output = Output::new(db.clone(), lease.clone());
    output.start(1).await.unwrap();
    (lease, input, output)
}
fn segment(binding: &SourceBinding) -> Segment {
    Segment {
        id: uuid::Uuid::new_v4().to_string(),
        range: ByteRange {
            start: binding.start,
            end: binding.end,
        },
        kind: SegmentKind::Speech,
        attribution: Attribution::Unknown,
        review: ReviewStatus::Unreviewed,
        evidence: vec![Evidence {
            range: ByteRange {
                start: binding.start,
                end: binding.end,
            },
            reason: "公开合成原文".into(),
        }],
        reason: "证据不足保留未知".into(),
    }
}

#[tokio::test]
async fn first_draft_edit_reopen_reanalysis_conflict_apply_and_undo() {
    let (root, db, session) = imported_fixture().await;
    let (lease, input, output) = start(&db, &session).await;
    let text = query::read_text(root.path(), &input.dependencies.source).unwrap();
    super::super::publication::publish(
        &db,
        &lease,
        &input,
        vec![segment(&input.dependencies.source)],
        vec![],
        &text,
        &output,
    )
    .await
    .unwrap();
    let initial = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    assert_eq!(initial.revision, 1);
    assert_eq!(initial.unreviewed_count, 1);
    let v = query::version(&db, "project", initial.version_id.as_deref().unwrap())
        .await
        .unwrap();
    let command = uuid::Uuid::new_v4().to_string();
    let edit = super::super::edits::Edit::Segment {
        id: v.segments[0].id.clone(),
        kind: SegmentKind::Thought,
        attribution: Attribution::Unknown,
        confirm: true,
    };
    let saved = super::super::edits::apply(
        &db,
        root.path(),
        "project",
        "chapter",
        &command,
        1,
        edit.clone(),
    )
    .await
    .unwrap();
    assert_eq!(saved.revision, 2);
    assert_eq!(
        super::super::edits::apply(&db, root.path(), "project", "chapter", &command, 1, edit)
            .await
            .unwrap()
            .revision,
        2
    );
    assert_eq!(
        query::snapshot(&db, root.path(), "project", "chapter")
            .await
            .unwrap()
            .unreviewed_count,
        0
    );
    let (lease, input, output) = start(&db, &session).await;
    super::super::publication::publish(
        &db,
        &lease,
        &input,
        vec![segment(&input.dependencies.source)],
        vec![],
        &text,
        &output,
    )
    .await
    .unwrap();
    let snapshot = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    assert_eq!(snapshot.revision, 2);
    assert_eq!(snapshot.candidate_ids.len(), 1);
    let candidate = super::super::candidates::read(&db, "project", &snapshot.candidate_ids[0])
        .await
        .unwrap();
    assert!(!candidate.stale);
    assert!(candidate.differences[0].conflict);
    assert!(
        super::super::candidates::process(
            &db,
            root.path(),
            "project",
            &candidate.id,
            &uuid::Uuid::new_v4().to_string(),
            2,
            super::super::candidates::Decision {
                selected: Some(vec![candidate.differences[0].id.clone()]),
                allow_conflicts: vec![]
            }
        )
        .await
        .is_err()
    );
    let applied = super::super::candidates::process(
        &db,
        root.path(),
        "project",
        &candidate.id,
        &uuid::Uuid::new_v4().to_string(),
        2,
        super::super::candidates::Decision {
            selected: Some(vec![candidate.differences[0].id.clone()]),
            allow_conflicts: vec![candidate.differences[0].id.clone()],
        },
    )
    .await
    .unwrap();
    assert_eq!(applied.revision, 3);
    super::super::edits::apply(
        &db,
        root.path(),
        "project",
        "chapter",
        &uuid::Uuid::new_v4().to_string(),
        3,
        super::super::edits::Edit::Undo,
    )
    .await
    .unwrap();
    let final_state = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    let final_version = query::version(&db, "project", final_state.version_id.as_deref().unwrap())
        .await
        .unwrap();
    assert_eq!(final_version.segments[0].kind, SegmentKind::Thought);
    assert_eq!(final_version.segments[0].review, ReviewStatus::Confirmed);
    assert_eq!(
        super::super::candidates::read(&db, "project", &candidate.id)
            .await
            .unwrap()
            .status,
        "withdrawn"
    );
    assert_eq!(
        query::read_text(root.path(), &input.dependencies.source).unwrap(),
        text
    );
    assert!(
        query::segments(
            &db,
            root.path(),
            "elsewhere",
            &final_version.id,
            ByteRange { start: 0, end: 1 },
            None
        )
        .await
        .is_err()
    );
    let path = root.path().join("app.sqlite3");
    db.close().await.unwrap();
    let reopened = crate::database::open(&path).await.unwrap();
    assert_eq!(
        query::snapshot(&reopened, root.path(), "project", "chapter")
            .await
            .unwrap()
            .revision,
        4
    );
}

#[tokio::test]
async fn failed_publication_has_no_draft_or_success_reference() {
    let (root, db, session) = fixture().await;
    let (lease, input, output) = start(&db, &session).await;
    let text = query::read_text(root.path(), &input.dependencies.source).unwrap();
    db.execute_raw(sea_orm::Statement::from_string(sea_orm::DbBackend::Sqlite,"CREATE TRIGGER reject_analysis BEFORE INSERT ON analysis_versions BEGIN SELECT RAISE(FAIL, 'injected'); END")).await.unwrap();
    assert!(
        super::super::publication::publish(
            &db,
            &lease,
            &input,
            vec![segment(&input.dependencies.source)],
            vec![],
            &text,
            &output
        )
        .await
        .is_err()
    );
    assert!(
        query::snapshot(&db, root.path(), "project", "chapter")
            .await
            .unwrap()
            .version_id
            .is_none()
    );
    let history = ai::history_page(&db, &session, None, 100).await.unwrap();
    assert!(!history.messages.iter().any(|m| {
        m.parts
            .parts()
            .iter()
            .any(|p| matches!(p, MessagePart::Result { .. }))
    }));
}

#[tokio::test]
async fn c7_preserves_analysis_when_review_fails_and_retry_does_not_replay_it() {
    use serde_json::json;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let count = Arc::new(AtomicUsize::new(0));
    let calls = count.clone();
    let server = crate::llm::test_support::Fixture::new(move |index, _, body| {
        calls.fetch_add(1, Ordering::SeqCst);
        if index == 1 {
            return (
                200,
                json!({"id":"fixture","object":"chat.completion","model":"test","choices":[{"index":0,"message":{"role":"assistant","content":"{"},"finish_reason":"length"}]}),
            );
        }
        let mut response = crate::chapter_analysis::fixture_response(body, index);
        let prompt: serde_json::Value = serde_json::from_str(
            body["messages"]
                .as_array()
                .unwrap()
                .iter()
                .rev()
                .find(|m| m["role"] == "user")
                .unwrap()["content"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        if prompt["evaluationTask"] == "review" {
            response["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]=json!(json!({"expectedRevision":prompt["revision"],"issues":[{"targetId":"r0","suggestion":{"kind":"speech","speaker":"unknown"}}]}).to_string());
        }
        (200, response)
    });
    let (_config, state, selection, _revision) =
        crate::llm::test_support::configured(&server.endpoint);
    let connection = state.acquire_for_run(&selection).unwrap();
    let model = crate::llm::configured_model(&connection, None).unwrap();
    let (root, db, session) = fixture().await;
    let (lease, input, _output) = start(&db, &session).await;
    let error = execute(
        &db,
        root.path(),
        &lease,
        model.clone(),
        None,
        Some(6),
        None,
        &CancellationToken::new(),
    )
    .await
    .unwrap_err();
    assert_eq!(error, RunFailure::InvalidResponse);
    assert!(
        query::snapshot(&db, root.path(), "project", "chapter")
            .await
            .unwrap()
            .version_id
            .is_none()
    );
    let progress = super::super::observation::progress(&db, lease.run_id())
        .await
        .unwrap();
    assert_eq!(progress.completed, 0);
    assert!(progress.total > 1);
    assert_eq!(progress.agent.as_ref().unwrap().stage, "review");
    let row = analysis_window::Entity::find()
        .all(&db)
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.ordinal == 0)
        .unwrap();
    let saved = row.content.checkpoint.as_ref().unwrap();
    assert!(saved.analysis.is_some());
    assert!(saved.review.is_none());
    assert!(
        saved
            .analysis
            .as_ref()
            .unwrap()
            .aliases
            .get("readOnlyBefore")
            .is_none()
    );
    assert!(
        saved
            .analysis
            .as_ref()
            .unwrap()
            .aliases
            .get("readOnlyAfter")
            .is_none()
    );
    assert!(progress.agent.as_ref().unwrap().elapsed_ms > 0.0);
    assert!(progress.agent.as_ref().unwrap().input_tokens.is_none());
    runs::finish(&db, &lease, ai::RunStatus::Failed, Some(error))
        .await
        .unwrap();
    let unrelated = Character {
        id: "unrelated-confirmed".into(),
        project_id: "project".into(),
        display_name: "另一个人物".into(),
        status: CharacterStatus::Confirmed,
        revision: 1,
        origin: input.dependencies.source.clone(),
        evidence: segment(&input.dependencies.source).evidence,
    };
    character::ActiveModel {
        id: Set(unrelated.id.clone()),
        project_id: Set(unrelated.project_id.clone()),
        display_name: Set(unrelated.display_name.clone()),
        status: Set("confirmed".into()),
        revision: Set(1),
        content: Set(serde_json::to_value(unrelated).unwrap()),
    }
    .insert(&db)
    .await
    .unwrap();
    let request = StartRun {
        workspace_context: None,
        session_id: session.clone(),
        request_id: uuid::Uuid::new_v4().to_string(),
        configuration: input.configuration,
        confirm_rebind: false,
        expected_project_revision: 1,
        trigger: Trigger::Retry {
            run_id: lease.run_id().into(),
        },
    };
    let next = ai::start_analysis_run(&db, request).await.unwrap();
    assert!(
        input::read(&db, &next.id)
            .await
            .unwrap()
            .characters
            .is_empty()
    );
    let next = runs::claim(&db, &next.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    execute(
        &db,
        root.path(),
        &next,
        model,
        None,
        Some(6),
        None,
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert!(
        query::snapshot(&db, root.path(), "project", "chapter")
            .await
            .unwrap()
            .version_id
            .is_some()
    );
    assert_eq!(
        count.load(Ordering::SeqCst),
        progress.total as usize * 2 + 1
    );
    assert_eq!(
        super::super::observation::progress(&db, next.run_id())
            .await
            .unwrap()
            .completed,
        progress.total
    );
    let final_progress = super::super::observation::progress(&db, next.run_id())
        .await
        .unwrap();
    let agent = final_progress.agent.unwrap();
    assert_eq!(agent.chapter_id, "chapter");
    assert_eq!(agent.review_findings.len(), progress.total as usize);
    assert_eq!(agent.review_findings[0].kind, Some(SegmentKind::Speech));
    let input_now = input::read(&db, next.run_id()).await.unwrap();
    assert_eq!(input_now.protocol, 2);
    assert_eq!(
        input_now.prompt_version.as_deref(),
        Some(super::super::agent_core::PROTOCOL_VERSION)
    );
    let diagnostic = super::super::observation::run(&db, next.run_id())
        .await
        .unwrap();
    assert_eq!(diagnostic["protocol"], "chapter-agent-c7/1");
    assert!(!diagnostic["traces"].as_array().unwrap().is_empty());
    assert!(diagnostic.get("analysis").is_none());
    let ai_review = super::super::observation::review(&db, next.run_id())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(ai_review["applied"], false);
    assert_eq!(
        ai_review["issues"].as_array().unwrap().len(),
        progress.total as usize
    );

    let current = store::state(&db, "project", "chapter")
        .await
        .unwrap()
        .unwrap();
    let version = query::version(&db, "project", &current.current_version_id)
        .await
        .unwrap();
    assert!(
        version
            .segments
            .iter()
            .all(|s| s.kind == SegmentKind::Narration)
    );
    let history = ai::history_page(&db, &session, None, 100).await.unwrap();
    assert!(
        history
            .messages
            .iter()
            .filter(|m| m.run_id.as_deref() == Some(next.run_id()))
            .any(|m| m.usage.as_ref().is_some_and(|u| u.input_tokens == Some(10)))
    );
}

#[tokio::test]
async fn normal_followup_discusses_instead_of_resuming_analysis() {
    let (root, db, session) = fixture().await;
    let (lease, input, output) = start(&db, &session).await;
    let text = query::read_text(root.path(), &input.dependencies.source).unwrap();
    super::super::publication::publish(
        &db,
        &lease,
        &input,
        vec![segment(&input.dependencies.source)],
        vec![],
        &text,
        &output,
    )
    .await
    .unwrap();
    let next = ai::start_run(
        &db,
        StartRun {
            workspace_context: None,
            session_id: session,
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: input.configuration,
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger: Trigger::Continue {
                run_id: lease.run_id().into(),
                message: "解释这个未知归属".into(),
            },
        },
    )
    .await
    .unwrap();
    let input = input::read(&db, &next.id).await.unwrap();
    assert_eq!(input.action, Action::Discuss);
    assert!(input.resume_input_id.is_none());
}

#[tokio::test]
async fn identities_are_explicit_shared_metadata_and_chapter_local_reuse() {
    use super::super::characters::{self, CharacterEdit};
    let (root, db, session) = fixture().await;
    let (lease, input, output) = start(&db, &session).await;
    let b = &input.dependencies.source;
    let text = query::read_text(root.path(), b).unwrap();
    let make = |id: &str| Character {
        id: id.into(),
        project_id: "project".into(),
        display_name: "同名人物".into(),
        status: CharacterStatus::Candidate,
        revision: 1,
        origin: b.clone(),
        evidence: vec![Evidence {
            range: ByteRange {
                start: b.start,
                end: b.end,
            },
            reason: "合成出处".into(),
        }],
    };
    let mut s = segment(b);
    s.attribution = Attribution::Resolved {
        character_id: "candidate-a".into(),
    };
    super::super::publication::publish(
        &db,
        &lease,
        &input,
        vec![s],
        vec![make("candidate-a"), make("candidate-b")],
        &text,
        &output,
    )
    .await
    .unwrap();
    characters::edit(
        &db,
        root.path(),
        "project",
        "candidate-b",
        &uuid::Uuid::new_v4().to_string(),
        1,
        CharacterEdit::Confirm,
    )
    .await
    .unwrap();
    assert_eq!(
        query::snapshot(&db, root.path(), "project", "chapter")
            .await
            .unwrap()
            .unreviewed_count,
        1
    );
    characters::edit(
        &db,
        root.path(),
        "project",
        "candidate-a",
        &uuid::Uuid::new_v4().to_string(),
        1,
        CharacterEdit::Reuse {
            chapter_id: "chapter".into(),
            existing_id: "candidate-b".into(),
            expected_analysis_revision: 1,
        },
    )
    .await
    .unwrap();
    let snapshot = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    let v = query::version(&db, "project", snapshot.version_id.as_deref().unwrap())
        .await
        .unwrap();
    assert_eq!(
        v.segments[0].attribution,
        Attribution::Resolved {
            character_id: "candidate-b".into()
        }
    );
    assert_eq!(v.segments[0].review, ReviewStatus::Unreviewed);
    assert!(
        characters::edit(
            &db,
            root.path(),
            "project",
            "candidate-b",
            &uuid::Uuid::new_v4().to_string(),
            2,
            CharacterEdit::Rename {
                name: "新名字".into(),
                expected_affected_chapters: vec![]
            }
        )
        .await
        .is_err()
    );
    characters::edit(
        &db,
        root.path(),
        "project",
        "candidate-b",
        &uuid::Uuid::new_v4().to_string(),
        2,
        CharacterEdit::Rename {
            name: "新名字".into(),
            expected_affected_chapters: vec!["chapter".into()],
        },
    )
    .await
    .unwrap();
    characters::edit(
        &db,
        root.path(),
        "project",
        "candidate-b",
        &uuid::Uuid::new_v4().to_string(),
        3,
        CharacterEdit::Alias {
            name: "别名".into(),
            evidence: Evidence {
                range: ByteRange {
                    start: b.start,
                    end: b.end,
                },
                reason: "人工确认别名关系".into(),
            },
            chapter_id: "chapter".into(),
            expected_affected_chapters: vec!["chapter".into()],
        },
    )
    .await
    .unwrap();
    let (_next, new_input, _output) = start(&db, &session).await;
    assert_eq!(new_input.characters.len(), 1);
    assert_eq!(new_input.characters[0].id, "candidate-b");
    assert_eq!(new_input.aliases[0].name, "别名");
    db.execute_raw(sea_orm::Statement::from_string(
        sea_orm::DbBackend::Sqlite,
        "UPDATE projects SET revision=revision+1 WHERE id='project'",
    ))
    .await
    .unwrap();
    store::check_dependencies(&db, &new_input.dependencies, true)
        .await
        .unwrap();
    characters::edit(
        &db,
        root.path(),
        "project",
        "candidate-b",
        &uuid::Uuid::new_v4().to_string(),
        4,
        CharacterEdit::Rename {
            name: "又一个名字".into(),
            expected_affected_chapters: vec!["chapter".into()],
        },
    )
    .await
    .unwrap();
    assert_eq!(
        store::check_dependencies(&db, &new_input.dependencies, true)
            .await
            .unwrap_err(),
        AnalysisError::Conflict
    );
}

#[tokio::test]
#[ignore = "opt-in real model; public synthetic text only; endpoint and model must be explicitly selected"]
async fn selected_real_model_public_chapter_acceptance() {
    let endpoint = std::env::var("CASTGLEAN_REAL_ANALYSIS_ENDPOINT").expect("explicit endpoint");
    let model_id = std::env::var("CASTGLEAN_REAL_ANALYSIS_MODEL").expect("explicit model");
    let (_config, state, selection, _revision) =
        crate::llm::test_support::configured_with_model(&endpoint, &model_id);
    let connection = state.acquire_for_run(&selection).unwrap();
    let model =
        crate::llm::configured_model(&connection, Some(std::sync::Arc::new(|_| Ok(())))).unwrap();
    let (root, db, mut project) = crate::project::test_support::fixture().await;
    let text = "第一章 灯下\n阿岚推开门：“小舟，雨停了。”\n小舟回答：“我听见了。”\n阿岚心想：也许我们能赶上末班车。\n窗外忽然传来一句：“等等我！”\n隔着门，两人无法辨认最后的声音。\n";
    let source = &mut project.document.project.sources[0];
    source.text = text.into();
    source.sha256 = crate::project::hash(text.as_bytes());
    source.raw_sha256 = source.sha256.clone();
    crate::project::publish_source(root.path(), source, text.as_bytes()).unwrap();
    project.document.project.chapters[0].end = text.len() as u32;
    crate::project::store::save(&db, root.path(), &project, None)
        .await
        .unwrap();
    let session = ai::create_session(
        &db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            chapter_id: Some("chapter".into()),
            task_kind: "chapter_analysis".into(),
            title: "公开合成短章".into(),
        },
    )
    .await
    .unwrap();
    let (lease, _input, _output) = start(&db, &session.id).await;
    let started = std::time::Instant::now();
    let outcome = crate::llm::test_support::PUBLIC_ACCEPTANCE
        .scope(
            true,
            execute(
                &db,
                root.path(),
                &lease,
                model,
                None,
                None,
                None,
                &CancellationToken::new(),
            ),
        )
        .await;
    eprintln!(
        "public chapter model={model_id}, elapsed_ms={}, outcome={outcome:?}",
        started.elapsed().as_millis()
    );
    outcome.unwrap();
    let snapshot = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    let version = query::version(&db, "project", snapshot.version_id.as_deref().unwrap())
        .await
        .unwrap();
    let characters = query::characters(&db, "project").await.unwrap();
    for s in &version.segments {
        let speaker = match &s.attribution {
            Attribution::Resolved { character_id } => characters
                .iter()
                .find(|c| c.id == *character_id)
                .map(|c| c.display_name.clone())
                .unwrap_or_default(),
            other => format!("{other:?}"),
        };
        eprintln!(
            "{:?} / {speaker}: {:?}",
            s.kind,
            &text[s.range.start as usize..s.range.end as usize]
        );
    }
    assert!(
        version
            .segments
            .iter()
            .all(|s| s.review == ReviewStatus::Unreviewed)
    );
    let history = ai::history_page(&db, &session.id, None, 100).await.unwrap();
    for m in history.messages {
        if let Some(usage) = m.usage {
            eprintln!("provider usage={usage:?}");
        }
    }
}

#[tokio::test]
async fn concurrent_first_results_keep_the_late_candidate_and_human_current() {
    let (root, db, session) = fixture().await;
    let (a, input_a, out_a) = start(&db, &session).await;
    let second = ai::create_session(
        &db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            chapter_id: Some("chapter".into()),
            task_kind: "chapter_analysis".into(),
            title: "第二会话".into(),
        },
    )
    .await
    .unwrap();
    let (b, input_b, out_b) = start(&db, &second.id).await;
    let text = query::read_text(root.path(), &input_a.dependencies.source).unwrap();
    super::super::publication::publish(
        &db,
        &a,
        &input_a,
        vec![segment(&input_a.dependencies.source)],
        vec![],
        &text,
        &out_a,
    )
    .await
    .unwrap();
    let initial = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    let version = query::version(&db, "project", initial.version_id.as_deref().unwrap())
        .await
        .unwrap();
    super::super::edits::apply(
        &db,
        root.path(),
        "project",
        "chapter",
        &uuid::Uuid::new_v4().to_string(),
        1,
        super::super::edits::Edit::Segment {
            id: version.segments[0].id.clone(),
            kind: SegmentKind::Thought,
            attribution: Attribution::Unknown,
            confirm: true,
        },
    )
    .await
    .unwrap();
    super::super::publication::publish(
        &db,
        &b,
        &input_b,
        vec![segment(&input_b.dependencies.source)],
        vec![],
        &text,
        &out_b,
    )
    .await
    .unwrap();
    let now = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    assert_eq!(now.revision, 2);
    assert_eq!(now.candidate_ids.len(), 1);
    assert_eq!(now.unreviewed_count, 0);
    let current = query::version(&db, "project", now.version_id.as_deref().unwrap())
        .await
        .unwrap();
    assert_eq!(current.segments[0].kind, SegmentKind::Thought);
    assert!(
        super::super::candidates::read(&db, "project", &now.candidate_ids[0])
            .await
            .unwrap()
            .stale
    );
}

#[tokio::test]
async fn cancellation_never_publishes_or_sends_another_window() {
    let server = crate::llm::test_support::Fixture::new(|_, _, _| {
        panic!("cancelled analysis must not call model")
    });
    let (_config, state, selection, _) = crate::llm::test_support::configured(&server.endpoint);
    let connection = state.acquire_for_run(&selection).unwrap();
    let model = crate::llm::configured_model(&connection, None).unwrap();
    let (root, db, session) = fixture().await;
    let (lease, input, output) = start(&db, &session).await;
    let token = CancellationToken::new();
    token.cancel();
    assert_eq!(
        execute(&db, root.path(), &lease, model, None, None, None, &token)
            .await
            .unwrap_err(),
        RunFailure::Cancelled
    );
    assert!(
        query::snapshot(&db, root.path(), "project", "chapter")
            .await
            .unwrap()
            .version_id
            .is_none()
    );
    // A model result racing with a persisted cancellation cannot publish either.
    runs::cancel(&db, lease.run_id()).await.unwrap();
    let text = query::read_text(root.path(), &input.dependencies.source).unwrap();
    assert_eq!(
        super::super::publication::publish(
            &db,
            &lease,
            &input,
            vec![segment(&input.dependencies.source)],
            vec![],
            &text,
            &output
        )
        .await
        .unwrap_err(),
        RunFailure::Cancelled
    );
    assert!(
        query::snapshot(&db, root.path(), "project", "chapter")
            .await
            .unwrap()
            .version_id
            .is_none()
    );
}

#[tokio::test]
async fn changed_chapter_range_reanalysis_requires_whole_candidate_adoption() {
    use crate::chapter_analysis::{candidates, edits};
    use sea_orm::IntoActiveModel;
    let (root, db, session) = fixture().await;
    let (lease, input, output) = start(&db, &session).await;
    let text = query::read_text(root.path(), &input.dependencies.source).unwrap();
    super::super::publication::publish(
        &db,
        &lease,
        &input,
        vec![segment(&input.dependencies.source)],
        vec![],
        &text,
        &output,
    )
    .await
    .unwrap();
    let old = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    let old_version = query::version(&db, "project", old.version_id.as_deref().unwrap())
        .await
        .unwrap();
    edits::apply(
        &db,
        root.path(),
        "project",
        "chapter",
        &uuid::Uuid::new_v4().to_string(),
        1,
        edits::Edit::Segment {
            id: old_version.segments[0].id.clone(),
            kind: SegmentKind::Thought,
            attribution: Attribution::Unknown,
            confirm: true,
        },
    )
    .await
    .unwrap();
    // A structural edit preserves the first chapter identity but shrinks its range.
    let row = crate::database::entity::chapter::Entity::find_by_id("chapter")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let mut update = row.into_active_model();
    update.end = Set(text.char_indices().nth(2).unwrap().0 as i32);
    update.update(&db).await.unwrap();
    let stale = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    assert!(stale.stale);
    let (lease, input, output) = start(&db, &session).await;
    super::super::publication::publish(
        &db,
        &lease,
        &input,
        vec![segment(&input.dependencies.source)],
        vec![],
        &text,
        &output,
    )
    .await
    .unwrap();
    let saved = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    assert_eq!(saved.version_id, stale.version_id);
    assert_eq!(saved.revision, 2);
    let candidate = candidates::read(&db, "project", &saved.candidate_ids[0])
        .await
        .unwrap();
    assert!(!candidate.stale);
    assert!(candidate.source_changed);
    assert_eq!(candidate.differences.len(), 1);
    assert!(candidate.differences[0].conflict);
    let group = candidate.differences[0].id.clone();
    let command = uuid::Uuid::new_v4().to_string();
    assert!(
        candidates::process(
            &db,
            root.path(),
            "project",
            &candidate.id,
            &command,
            2,
            candidates::Decision {
                selected: Some(vec![group.clone()]),
                allow_conflicts: vec![]
            }
        )
        .await
        .is_err()
    );
    candidates::process(
        &db,
        root.path(),
        "project",
        &candidate.id,
        &command,
        2,
        candidates::Decision {
            selected: Some(vec![group.clone()]),
            allow_conflicts: vec![group],
        },
    )
    .await
    .unwrap();
    let adopted = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    assert!(!adopted.stale);
    assert_eq!(adopted.revision, 3);
    assert!(!adopted.can_undo);
    assert_eq!(
        query::version(&db, "project", stale.version_id.as_deref().unwrap())
            .await
            .unwrap()
            .protections
            .len(),
        1
    );
    assert_eq!(
        query::read_text(root.path(), &input.dependencies.source).unwrap(),
        text
    );
}

#[tokio::test]
async fn damaged_source_is_rejected_before_waiting_for_the_writer_and_receipts_still_replay() {
    use crate::chapter_analysis::edits::{self, Edit};
    let (root, db, session) = fixture().await;
    let (lease, input, output) = start(&db, &session).await;
    let text = query::read_text(root.path(), &input.dependencies.source).unwrap();
    let segment = segment(&input.dependencies.source);
    super::super::publication::publish(
        &db,
        &lease,
        &input,
        vec![segment.clone()],
        vec![],
        &text,
        &output,
    )
    .await
    .unwrap();
    let command = uuid::Uuid::new_v4().to_string();
    let edit = Edit::Segment {
        id: segment.id,
        kind: SegmentKind::Thought,
        attribution: Attribution::Unknown,
        confirm: true,
    };
    let saved = edits::apply(
        &db,
        root.path(),
        "project",
        "chapter",
        &command,
        1,
        edit.clone(),
    )
    .await
    .unwrap();
    std::fs::write(
        root.path()
            .join(format!("{}.txt", input.dependencies.source.sha256)),
        "损坏来源",
    )
    .unwrap();
    // Already committed commands remain replayable even when the source later fails.
    assert_eq!(
        edits::apply(
            &db,
            root.path(),
            "project",
            "chapter",
            &command,
            1,
            edit.clone()
        )
        .await
        .unwrap(),
        saved
    );
    let tx = db.begin().await.unwrap();
    crate::project::store::lock(&tx, "project").await.unwrap();
    let new_command = uuid::Uuid::new_v4().to_string();
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        edits::apply(
            &db,
            root.path(),
            "project",
            "chapter",
            &new_command,
            2,
            edit,
        ),
    )
    .await;
    assert!(matches!(result, Ok(Err(AnalysisError::SourceChanged))));
    tx.rollback().await.unwrap();
}

#[tokio::test]
async fn retired_analysis_inputs_are_rejected_without_deleting_current_results() {
    use crate::database::entity::analysis_input;
    let (_root, db, session) = fixture().await;
    let (lease, input, _) = start(&db, &session).await;
    let current = serde_json::to_value(&input).unwrap();
    for (version, protocol) in [(1, 0), (2, 1), (99, 2)] {
        let mut retired = current.clone();
        retired["formatVersion"] = serde_json::json!(version);
        retired["protocol"] = serde_json::json!(protocol);
        let mut row: analysis_input::ActiveModel =
            analysis_input::Entity::find_by_id(lease.run_id())
                .one(&db)
                .await
                .unwrap()
                .unwrap()
                .into();
        row.content = Set(retired.clone());
        row.update(&db).await.unwrap();
        assert!(input::read(&db, lease.run_id()).await.is_err());
        assert!(
            super::super::observation::run(&db, lease.run_id())
                .await
                .is_err()
        );
        assert_eq!(
            analysis_input::Entity::find_by_id(lease.run_id())
                .one(&db)
                .await
                .unwrap()
                .unwrap()
                .content,
            retired
        );
    }
    let mut row: analysis_input::ActiveModel = analysis_input::Entity::find_by_id(lease.run_id())
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .into();
    row.content = Set(current);
    row.update(&db).await.unwrap();
    assert!(input::read(&db, lease.run_id()).await.is_ok());
}
