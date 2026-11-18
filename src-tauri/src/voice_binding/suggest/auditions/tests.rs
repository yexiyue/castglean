use super::*;
use crate::engine::ModelCapabilities;
use crate::voice_binding::suggest::draft::{Draft, tests as fixtures};
use serde_json::json;

#[test]
fn proposal_and_finish_describe_the_same_candidate_objects() {
    use super::super::draft::Finish;
    use rig_core::tool::args_schema;
    let proposal = args_schema::<Proposal>();
    let finish = args_schema::<Finish>();
    let target = &proposal["properties"]["targets"]["items"];
    assert_eq!(target, &finish["properties"]["targets"]["items"]);
    assert_eq!(proposal["properties"]["targets"]["maxItems"], MAX_ITEMS);
    let candidates = &target["properties"]["voiceCandidates"];
    assert_eq!(candidates["items"]["type"], "object");
    assert_eq!(candidates["items"]["required"], json!(["voice"]));
    let variants = &candidates["items"]["properties"]["voice"]["oneOf"];
    assert_eq!(variants[0]["properties"]["kind"]["const"], "library");
    assert_eq!(variants[1]["properties"]["kind"]["const"], "preset");
    for example in candidates["examples"][0].as_array().unwrap() {
        let args = json!({"targets": [{"target": "narrator", "voiceCandidates": [example]}]});
        assert!(serde_json::from_value::<Proposal>(args.clone()).is_ok());
        assert!(serde_json::from_value::<Finish>(args).is_ok());
    }
}

#[test]
fn malformed_and_unknown_voice_proposals_share_the_repair_budget() {
    use super::super::draft::MAX_REJECTIONS;
    use crate::ai::tool_input::Invocation;
    use rig_core::tool::args_schema;

    let input = fixtures::input();
    let mut draft = Draft::new(input.clone());
    let inventory = Inventory {
        character_digest: &input.character_digest,
        catalog: &input.catalog,
        models: &[],
        designers: &[],
    };
    let args: Invocation<Proposal> = serde_json::from_value(json!({
        "targets": [{"target": "character:hero", "voiceCandidates": ["private invalid voice name"]}]
    }))
    .unwrap();
    assert!(args.arguments.is_err());
    for attempt in 1..MAX_REJECTIONS {
        let result = draft.reject_arguments(
            "invalid_audition_plan",
            &args.raw,
            args_schema::<Proposal>(),
        );
        assert_eq!(result["path"], "targets[0].voiceCandidates[0]");
        assert!(result["candidateExamples"].is_array());
        assert!(!result.to_string().contains("private invalid"));
        assert_eq!(result["repairsRemaining"], MAX_REJECTIONS - attempt);
        assert!(!draft.terminal());
    }
    let proposal = serde_json::from_value(json!({
        "targets": [{"target": "character:hero", "voiceCandidates": [
            {"voice": {"kind": "library", "id": "unknown"}}
        ]}]
    }))
    .unwrap();
    let result = draft.plan_auditions(proposal, &inventory).unwrap_err();
    assert_eq!(result["rejected"][0]["target"], "character:hero");
    assert_eq!(result["rejected"][0]["reason"], "unknown_voice");
    assert_eq!(result["repairsRemaining"], 0);
    assert!(draft.terminal());
    assert!(draft.result().is_none());
}

