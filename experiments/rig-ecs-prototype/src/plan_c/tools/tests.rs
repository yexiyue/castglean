use super::*;
fn fixture(task: &str) -> Draft {
    let text = "甲说：“走吧。”\n灯灭了。";
    let case:Case=serde_json::from_value(json!({"version":1,"caseId":"controlled","evaluationTask":task,"source":{"text":text,"sha256":hash(text.as_bytes())},"characters":[{"id":"c-a","name":"甲"}]})).unwrap();
    Draft::new(case, false).unwrap()
}
fn patch(d: &Draft, from: usize, to: usize, operation: &str) -> Value {
    json!({"operationId":operation,"expectedRevision":d.revision,"from":d.pieces[from].id,"to":d.pieces[to].id,"segments":[{"from":d.pieces[from].id,"to":d.pieces[to].id,"kind":"narration","speaker":"narrator","evidence":[d.pieces[from].id],"reason":"受控原文依据"}]})
}
#[test]
fn source_ids_cover_every_utf8_byte_and_are_repeatable() {
    let d = fixture("analysis");
    assert_eq!(
        d.pieces.iter().map(|p| p.text.as_str()).collect::<String>(),
        d.case.source.text
    );
    let mut next = 0;
    for p in &d.pieces {
        assert_eq!(p.start, next);
        assert_eq!(
            d.case.source.text.get(p.start..p.end),
            Some(p.text.as_str())
        );
        next = p.end;
    }
    assert_eq!(next, d.case.source.text.len());
    assert_eq!(d.input(), fixture("analysis").input());
}
#[test]
fn feedback_identifies_missing_ids_then_local_patch_can_finish() {
    let mut d = fixture("analysis");
    let args = patch(&d, 0, 0, "first");
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    let feedback = d.call("finish_analysis", json!({"expectedRevision":1}));
    assert_eq!(feedback["ok"], false);
    assert!(!feedback["missingIds"].as_array().unwrap().is_empty());
    assert_eq!(d.segments.len(), 1);
    let args = patch(&d, 1, d.pieces.len() - 1, "repair");
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    assert_eq!(
        d.call("finish_analysis", json!({"expectedRevision":2}))["completed"],
        true
    );
    assert!(d.finished());
    assert_eq!(d.first_check_valid, Some(false));
}
#[test]
fn invalid_batch_does_not_mutate_prior_draft() {
    let mut d = fixture("analysis");
    let args = patch(&d, 0, 0, "first");
    d.call("patch_annotations", args);
    let before = serde_json::to_value(d.segments()).unwrap();
    let mut bad = patch(&d, 1, d.pieces.len() - 1, "bad");
    bad["segments"][0]["speaker"] = json!("not-an-id");
    bad["segments"][0]["kind"] = json!("speech");
    assert_eq!(d.call("patch_annotations", bad)["ok"], false);
    assert_eq!(d.revision, 1);
    assert_eq!(serde_json::to_value(d.segments()).unwrap(), before);
}
#[test]
fn same_operation_replays_but_changed_content_conflicts() {
    let mut d = fixture("analysis");
    let args = patch(&d, 0, 0, "same");
    let first = d.call("patch_annotations", args.clone());
    assert_eq!(d.call("patch_annotations", args.clone()), first);
    assert_eq!(d.revision, 1);
    let mut changed = args;
    changed["segments"][0]["reason"] = json!("不同依据");
    assert_eq!(
        d.call("patch_annotations", changed)["error"],
        "operation_id_conflict"
    );
}
#[test]
fn revision_conflict_and_budget_are_actionable_and_never_publish() {
    let mut d = fixture("analysis");
    let mut args = patch(&d, 0, 0, "bad-rev");
    args["expectedRevision"] = json!(4);
    assert_eq!(
        d.call("patch_annotations", args)["error"],
        "revision_conflict"
    );
    for _ in 0..4 {
        d.call("check_draft", json!({}));
    }
    assert_eq!(
        d.call("finish_analysis", json!({"expectedRevision":0}))["error"],
        "repair_budget_exhausted"
    );
    assert!(!d.finished());
    assert_eq!(d.revision, 0);
}
#[test]
fn completed_draft_rejects_mutation_and_logs_no_source_or_reasons() {
    let mut d = fixture("analysis");
    let args = patch(&d, 0, d.pieces.len() - 1, "all");
    d.call("patch_annotations", args);
    let result = d.call("finish_analysis", json!({"expectedRevision":1}));
    assert_eq!(result["humanConfirmed"], false);
    assert_eq!(result["published"], false);
    let args = patch(&d, 0, 0, "late");
    assert_eq!(
        d.call("patch_annotations", args)["error"],
        "draft_already_finished"
    );
    let text = serde_json::to_string(&d.logs).unwrap();
    assert!(!text.contains("走吧"));
    assert!(!text.contains("受控原文依据"));
}
#[test]
fn review_candidate_is_read_only_and_result_uses_exact_candidate_ranges() {
    let mut d = fixture("analysis");
    let args = patch(&d, 0, d.pieces.len() - 1, "all");
    d.call("patch_annotations", args);
    let original = d.segments();
    d.case.evaluation_task = "review".into();
    d.case.review_input = Some(crate::contract::Analysis {
        segments: original.clone(),
    });
    let args = patch(&d, 0, 0, "forbidden");
    assert_eq!(
        d.call("patch_annotations", args)["error"],
        "review_is_read_only"
    );
    assert_eq!(d.call("finish_analysis",json!({"expectedRevision":1,"issues":[{"targetId":"r0","suggestion":{"kind":"speech","speaker":"c-a"}}]}))["completed"],true);
    assert_eq!(d.review()["issues"][0]["end"], d.case.source.text.len());
    assert_eq!(d.segments(), original);
}
#[test]
fn known_identity_scope_does_not_invent_characters() {
    let mut d = fixture("analysis");
    assert_eq!(
        d.call(
            "propose_characters",
            json!({"expectedRevision":0,"name":"新人物","evidence":["p0"]})
        )["error"],
        "identity_scope_known_only"
    );
    assert_eq!(d.case.characters.len(), 1);
}

#[test]
fn same_name_character_descriptions_reach_initial_and_review_context_unchanged() {
    let text = "同名二人各自说话。";
    let value = json!({"version":1,"caseId":"role-context","evaluationTask":"analysis","source":{"text":text,"sha256":hash(text.as_bytes())},"characters":[{"id":"carpenter","name":"甲","description":"木制名牌，木匠"},{"id":"medic","name":"甲","description":"白瓷名牌，医师"}]});
    let case: Case = serde_json::from_value(value.clone()).unwrap();
    let draft = Draft::new(case, false).unwrap();
    assert_eq!(draft.input()["characters"], value["characters"]);
    let mut reviewer = draft.case.clone();
    reviewer.evaluation_task = "review".into();
    reviewer.review_input = Some(crate::contract::Analysis {
        segments: vec![Segment {
            start: 0,
            end: text.len(),
            kind: "narration".into(),
            speaker: "narrator".into(),
            evidence: vec![Range {
                start: 0,
                end: text.len(),
            }],
            candidates: vec![],
        }],
    });
    let review = Draft::new(reviewer, false).unwrap();
    assert_eq!(review.input()["characters"], value["characters"]);
}
