use super::super::test_support::{fixture_saved, running, tool_context};
use super::*;
use crate::{
    ai::{self, *},
    database::entity::{ai_message, command_receipt},
    project::{self, test_support::fixture},
};
use sea_orm::sea_query::Expr;
use sea_orm::{DbBackend, Statement};

async fn sql(db: &DatabaseConnection, query: &str) {
    db.execute_raw(Statement::from_string(DbBackend::Sqlite, query))
        .await
        .unwrap();
}

async fn begin(db: &DatabaseConnection, lease: &Lease, proposed: &PreparedProposal) {
    let tx = db.begin().await.unwrap();
    assert!(
        ai::tools::begin(
            &tx,
            lease,
            "assistant",
            "call",
            proposed.tool_name,
            proposed.input.clone()
        )
        .await
        .unwrap()
    );
    ai::runs::commit(tx, lease).await.unwrap();
}
async fn pending(db: &DatabaseConnection, state: &LocalProject, lease: &Lease) -> String {
    let proposed = propose(
        state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &CancellationToken::new(),
    )
    .unwrap();
    begin(db, lease, &proposed).await;
    publish(db, lease, "assistant", "call", proposed)
        .await
        .unwrap()["proposal_id"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn corrupted_source_prevents_graph_from_requesting_the_model() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let requests = Arc::new(AtomicUsize::new(0));
    let observed = requests.clone();
    let fixture = crate::llm::test_support::Fixture::raw(move |_, _, _| {
        observed.fetch_add(1, Ordering::SeqCst);
        let chunk = json!({"id":"test","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"无需修改。"},"finish_reason":"stop"}]});
        (
            200,
            "text/event-stream",
            format!("data: {chunk}\n\ndata: [DONE]\n\n").into_bytes(),
        )
    });
    let (root, db, state, lease) = fixture_saved().await;
    let source = &state.document.project.sources[0];
    let path = root.path().join(format!("{}.txt", source.sha256));
    std::fs::write(&path, "损坏的正文").unwrap();
    let model = rig_core::providers::openai::OpenAIConfig::new("test")
        .with_base_url(format!("{}/v1", fixture.endpoint))
        .connect(crate::llm::TestHttp::new(&fixture.endpoint).unwrap())
        .chat("test")
        .erase();
    let result = super::super::graph::execute(tool_context(root.path(), &db, &lease), model).await;
    assert_eq!(result, Err(RunFailure::StorageFailed));
    assert_eq!(requests.load(Ordering::SeqCst), 0);
    let page = ai::history_page(&db, lease.session_id(), None, 20)
        .await
        .unwrap();
    assert_eq!(page.session.budget.requests, 0);
    assert_eq!(page.messages.len(), 1);
    assert_eq!(std::fs::read_to_string(path).unwrap(), "损坏的正文");
}

#[tokio::test]
async fn real_graph_loop_streams_tools_and_candidate_into_shared_history() {
    let fixture = crate::llm::test_support::Fixture::raw(|index, _, body| {
        let delta = if index == 0 {
            json!({"role":"assistant", "content":"检查标题", "tool_calls":[{"index":0,"id":"provider-1","type":"function","function":{"name":"test_rules","arguments":serde_json::to_string(&json!({"rules":crate::novel_import::heading_rules()})).unwrap()}}]})
        } else {
            assert_eq!(index, 1);
            assert!(
                body["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|m| m["role"] == "tool")
            );
            json!({"role":"assistant","content":"已生成方案，请审阅。"})
        };
        let first = json!({"id":"test","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":delta,"finish_reason":null}]});
        let end = json!({"id":"test","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":if index == 0 {"tool_calls"} else {"stop"}}]});
        (
            200,
            "text/event-stream",
            format!("data: {first}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes(),
        )
    });
    let (root, db, state, lease) = fixture_saved().await;
    let context = tool_context(root.path(), &db, &lease);
    let model = rig_core::providers::openai::OpenAIConfig::new("test")
        .with_base_url(format!("{}/v1", fixture.endpoint))
        .connect(crate::llm::TestHttp::new(&fixture.endpoint).unwrap())
        .chat("test")
        .erase();
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        super::super::graph::execute(context, model),
    )
    .await
    .unwrap()
    .unwrap();
    let page = ai::history_page(&db, lease.session_id(), None, 20)
        .await
        .unwrap();
    assert_eq!(page.session.budget.requests, 2);
    assert_eq!(page.session.budget.tool_calls, 1);
    assert_eq!(page.messages.len(), 2);
    assert!(page.messages.iter().all(|m| m.status == "complete"));
    let text: Vec<_> = page
        .messages
        .iter()
        .flat_map(|m| m.parts.parts())
        .filter_map(|p| match p {
            MessagePart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, ["检查分章", "检查标题", "已生成方案，请审阅。"]);
    let refs: Vec<_> = page
        .messages
        .iter()
        .flat_map(|m| m.parts.parts())
        .filter_map(|p| match p {
            MessagePart::Tool {
                result: Some(r), ..
            } => Some(r),
            _ => None,
        })
        .collect();
    assert_eq!(refs.len(), 1);
    assert_eq!(
        query(&db, &refs[0].id).await.unwrap().status,
        ProposalStatus::Pending
    );
    assert_eq!(
        projects::read(&db, root.path(), &state.document.project.id)
            .await
            .unwrap()
            .document
            .project
            .revision,
        state.document.project.revision
    );
    assert!(ai::model_input(&db, lease.session_id()).await.is_ok());
}

#[tokio::test]
async fn actual_sdk_tool_requires_dispatch_identity_and_publishes_shared_fact() {
    let (root, db, state, lease) = fixture_saved().await;
    let context = tool_context(root.path(), &db, &lease);
    let tools = context.definitions().unwrap();
    assert_eq!(tools.len(), 6);
    let args = json!({"rules":crate::novel_import::heading_rules()});
    // The SDK tool cannot be invoked directly with forged/absent hook state.
    assert!(tools[3].run(args.clone()).await.is_err());
    context
        .dispatch
        .begin("assistant", "provider-call", "test_rules", args.clone())
        .await
        .unwrap();
    assert!(
        context
            .dispatch
            .begin("other", "concurrent", "directory", json!({}))
            .await
            .is_err()
    );
    assert!(tools[3].run(json!({"rules":[]})).await.is_err());
    let output: Value =
        serde_json::from_str(&tools[3].run(args.clone()).await.unwrap().render()).unwrap();
    let id = output["proposal_id"].as_str().unwrap().to_owned();
    assert_eq!(
        query(&db, &id).await.unwrap().status,
        ProposalStatus::Pending
    );
    let budget = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap()
        .session
        .budget;
    assert_eq!(budget.tool_calls, 1);
    context
        .dispatch
        .complete("provider-call", "test_rules", &args, output, false)
        .await
        .unwrap();
    let page = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    assert_eq!(page.session.budget, budget);
    assert!(
        page.messages
            .iter()
            .flat_map(|m| m.parts.parts())
            .any(|p| matches!(p, MessagePart::Tool { result: Some(r), .. } if r.id == id))
    );
    assert!(
        context
            .dispatch
            .begin("assistant", "provider-call", "test_rules", args)
            .await
            .is_err()
    );
    assert_eq!(
        projects::read(&db, root.path(), &state.document.project.id)
            .await
            .unwrap()
            .document
            .project
            .revision,
        state.document.project.revision
    );
}

#[tokio::test]
async fn sdk_tools_reject_stale_or_cancelled_work_without_publishing() {
    let (root, db, state, lease) = fixture_saved().await;
    let context = tool_context(root.path(), &db, &lease);
    let tools = context.definitions().unwrap();
    let args = json!({"rules":crate::novel_import::heading_rules()});
    context
        .dispatch
        .begin("assistant", "provider-call", "test_rules", args.clone())
        .await
        .unwrap();
    let mut edited = projects::read(&db, root.path(), &state.document.project.id)
        .await
        .unwrap();
    edited.document.project.revision += 1;
    projects::save(
        &db,
        root.path(),
        &edited,
        Some(state.document.project.revision),
    )
    .await
    .unwrap();
    assert!(tools[3].run(args.clone()).await.is_err());
    context.token.cancel();
    assert!(tools[3].run(args).await.is_err());
    assert_eq!(split_proposal::Entity::find().count(&db).await.unwrap(), 0);
    assert_eq!(
        ai::history_page(&db, lease.session_id(), None, 10)
            .await
            .unwrap()
            .session
            .budget
            .tool_calls,
        1
    );
}

#[tokio::test]
async fn sdk_inspection_uses_published_source_and_never_adopts() {
    let (root, db, state, lease) = fixture_saved().await;
    let context = tool_context(root.path(), &db, &lease);
    let tools = context.definitions().unwrap();
    for (index, args) in [
        (0, json!({"page":0})),
        (1, json!({"source_id":"source","pattern":"章","page":0})),
        (2, json!({"source_id":"source","line":0,"count":3})),
    ] {
        context
            .dispatch
            .begin(
                "assistant",
                &format!("call-{index}"),
                ["directory", "search_headings", "read_context"][index],
                args.clone(),
            )
            .await
            .unwrap();
        let value: Value =
            serde_json::from_str(&tools[index].run(args.clone()).await.unwrap().render()).unwrap();
        assert!(serde_json::to_vec(&value).unwrap().len() <= 8192);
        context
            .dispatch
            .complete(
                &format!("call-{index}"),
                ["directory", "search_headings", "read_context"][index],
                &args,
                value,
                false,
            )
            .await
            .unwrap();
    }
    assert_eq!(
        projects::read(&db, root.path(), &state.document.project.id)
            .await
            .unwrap()
            .document
            .project
            .revision,
        state.document.project.revision
    );
    assert_eq!(split_proposal::Entity::find().count(&db).await.unwrap(), 0);
}

#[tokio::test]
async fn publication_commits_candidate_fact_and_budget_under_one_cursor() {
    let (_root, db, state, lease) = fixture_saved().await;
    let proposed = propose(
        &state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &CancellationToken::new(),
    )
    .unwrap();
    begin(&db, &lease, &proposed).await;
    let before = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    let id = publish(&db, &lease, "assistant", "call", proposed)
        .await
        .unwrap()["proposal_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let page = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    assert_eq!(page.session.sequence, before.session.sequence + 1);
    assert_eq!(page.session.budget.tool_calls, 1);
    assert!(page.session.budget.tool_bytes > 0);
    assert!(
        matches!(&page.messages[1].parts.parts()[0], MessagePart::Tool { state:ToolState::Completed, result:Some(reference), .. } if reference.id == id)
    );
    let proposal = query(&db, &id).await.unwrap();
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert!(!proposal.stale);
    assert_eq!(proposal.content.chapters.len(), 2);
    assert_eq!(
        project::store::read(&db, _root.path(), "project")
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
async fn duplicate_publication_replays_the_existing_result_without_charging_twice() {
    let (_root, db, state, lease) = fixture_saved().await;
    let id = pending(&db, &state, &lease).await;
    let before = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    let proposed = propose(
        &state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(
        publish(&db, &lease, "assistant", "call", proposed)
            .await
            .unwrap()["proposal_id"]
            .as_str()
            .unwrap()
            .to_owned(),
        id
    );
    assert_eq!(split_proposal::Entity::find().count(&db).await.unwrap(), 1);
    let after = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    assert_eq!(before.session.budget, after.session.budget);
    assert_eq!(before.session.sequence, after.session.sequence);
}

#[tokio::test]
async fn candidate_insert_failure_cannot_publish_a_successful_tool_reference() {
    let (_root, db, state, lease) = fixture_saved().await;
    let proposed = propose(
        &state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &CancellationToken::new(),
    )
    .unwrap();
    begin(&db, &lease, &proposed).await;
    let before = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    sql(&db, "CREATE TRIGGER reject_candidate BEFORE INSERT ON split_proposals BEGIN SELECT RAISE(ABORT, 'injected failure'); END").await;
    assert!(
        publish(&db, &lease, "assistant", "call", proposed)
            .await
            .is_err()
    );
    let page = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    assert_eq!(page.session.sequence, before.session.sequence);
    assert_eq!(page.session.budget.tool_calls, 1);
    assert_eq!(page.session.budget.tool_bytes, 0);
    assert!(matches!(
        &page.messages[1].parts.parts()[0],
        MessagePart::Tool {
            state: ToolState::Running,
            output: None,
            result: None,
            ..
        }
    ));
    assert_eq!(split_proposal::Entity::find().count(&db).await.unwrap(), 0);
}

#[tokio::test]
async fn tool_fact_write_failure_rolls_back_the_candidate_insert() {
    let (_root, db, state, lease) = fixture_saved().await;
    let proposed = propose(
        &state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &CancellationToken::new(),
    )
    .unwrap();
    begin(&db, &lease, &proposed).await;
    sql(&db, "CREATE TRIGGER reject_fact BEFORE UPDATE ON ai_messages BEGIN SELECT RAISE(ABORT, 'injected failure'); END").await;
    assert!(
        publish(&db, &lease, "assistant", "call", proposed)
            .await
            .is_err()
    );
    assert_eq!(split_proposal::Entity::find().count(&db).await.unwrap(), 0);
    assert_eq!(
        ai::history_page(&db, lease.session_id(), None, 10)
            .await
            .unwrap()
            .session
            .budget
            .tool_bytes,
        0
    );
}

#[tokio::test]
async fn adopted_result_and_undo_are_idempotent_without_reverting_history() {
    let (root, db, state, lease) = fixture_saved().await;
    let id = pending(&db, &state, &lease).await;
    let command = uuid::Uuid::new_v4().to_string();
    let committed = adopt(&db, root.path(), &id, &command).await.unwrap();
    assert_eq!(committed.revision, 2);
    assert_eq!(
        adopt(&db, root.path(), &id, &command).await.unwrap(),
        committed
    );
    assert_eq!(
        project::store::read(&db, root.path(), "project")
            .await
            .unwrap()
            .document
            .project
            .chapters
            .len(),
        2
    );
    let undo_command = uuid::Uuid::new_v4().to_string();
    let undone = project::edits::undo(&db, root.path(), "project", 2, &undo_command)
        .await
        .unwrap();
    assert_eq!(undone.revision, 3);
    assert_eq!(
        project::edits::undo(&db, root.path(), "project", 2, &undo_command)
            .await
            .unwrap(),
        undone
    );
    let restored = project::store::read(&db, root.path(), "project")
        .await
        .unwrap();
    assert_eq!(
        restored.document.project.chapters,
        state.document.project.chapters
    );
    assert!(restored.edit.undo.is_none());
    assert_eq!(
        query(&db, &id).await.unwrap().status,
        ProposalStatus::Adopted
    );
    let message = ai_message::Entity::find_by_id("assistant")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        matches!(&message.parts.parts()[0], MessagePart::Tool { state:ToolState::Completed, result:Some(reference), .. } if reference.id == id)
    );
}

#[tokio::test]
async fn receipt_failure_rolls_back_partition_candidate_and_revision() {
    let (root, db, state, lease) = fixture_saved().await;
    let id = pending(&db, &state, &lease).await;
    sql(&db, "CREATE TRIGGER reject_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'injected failure'); END").await;
    let command = uuid::Uuid::new_v4().to_string();
    assert!(adopt(&db, root.path(), &id, &command).await.is_err());
    let restored = project::store::read(&db, root.path(), "project")
        .await
        .unwrap();
    assert_eq!(restored.document.project.revision, 1);
    assert_eq!(
        restored.document.project.chapters,
        state.document.project.chapters
    );
    assert_eq!(
        query(&db, &id).await.unwrap().status,
        ProposalStatus::Pending
    );
    assert!(
        command_receipt::Entity::find_by_id(command)
            .one(&db)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn changed_project_marks_candidate_stale_and_never_overwrites_human_edit() {
    let (root, db, mut state, lease) = fixture_saved().await;
    let id = pending(&db, &state, &lease).await;
    state.document.project.title = "人工更正".into();
    state.document.project.revision = 2;
    projects::save(&db, root.path(), &state, Some(1))
        .await
        .unwrap();
    assert!(query(&db, &id).await.unwrap().stale);
    assert!(matches!(
        adopt(&db, root.path(), &id, &uuid::Uuid::new_v4().to_string()).await,
        Err(SplitError::Project(ProjectError::Conflict))
    ));
    let proposed = propose(
        &state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &CancellationToken::new(),
    )
    .unwrap();
    assert!(
        publish(&db, &lease, "assistant", "call", proposed)
            .await
            .is_err()
    );
    assert_eq!(
        projects::read(&db, root.path(), "project")
            .await
            .unwrap()
            .document
            .project
            .title,
        "人工更正"
    );
}

#[tokio::test]
async fn discard_replays_original_receipt_and_cannot_be_reused_for_adoption() {
    let (root, db, state, lease) = fixture_saved().await;
    let id = pending(&db, &state, &lease).await;
    let command = uuid::Uuid::new_v4().to_string();
    let saved = discard(&db, &id, &command).await.unwrap();
    assert_eq!(discard(&db, &id, &command).await.unwrap(), saved);
    assert_eq!(
        query(&db, &id).await.unwrap().status,
        ProposalStatus::Discarded
    );
    assert!(matches!(
        adopt(&db, root.path(), &id, &command).await,
        Err(SplitError::Project(ProjectError::Conflict))
    ));
    assert!(
        adopt(&db, root.path(), &id, &uuid::Uuid::new_v4().to_string())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn manual_corrections_are_preserved_and_tampered_candidates_are_rejected() {
    let (root, db, mut state) = fixture().await;
    let correction = Correction {
        source_id: "source".into(),
        line: 2,
        include: true,
        title: Some("人工章节名".into()),
        volume_id: None,
    };
    let mut issues = Vec::new();
    crate::novel_import::partition::patch_boundaries(
        &mut state.document,
        &mut issues,
        vec![correction.clone()],
        &CancellationToken::new(),
    )
    .unwrap();
    state.edit.issues = serde_json::to_value(issues).unwrap();
    projects::save(&db, root.path(), &state, None)
        .await
        .unwrap();
    assert!(matches!(
        propose(
            &state,
            ProposalAction::Boundaries(vec![correction]),
            &CancellationToken::new()
        ),
        Err(ProjectError::Conflict)
    ));
    let lease = running(&db, &state).await;
    let id = pending(&db, &state, &lease).await;
    let row = split_proposal::Entity::find_by_id(&id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let mut bad = row.content;
    bad["corrections"] = json!([]);
    split_proposal::Entity::update_many()
        .col_expr(split_proposal::Column::Content, Expr::value(bad))
        .filter(split_proposal::Column::Id.eq(&id))
        .exec(&db)
        .await
        .unwrap();
    assert!(matches!(
        adopt(&db, root.path(), &id, &uuid::Uuid::new_v4().to_string()).await,
        Err(SplitError::Project(ProjectError::Conflict))
    ));
}

#[tokio::test]
async fn a_natural_language_agreement_never_adopts_a_candidate() {
    let (root, db, state, lease) = fixture_saved().await;
    let id = pending(&db, &state, &lease).await;
    ai::runs::finish(&db, &lease, RunStatus::WaitingForInput, None)
        .await
        .unwrap();
    let run = ai::start_run(
        &db,
        StartRun {
            session_id: lease.session_id().into(),
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: Configuration {
                selection: crate::llm::ModelSelection {
                    connection_id: "connection".into(),
                    model_id: "model".into(),
                },
                revision: 1,
            },
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger: Trigger::Message {
                message: "同意".into(),
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(run.status, RunStatus::Queued);
    assert_eq!(
        query(&db, &id).await.unwrap().status,
        ProposalStatus::Pending
    );
    assert_eq!(
        projects::read(&db, root.path(), "project")
            .await
            .unwrap()
            .document
            .project
            .revision,
        1
    );
}

#[tokio::test]
async fn cancelled_execution_cannot_publish_a_late_proposal() {
    let (_root, db, state, lease) = fixture_saved().await;
    let proposed = propose(
        &state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &CancellationToken::new(),
    )
    .unwrap();
    begin(&db, &lease, &proposed).await;
    ai::runs::cancel(&db, lease.run_id()).await.unwrap();
    assert!(matches!(
        publish(&db, &lease, "assistant", "call", proposed).await,
        Err(SplitError::Ai(AiError::Conflict))
    ));
    assert_eq!(split_proposal::Entity::find().count(&db).await.unwrap(), 0);
}

#[tokio::test]
async fn undo_receipt_failure_preserves_the_adopted_partition_and_undo_state() {
    let (root, db, state, lease) = fixture_saved().await;
    let id = pending(&db, &state, &lease).await;
    adopt(&db, root.path(), &id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap();
    sql(&db, "CREATE TRIGGER reject_undo_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'injected failure'); END").await;
    let command = uuid::Uuid::new_v4().to_string();
    assert!(
        project::edits::undo(&db, root.path(), "project", 2, &command)
            .await
            .is_err()
    );
    let preserved = projects::read(&db, root.path(), "project").await.unwrap();
    assert_eq!(preserved.document.project.revision, 2);
    assert_eq!(preserved.document.project.chapters.len(), 2);
    assert!(preserved.edit.undo.is_some());
    sql(&db, "DROP TRIGGER reject_undo_receipt").await;
    assert_eq!(
        project::edits::undo(&db, root.path(), "project", 2, &command)
            .await
            .unwrap()
            .revision,
        3
    );
}

#[tokio::test]
async fn replay_reads_the_committed_receipt_before_revalidating_current_sources() {
    let (root, db, state, lease) = fixture_saved().await;
    let id = pending(&db, &state, &lease).await;
    let command = uuid::Uuid::new_v4().to_string();
    let committed = adopt(&db, root.path(), &id, &command).await.unwrap();
    std::fs::write(
        root.path()
            .join(format!("{}.txt", state.document.project.sources[0].sha256)),
        "damaged",
    )
    .unwrap();
    assert_eq!(
        adopt(&db, root.path(), &id, &command).await.unwrap(),
        committed
    );
    assert!(matches!(
        projects::read(&db, root.path(), "project").await,
        Err(ProjectError::ChecksumMismatch)
    ));
}

#[tokio::test]
async fn model_outcome_replay_preserves_the_committed_business_reference() {
    let (_root, db, state, lease) = fixture_saved().await;
    let proposed = propose(
        &state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &CancellationToken::new(),
    )
    .unwrap();
    begin(&db, &lease, &proposed).await;
    let published = publish(&db, &lease, "assistant", "call", proposed)
        .await
        .unwrap();
    let before = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    let tx = db.begin().await.unwrap();
    assert!(
        !ai::tools::complete(
            &tx,
            &lease,
            "assistant",
            "call",
            published.clone(),
            false,
            None
        )
        .await
        .unwrap()
    );
    tx.rollback().await.unwrap();
    let after = ai::history_page(&db, lease.session_id(), None, 10)
        .await
        .unwrap();
    assert_eq!(after.session.budget, before.session.budget);
    assert!(
        matches!(&after.messages[1].parts.parts()[0], MessagePart::Tool { result:Some(reference), .. } if reference.id == published["proposal_id"].as_str().unwrap())
    );
}

#[tokio::test]
async fn already_published_tool_result_can_replay_after_human_adoption() {
    let (root, db, state, lease) = fixture_saved().await;
    let id = pending(&db, &state, &lease).await;
    adopt(&db, root.path(), &id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap();
    let original = propose(
        &state,
        ProposalAction::Rules(crate::novel_import::heading_rules()),
        &CancellationToken::new(),
    )
    .unwrap();
    assert_eq!(
        publish(&db, &lease, "assistant", "call", original)
            .await
            .unwrap()["proposal_id"]
            .as_str()
            .unwrap()
            .to_owned(),
        id
    );
    assert_eq!(
        projects::read(&db, root.path(), "project")
            .await
            .unwrap()
            .document
            .project
            .revision,
        2
    );
}