#[tokio::test]
async fn shared_hook_records_three_bad_proposals_and_stops_the_model_loop() {
    use super::super::{CastingPolicy, draft};
    use crate::{
        ai::{
            self,
            agent::{Role, Subagent},
            dispatch::ToolDispatch,
            hook::Hook,
            messages::{MessagePart, ToolState},
            output::Output,
        },
        novel_import::splitting::test_support::fixture_saved,
    };
    use rig_agent::agent::AgentBuilder;
    use rig_core::test_utils::{MockCompletionModel, MockTurn};
    use tokio_util::sync::CancellationToken;

    let args = json!({"targets":[{"target":"narrator","voiceCandidates":["only a label"]}]});
    let model = MockCompletionModel::from_turns((0..3).map(|index| {
        MockTurn::tool_call(format!("call-{index}"), "propose_auditions", args.clone())
    }));
    let (_root, db, _, root_lease) = fixture_saved().await;
    let lease = ai::invocations::begin(&db, &root_lease, "casting")
        .await
        .unwrap();
    let output = Output::new(db.clone(), lease.clone());
    output.start(1).await.unwrap();
    let dispatch = ToolDispatch::new(db.clone(), lease.clone());
    let draft = draft::shared(fixtures::input());
    let token = CancellationToken::new();
    let hook = Hook::new(
        CastingPolicy {
            draft: draft.clone(),
        },
        Some((output, dispatch.clone())),
        token.clone(),
    );
    let builder = AgentBuilder::new(model.clone().erase())
        .add_hook(hook.clone())
        .tool(ApprovalTool {
            app: None,
            db: db.clone(),
            lease: lease.clone(),
            draft: draft.clone(),
            dispatch,
        });
    let _ = Subagent::new(builder, Role::Casting, None)
        .run("提交试听计划", &token)
        .await;
    assert_eq!(hook.failure(), None);
    assert!(draft.lock().unwrap().failed());
    assert_eq!(model.request_count(), 3);
    assert!(
        ai::interrupts::pending(&db, lease.session_id())
            .await
            .unwrap()
            .is_empty()
    );
    let history = ai::history_page(&db, lease.session_id(), None, 100)
        .await
        .unwrap();
    let receipts = history
        .messages
        .iter()
        .flat_map(|msg| msg.parts.parts())
        .filter_map(|part| match part {
            MessagePart::Tool {
                name,
                state: ToolState::Failed,
                output: Some(output),
                ..
            } if name == "propose_auditions" => Some(output),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(receipts.len(), 3);
    for (index, receipt) in receipts.into_iter().enumerate() {
        assert_eq!(receipt["path"], "targets[0].voiceCandidates[0]");
        assert_eq!(receipt["repairsRemaining"], 2 - index);
    }
}

#[tokio::test]
#[ignore = "requires CASTGLEAN_CASTING_ACCEPTANCE with an explicitly selected configured model"]
async fn configured_model_proposes_valid_auditions() {
    use super::super::draft::prompt;
    use rig_core::tool::args_schema;
    use rig_core::{
        completion::{CompletionRequest, ToolDefinition},
        message::ToolName,
    };
    let settings = std::env::var("CASTGLEAN_CASTING_ACCEPTANCE").unwrap();
    let (configured, identity, limit) =
        crate::llm::test_support::experiment_model(&serde_json::from_str(&settings).unwrap())
            .unwrap();
    let input = fixtures::input();
    let mut draft = Draft::new(input.clone());
    let name = ToolName::new("propose_auditions").unwrap();
    let request = CompletionRequest::new(format!(
        "请为角色小明从音色库选一个音色，并为旁白从预置音色选一个音色，提交试听审批。数据如下\n{}",
        draft.payload()
    ))
    .preamble(format!("{}\n先提交试听审批，等待用户决定。", prompt()))
    .max_tokens(u64::from(limit.unwrap_or(4096)))
    .tool(ToolDefinition::new(
        name.clone(),
        PROPOSAL_DESCRIPTION,
        args_schema::<Proposal>(),
    ));
    let response = crate::llm::complete(&configured, request).await.unwrap();
    let calls: Vec<_> = response.tool_calls().collect();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].function.name, name);
    let proposal: Proposal =
        serde_json::from_value(serde_json::to_value(&calls[0].function.arguments).unwrap())
            .unwrap();
    let preset_entry = &input.catalog.presets[0];
    let mut preset = model(&preset_entry.model, ResourceState::Ready);
    preset.backend.clone_from(&preset_entry.backend);
    preset.capabilities.reference_cloning = false;
    preset.capabilities.preset = true;
    let inventory = Inventory {
        character_digest: &input.character_digest,
        catalog: &input.catalog,
        models: &[model("clone-test", ResourceState::Ready), preset],
        designers: &[],
    };
    let plan = draft.plan_auditions(proposal, &inventory).unwrap();
    assert_eq!(plan.items.len(), 2);
    assert!(plan.items.iter().any(|item| matches!(
        item.source,
        Source::Directory {
            voice: VoiceRef::Library { .. },
            ..
        }
    )));
    assert!(plan.items.iter().any(|item| matches!(
        item.source,
        Source::Directory {
            voice: VoiceRef::Preset { .. },
            ..
        }
    )));
    println!(
        "{} produced one valid proposal with library and preset previews",
        identity["modelId"]
    );
}

