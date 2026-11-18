
use super::*;
use crate::engine::ModelCapabilities;
use crate::voice_binding::suggest::draft::{Draft, tests as fixtures};

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
    let draft = Draft::new(input.clone());
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
            .unwrap_err(),
        InvalidPlan::Item
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
    let draft = Draft::new(input.clone());
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