fn model(name: &str, resource: ResourceState) -> ModelEntry {
    ModelEntry {
        backend: "cpu".into(),
        model: name.into(),
        name: name.into(),
        compiled_devices: vec![InferenceDevice::Cpu],
        available_devices: vec![InferenceDevice::Cpu],
        voice_catalog: vec![],
        capabilities: ModelCapabilities {
            preset: false,
            reference_cloning: true,
            style: false,
        },
        voices: 0,
        resource,
        unavailable_reason: None,
    }
}

#[test]
fn library_preview_freezes_ready_clone_model_and_evidence() {
    let input = fixtures::input();
    let mut draft = Draft::new(input.clone());
    let models = [
        model(
            "first",
            ResourceState::Missing {
                missing_bytes: 42.0,
            },
        ),
        model("ready", ResourceState::Ready),
    ];
    let mut inventory = Inventory {
        character_digest: &input.character_digest,
        catalog: &input.catalog,
        models: &models,
        designers: &[],
    };
    let proposal = |target: &str| Proposal {
        targets: fixtures::finish(target).targets,
        fallback_text: Default::default(),
    };
    assert_eq!(
        draft
            .plan_auditions(proposal("character:unknown"), &inventory)
            .unwrap_err()["error"],
        "unknown_target"
    );
    let plan = draft
        .plan_auditions(proposal("character:hero"), &inventory)
        .unwrap();
    let wire = interrupt("approval", "tool", &plan).unwrap();
    let wire = serde_json::to_value(&wire).unwrap();
    assert_eq!(wire["reason"], "casting_audition_approval");
    let plan: Plan =
        serde_json::from_value(wire["metadata"]["castingAuditionPlan"].clone()).unwrap();
    let item = &plan.items[0];
    assert_eq!(item.text, "「公开合成台词」");
    assert!(
        matches!(&item.source, Source::Directory { label, model, .. }
            if label == "低沉男声" && model == "ready")
    );
    let answer = |id: &str| {
        [Selection {
            id: id.into(),
            text: "已修改的试听文本".into(),
        }]
    };
    let receipt = plan
        .authorize(
            Decision::Approve {
                items: answer(&item.id).into(),
            },
            &inventory,
        )
        .unwrap();
    let Receipt::Approved { attempts } = receipt else {
        panic!("expected approval")
    };
    assert_eq!(attempts[0].item, item.id);
    assert!(
        matches!(&attempts[0].request, StudioRequest::Audition { model, text, .. }
            if model == "ready" && text == "已修改的试听文本")
    );
    assert!(matches!(
        plan.authorize(Decision::Reject { feedback: " 修改声音 ".into() }, &inventory).unwrap(),
        Receipt::Rejected { feedback } if feedback == "修改声音"
    ));
    assert_eq!(
        plan.approved_requests(&answer("unknown"), &inventory)
            .unwrap_err(),
        InvalidPlan::Item
    );

    let unavailable = [model(
        "ready",
        ResourceState::Missing {
            missing_bytes: 10.0,
        },
    )];
    inventory.models = &unavailable;
    assert_eq!(
        plan.approved_requests(&answer(&item.id), &inventory)
            .unwrap_err(),
        InvalidPlan::Resource
    );
    inventory.character_digest = "changed";
    assert_eq!(
        plan.approved_requests(&answer(&item.id), &inventory)
            .unwrap_err(),
        InvalidPlan::Stale
    );
}

#[test]
fn design_limits_apply_to_edited_text_and_description() {
    let input = fixtures::input();
    let inventory = Inventory {
        character_digest: &input.character_digest,
        catalog: &input.catalog,
        models: &[],
        designers: &[DesignEngineEntry {
            id: "designer".into(),
            name: "Designer".into(),
            devices: vec![InferenceDevice::Cpu],
            ready: true,
            resource: ResourceState::Ready,
            missing_bytes: 0.0,
            reuses_synthesis_model: false,
            text_max_chars: 3,
            description_max_chars: Some(10),
            description_max_bytes: 30,
            forbid_parentheses: true,
        }],
    };
    let mut draft = Draft::new(input.clone());
    let mut submission = fixtures::finish("character:hero");
    submission.targets[0].voice_candidates.clear();
    submission.targets[0].design = Some(super::super::draft::FinishDesign {
        engine: Some("designer".into()),
        prompt: "温和".into(),
    });
    let plan = draft
        .plan_auditions(
            Proposal {
                targets: submission.targets,
                fallback_text: Default::default(),
            },
            &inventory,
        )
        .unwrap();
    assert_eq!(plan.items[0].text.chars().count(), 3);
    let answer = [Selection {
        id: plan.items[0].id.clone(),
        text: "四字文本".into(),
    }];
    assert_eq!(
        plan.approved_requests(&answer, &inventory).unwrap_err(),
        InvalidPlan::Input
    );
}

#[tokio::test]
async fn approval_interrupt_is_atomic_with_the_tool_receipt() {
    use crate::{
        ai::{
            self,
            dispatch::ToolDispatch,
            messages::{MessagePart, ToolState},
            output::Output,
        },
        novel_import::splitting::test_support::fixture_saved,
    };
    use sea_orm::{ConnectionTrait, TransactionTrait};

    let (_root, db, _, root_lease) = fixture_saved().await;
    let lease = ai::invocations::begin(&db, &root_lease, "casting")
        .await
        .unwrap();
    let output = Output::new(db.clone(), lease.clone());
    output.start(1).await.unwrap();
    let dispatch = ToolDispatch::new(db.clone(), lease.clone());
    let args = json!({});
    dispatch
        .begin(
            &output.id().await.unwrap(),
            "call",
            "propose_auditions",
            args.clone(),
        )
        .await
        .unwrap();
    let call = dispatch.accepted("propose_auditions", &args).await.unwrap();
    let plan = Plan {
        character_digest: "characters".into(),
        catalog_digest: "catalog".into(),
        items: vec![],
    };

    // Fail after interrupt insertion, while writing the tool receipt.
    db.execute_unprepared("CREATE TRIGGER fail_receipt BEFORE UPDATE ON ai_messages BEGIN SELECT RAISE(ABORT, 'receipt fault'); END").await.unwrap();
    assert!(persist_proposal(&db, &lease, &call, &plan).await.is_err());
    assert!(
        ai::interrupts::pending(&db, lease.session_id())
            .await
            .unwrap()
            .is_empty()
    );
    db.execute_unprepared("DROP TRIGGER fail_receipt")
        .await
        .unwrap();

    let receipt = persist_proposal(&db, &lease, &call, &plan).await.unwrap();
    dispatch
        .complete("call", "propose_auditions", &args, receipt.clone(), false)
        .await
        .unwrap();
    let pending = ai::interrupts::pending(&db, lease.session_id())
        .await
        .unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(receipt["interruptId"], pending[0].id);
    assert_eq!(pending[0].request["toolCallId"], call.id);
    let tx = db.begin().await.unwrap();
    assert!(matches!(
        ai::tools::fact(&tx, &lease, &call.message_id, &call.id).await.unwrap(),
        Some(MessagePart::Tool { state: ToolState::Completed, output: Some(value), .. }) if value == receipt
    ));
    tx.rollback().await.unwrap();
}
