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

fn sparse(d: &Draft, indices: &[usize], operation: &str, revision: u64) -> Value {
    let segments = indices
        .iter()
        .map(|&i| {
            json!({"pieces":[d.pieces[i].id],"kind":"narration",
            "speaker":"narrator","evidence":[d.pieces[i].id],"reason":"受控依据"})
        })
        .collect::<Vec<_>>();
    json!({"operationId":operation,"expectedRevision":revision,"segments":segments})
}
fn discovery() -> Draft {
    let mut d = fixture("analysis");
    d.allow_discovery = true;
    d
}
fn proposal(operation: &str, revision: u64, refs: &[&str]) -> Value {
    json!({"operationId":operation,"expectedRevision":revision,"characters":refs.iter()
        .map(|r|json!({"ref":r,"name":"同名","evidence":["p0"]})).collect::<Vec<_>>()})
}
fn state(d: &Draft) -> Value {
    json!({"revision":d.revision,"characters":d.case.characters,"refs":d.character_refs,
        "segments":d.segments,"pieceRevisions":d.piece_revisions,"operations":d.operations})
}
#[test]
fn batch_characters_are_distinct_canonical_identities_and_replay_is_idempotent() {
    let mut d = discovery();
    let args = proposal("batch", 0, &["new:a", "new:b"]);
    let result = d.call("propose_characters", args.clone());
    assert_eq!(result["ok"], true, "{result}");
    let a = result["characterRefs"]["new:a"].as_str().unwrap();
    let b = result["characterRefs"]["new:b"].as_str().unwrap();
    assert_ne!(a, b);
    for id in [a, b] {
        uuid::Uuid::parse_str(id.strip_prefix("candidate:").unwrap()).unwrap();
    }
    assert_eq!(d.case.characters.len(), 3);
    assert_eq!(d.case.characters[1].name, d.case.characters[2].name);
    let before = state(&d);
    assert_eq!(d.call("propose_characters", args), result);
    assert_eq!(state(&d), before);
    let changed = proposal("batch", 0, &["new:c"]);
    assert_eq!(
        d.call("propose_characters", changed)["error"],
        "operation_id_conflict"
    );
    assert_eq!(state(&d), before);
}
#[test]
fn proposal_validation_is_atomic_and_reused_refs_never_overwrite() {
    for variant in [
        "duplicate",
        "bad-ref",
        "empty-name",
        "empty-evidence",
        "unknown-piece",
        "future",
        "empty-batch",
    ] {
        let mut d = discovery();
        let mut args = proposal("bad", 0, &["new:a", "new:b"]);
        match variant {
            "duplicate" => args["characters"][1]["ref"] = json!("new:a"),
            "bad-ref" => args["characters"][1]["ref"] = json!("c-a"),
            "empty-name" => args["characters"][1]["name"] = json!(" "),
            "empty-evidence" => args["characters"][1]["evidence"] = json!([]),
            "unknown-piece" => args["characters"][1]["evidence"] = json!(["p999"]),
            "future" => args["expectedRevision"] = json!(1),
            _ => args["characters"] = json!([]),
        }
        let before = state(&d);
        assert_eq!(d.call("propose_characters", args)["ok"], false, "{variant}");
        assert_eq!(state(&d), before, "{variant}");
    }
    let mut d = discovery();
    assert_eq!(
        d.call("propose_characters", proposal("a", 0, &["new:a"]))["ok"],
        true
    );
    let before = state(&d);
    assert_eq!(
        d.call("propose_characters", proposal("b", 0, &["new:b", "new:a"]))["error"],
        "character_ref_conflict"
    );
    assert_eq!(state(&d), before);
    assert_eq!(
        d.call("propose_characters", proposal("c", 0, &["new:b"]))["ok"],
        true
    );
    assert_eq!(d.revision, 2);
}
#[test]
fn patch_resolves_registered_refs_for_speaker_and_candidates() {
    let mut d = discovery();
    let result = d.call(
        "propose_characters",
        proposal("batch", 0, &["new:a", "new:b"]),
    );
    let mut args = sparse(&d, &[0, 1], "refs", 0);
    args["segments"][0]["kind"] = json!("speech");
    args["segments"][0]["speaker"] = json!("new:a");
    args["segments"][1]["kind"] = json!("thought");
    args["segments"][1]["speaker"] = json!("unknown");
    args["segments"][1]["candidates"] = json!(["new:a", "new:b"]);
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    assert_eq!(d.segments[0].speaker, result["characterRefs"]["new:a"]);
    assert_eq!(
        d.segments[1].candidates,
        vec![
            d.character_refs["new:a"].clone(),
            d.character_refs["new:b"].clone()
        ]
    );
}
#[test]
fn sparse_unordered_batch_preserves_gaps_until_explicit_repair() {
    let mut d = fixture("analysis");
    let last = d.pieces.len() - 1;
    let args = sparse(&d, &[last, 0], "sparse", 0);
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    assert_eq!(d.segments.len(), 2);
    let feedback = d.call("finish_analysis", json!({"expectedRevision":1}));
    assert_eq!(feedback["error"], "incomplete_draft");
    assert!(
        feedback["missingIds"]
            .as_array()
            .unwrap()
            .contains(&json!("p1"))
    );
    assert!(!d.finished());
    let args = sparse(&d, &(1..last).collect::<Vec<_>>(), "fill", 1);
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    assert_eq!(
        d.call("finish_analysis", json!({"expectedRevision":1}))["error"],
        "revision_conflict"
    );
    assert_eq!(
        d.call("finish_analysis", json!({"expectedRevision":2}))["completed"],
        true
    );
}
#[test]
fn stale_patch_only_accepts_unchanged_targets_and_future_never_mutates() {
    let mut d = fixture("analysis");
    let args = sparse(&d, &[0], "first", 0);
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    let args = sparse(&d, &[1], "disjoint", 0);
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    for (operation, revision, indices) in [
        ("overlap", 0, vec![0]),
        ("mixed", 0, vec![2, 1]),
        ("future", 3, vec![2]),
    ] {
        let before = state(&d);
        let args = sparse(&d, &indices, operation, revision);
        assert_eq!(
            d.call("patch_annotations", args)["error"],
            "revision_conflict"
        );
        assert_eq!(state(&d), before);
    }
    // Even an identical rewrite counts as a modification of the target pieces.
    let args = sparse(&d, &[0], "rewrite", 2);
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    let args = sparse(&d, &[0], "stale-rewrite", 2);
    assert_eq!(
        d.call("patch_annotations", args)["error"],
        "revision_conflict"
    );
}
#[test]
fn sparse_cannot_erase_middle_of_existing_segment_but_full_split_is_allowed() {
    let mut d = fixture("analysis");
    let last = d.pieces.len() - 1;
    let args = patch(&d, 0, last, "all");
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    let before = state(&d);
    let args = sparse(&d, &[0, last], "edges", 1);
    assert_eq!(
        d.call("patch_annotations", args)["error"],
        "existing_segment_crosses_patch_boundary"
    );
    assert_eq!(state(&d), before);
    let args = sparse(&d, &(0..=last).rev().collect::<Vec<_>>(), "split", 1);
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    assert_eq!(d.segments.len(), last + 1);
}
#[test]
fn explicit_legacy_outer_bounds_still_require_ordered_complete_coverage() {
    for mode in ["gap", "reverse", "outside"] {
        let mut d = fixture("analysis");
        let last = d.pieces.len() - 1;
        let mut args = sparse(&d, &[0, last], "legacy", 0);
        for segment in args["segments"].as_array_mut().unwrap() {
            let id = segment.as_object_mut().unwrap().remove("pieces").unwrap()[0].clone();
            segment["from"] = id.clone();
            segment["to"] = id;
        }
        args["from"] = json!("p0");
        args["to"] = json!(d.pieces[last].id);
        if mode == "reverse" {
            args["segments"].as_array_mut().unwrap().reverse();
        }
        if mode == "outside" {
            args["to"] = json!("p0");
        }
        let before = state(&d);
        assert_eq!(d.call("patch_annotations", args)["ok"], false, "{mode}");
        assert_eq!(state(&d), before);
    }
}
#[test]
fn invalid_sparse_batches_are_atomic_with_local_actionable_feedback() {
    for mode in [
        "kind",
        "identity",
        "evidence",
        "singleton",
        "empty-candidates",
        "overlap",
        "reason",
        "ref",
    ] {
        let mut d = fixture("analysis");
        let mut args = sparse(&d, &[0, 1], "bad", 0);
        match mode {
            "kind" => args["segments"][1]["kind"] = json!("bad"),
            "identity" => args["segments"][1]["speaker"] = json!("c-a"),
            "evidence" => args["segments"][1]["evidence"] = json!([]),
            "singleton" | "empty-candidates" => {
                args["segments"][1]["kind"] = json!("speech");
                args["segments"][1]["speaker"] = json!("unknown");
                args["segments"][1]["candidates"] = if mode == "singleton" {
                    json!(["c-a"])
                } else {
                    json!([])
                };
            }
            "overlap" => args["segments"][1]["pieces"] = json!(["p0"]),
            "reason" => args["segments"][1]["reason"] = json!(" "),
            _ => {
                args["segments"][1]["kind"] = json!("speech");
                args["segments"][1]["speaker"] = json!("new:unregistered");
            }
        }
        let before = state(&d);
        let reply = d.call("patch_annotations", args);
        assert_eq!(reply["ok"], false, "{mode}");
        assert_eq!(reply["segmentIndex"], 1, "{mode}: {reply}");
        assert_eq!(reply["validPieceRange"]["count"], d.pieces.len());
        assert!(reply["hint"].as_str().is_some());
        if mode == "singleton" {
            assert!(reply["hint"].as_str().unwrap().contains("or omit"));
        }
        assert_eq!(state(&d), before, "{mode}");
    }
}
#[test]
fn unknown_piece_feedback_is_bounded_specific_and_not_in_trace() {
    let mut d = fixture("analysis");
    let mut args = sparse(&d, &[0], "unknown", 0);
    args["segments"][0]["evidence"] =
        json!((900..930).map(|i| format!("p{i}")).collect::<Vec<_>>());
    let reply = d.call("patch_annotations", args);
    assert_eq!(reply["error"], "unknown_piece");
    assert_eq!(reply["unknownIds"].as_array().unwrap().len(), 16);
    assert!(
        reply["unknownIds"]
            .as_array()
            .unwrap()
            .contains(&json!("p900"))
    );
    assert_eq!(reply["segmentIndex"], 0);
    assert_eq!(
        reply["validPieceRange"],
        json!({"from":"p0","to":d.pieces.last().unwrap().id,"count":d.pieces.len()})
    );
    assert!(!serde_json::to_string(&d.logs).unwrap().contains("p900"));
    assert_eq!(d.revision, 0);
}
#[test]
fn schema_advertises_only_new_batch_protocol_and_optional_candidates_minimum() {
    let defs = definitions();
    let schema = &defs.iter().find(|d| d.0 == "patch_annotations").unwrap().2;
    assert_eq!(
        schema["required"],
        json!(["operationId", "expectedRevision", "segments"])
    );
    assert!(schema["properties"].get("from").is_none());
    let segment = &schema["properties"]["segments"]["items"];
    assert_eq!(segment["properties"]["candidates"]["minItems"], 2);
    assert_eq!(segment["properties"]["pieces"]["uniqueItems"], true);
    assert_eq!(
        segment["required"],
        json!(["pieces", "kind", "speaker", "evidence", "reason"])
    );
    assert!(segment["properties"].get("from").is_none());
    assert!(segment["properties"].get("to").is_none());
    assert!(
        !segment["required"]
            .as_array()
            .unwrap()
            .contains(&json!("candidates"))
    );
    let schema = &defs.iter().find(|d| d.0 == "propose_characters").unwrap().2;
    assert_eq!(
        schema["required"],
        json!(["operationId", "expectedRevision", "characters"])
    );
    assert_eq!(discovery().input()["discoveryAllowed"], true);
    assert_eq!(fixture("analysis").input()["discoveryAllowed"], false);
}
#[test]
fn audit_appends_redacted_events_with_private_permissions_and_shared_review_path() {
    let path = std::env::temp_dir().join(format!("castglean-audit-{}.jsonl", uuid::Uuid::new_v4()));
    let mut d = discovery();
    d.set_audit_path(&path).unwrap();
    d.call("propose_characters", proposal("batch", 0, &["new:a"]));
    let mut reviewer = fixture("analysis");
    reviewer.set_audit_path(&path).unwrap();
    reviewer.call("check_draft", json!({}));
    let text = std::fs::read_to_string(&path).unwrap();
    assert_eq!(
        text.lines().collect::<Vec<_>>(),
        vec![
            serde_json::to_string(&d.logs[0]).unwrap(),
            serde_json::to_string(&reviewer.logs[0]).unwrap()
        ]
    );
    for line in text.lines() {
        assert!(serde_json::from_str::<Value>(line).unwrap().is_object());
    }
    for forbidden in [
        "同名",
        "甲",
        "走吧",
        "new:a",
        "operationId",
        "\"characters\"",
        "\"pieces\"",
    ] {
        assert!(!text.contains(forbidden), "{forbidden}");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    std::fs::remove_file(path).unwrap();
}
#[test]
fn audit_write_failure_is_recorded_without_changing_tool_result() {
    let mut d = fixture("analysis");
    let path =
        std::env::temp_dir().join(format!("castglean-audit-readonly-{}", uuid::Uuid::new_v4()));
    std::fs::write(&path, b"").unwrap();
    d.audit_file = Some(File::open(&path).unwrap());
    let args = sparse(&d, &[0], "valid", 0);
    let reply = d.call("patch_annotations", args);
    assert_eq!(reply["ok"], true);
    assert_eq!(d.revision, 1);
    assert_eq!(d.logs.last().unwrap()["auditWriteFailed"], true);
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn both_runtimes_execute_batch_refs_sparse_repair_and_separate_finish() {
    use rig_core::{
        catalog::ModelSpec,
        providers::registry::ProviderId,
        test_utils::{MockCompletionModel, MockStreamEvent, MockTurn},
    };
    for (route, duplicate) in [
        ("classic", false),
        ("ecs", false),
        ("classic", true),
        ("ecs", true),
    ] {
        let d = discovery();
        let last = d.pieces.len() - 1;
        let mut first = sparse(&d, &[last, 0], "initial", 0);
        first["segments"][0]["kind"] = json!("speech");
        first["segments"][0]["speaker"] = json!("new:a");
        let repair = sparse(&d, &(1..last).collect::<Vec<_>>(), "repair", 1);
        let mut calls = vec![
            (
                "discover",
                "propose_characters",
                proposal("batch", 0, &["new:a", "new:b"]),
            ),
            ("partial", "patch_annotations", first),
            ("check", "check_draft", json!({})),
            ("repair", "patch_annotations", repair),
            ("finish", "finish_analysis", json!({"expectedRevision":3})),
        ];
        if duplicate {
            calls.insert(
                0,
                (
                    "duplicate",
                    "patch_annotations",
                    piece_batch(&[&["p0", "p0"]]),
                ),
            );
        }
        let turns = calls.len();
        let model = if route == "classic" {
            MockCompletionModel::from_turns(
                calls
                    .into_iter()
                    .map(|(id, name, args)| MockTurn::tool_call(id, name, args)),
            )
        } else {
            MockCompletionModel::from_stream_turns(calls.into_iter().map(|(id, name, args)| {
                vec![
                    MockStreamEvent::tool_call(id, name, args),
                    MockStreamEvent::final_response(rig_core::completion::Usage::new()),
                ]
            }))
        };
        let spec = Arc::new(
            ModelSpec::new(ProviderId::declare("openai").unwrap(), "controlled").with_tools(true),
        );
        let input = d.input().to_string();
        let draft = Arc::new(Mutex::new(d));
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            if route == "classic" {
                crate::plan_c::classic::run(
                    model.clone().erase(),
                    spec,
                    draft.clone(),
                    PROMPT,
                    input,
                    turns,
                )
                .await
            } else {
                crate::plan_c::ecs::run(
                    model.clone().erase(),
                    spec,
                    draft.clone(),
                    PROMPT,
                    input,
                    turns,
                )
                .await
            }
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(model.request_count(), turns, "{route}");
        if duplicate {
            let feedback = serde_json::to_string(&model.requests()[1]).unwrap();
            assert!(
                feedback.contains("conflictCount") && feedback.contains("segmentIndices"),
                "{route}"
            );
            assert_eq!(
                draft.lock().unwrap().logs[0]["error"],
                "overlapping_segments"
            );
        }
        let feedback =
            serde_json::to_string(&model.requests()[3 + usize::from(duplicate)]).unwrap();
        assert!(
            feedback.contains("missingIds") && feedback.contains("p1"),
            "{route}"
        );
        let d = draft.lock().unwrap();
        assert!(d.finished(), "{route}");
        assert_eq!(d.revision, 3);
        assert_eq!(
            d.segments.last().unwrap().speaker,
            d.character_refs["new:a"]
        );
        assert_eq!(d.segments.len(), d.pieces.len());
    }
}

fn piece_batch(groups: &[&[&str]]) -> Value {
    json!({"operationId":"pieces","expectedRevision":0,"segments":groups.iter().map(|ids|
        json!({"pieces":ids,"kind":"narration","speaker":"narrator","evidence":["p0"],"reason":"受控依据"})
    ).collect::<Vec<_>>()})
}
#[test]
fn disconnected_explicit_ids_generate_only_exact_consecutive_coordinates() {
    let mut d = fixture("analysis");
    let args = piece_batch(&[&["p5", "p0", "p2", "p3"]]);
    let reply = d.call("patch_annotations", args.clone());
    assert_eq!(reply["ok"], true, "{reply}");
    let expected = [(0, 0), (2, 3), (5, 5)].map(|(a, b)| (d.pieces[a].start, d.pieces[b].end));
    assert_eq!(
        d.segments
            .iter()
            .map(|s| (s.start, s.end))
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(d.piece_revisions, vec![1, 0, 1, 1, 0, 1]);
    let before = state(&d);
    assert_eq!(d.call("patch_annotations", args), reply);
    assert_eq!(state(&d), before);
    let check = d.call("check_draft", json!({}));
    assert_eq!(check["missingIds"], json!(["p1", "p4"]));
    assert_eq!(
        check["missingRanges"],
        json!([{"from":"p1","to":"p1","count":1},{"from":"p4","to":"p4","count":1}])
    );
    assert_eq!(
        d.call("finish_analysis", json!({"expectedRevision":1}))["error"],
        "incomplete_draft"
    );
    assert_eq!(state(&d), before);
}
#[test]
fn repeated_piece_ids_within_or_between_identical_labels_reject_atomically() {
    for groups in [vec![vec!["p0", "p0"]], vec![vec!["p0"], vec!["p0"]]] {
        let mut d = fixture("analysis");
        let first = sparse(&d, &[5], "prior", 0);
        assert_eq!(d.call("patch_annotations", first)["ok"], true);
        let mut args = piece_batch(&groups.iter().map(Vec::as_slice).collect::<Vec<_>>());
        args["expectedRevision"] = json!(1);
        let before = state(&d);
        let reply = d.call("patch_annotations", args);
        assert_eq!(reply["error"], "overlapping_segments");
        assert_eq!(reply["conflictCount"], 1);
        assert_eq!(
            reply["conflicts"][0]["segmentIndices"],
            if groups.len() == 1 {
                json!([0, 0])
            } else {
                json!([0, 1])
            }
        );
        assert_eq!(reply["conflicts"][0]["pieceIds"], json!(["p0"]));
        assert_eq!(reply["conflicts"][0]["pieceCount"], 1);
        assert_eq!(state(&d), before);
        assert!(reply["hint"].as_str().unwrap().contains("only one label"));
    }
}
#[test]
fn complete_conflict_pairs_report_actual_ids_without_leaking_into_audit() {
    let path = std::env::temp_dir().join(format!(
        "castglean-conflicts-{}.jsonl",
        uuid::Uuid::new_v4()
    ));
    let mut d = fixture("analysis");
    d.set_audit_path(&path).unwrap();
    let mut args = piece_batch(&[&["p0", "p0", "p1"], &["p0", "p1", "p2"], &["p1", "p2"]]);
    args["segments"][0]["reason"] = json!("不应记录的私人说明");
    let before = state(&d);
    let reply = d.call("patch_annotations", args);
    assert_eq!(reply["conflictCount"], 4);
    assert_eq!(
        reply["conflicts"],
        json!([
            {"segmentIndices":[0,0],"pieceCount":1,"pieceIds":["p0"]},
            {"segmentIndices":[0,1],"pieceCount":2,"pieceIds":["p0","p1"]},
            {"segmentIndices":[0,2],"pieceCount":1,"pieceIds":["p1"]},
            {"segmentIndices":[1,2],"pieceCount":2,"pieceIds":["p1","p2"]}
        ])
    );
    assert_eq!(state(&d), before);
    assert_eq!(d.logs.last().unwrap()["conflictCount"], 4);
    assert_eq!(
        d.logs.last().unwrap()["conflicts"],
        json!([
            {"segmentIndices":[0,0],"pieceCount":1},{"segmentIndices":[0,1],"pieceCount":2},
            {"segmentIndices":[0,2],"pieceCount":1},{"segmentIndices":[1,2],"pieceCount":2}
        ])
    );
    let audit = std::fs::read_to_string(&path).unwrap();
    assert_eq!(
        audit.trim(),
        serde_json::to_string(d.logs.last().unwrap()).unwrap()
    );
    for forbidden in ["p0", "p1", "p2", "甲", "不应记录", "pieces", "reason"] {
        assert!(!audit.contains(forbidden), "{forbidden}");
    }
    std::fs::remove_file(path).unwrap();
}
#[test]
fn many_conflicts_are_bounded_but_total_pair_count_is_exact() {
    let mut d = fixture("analysis");
    let groups = vec![&["p0"][..]; 7];
    let reply = d.call("patch_annotations", piece_batch(&groups));
    assert_eq!(reply["conflictCount"], 21);
    assert_eq!(reply["conflicts"].as_array().unwrap().len(), 16);
    assert_eq!(reply["conflictsTruncated"], true);
    assert_eq!(d.logs.last().unwrap()["conflictCount"], 21);
    assert_eq!(d.revision, 0);
}
#[test]
fn mixed_or_empty_targets_and_unknown_explicit_ids_never_change_draft() {
    for mode in [
        "same-segment",
        "null-bounds",
        "different-segments",
        "outer",
        "empty",
        "unknown",
        "absent",
    ] {
        let mut d = fixture("analysis");
        let mut args = piece_batch(&[&["p0"], &["p1"]]);
        match mode {
            "null-bounds" => {
                args["segments"][0]["from"] = Value::Null;
            }
            "same-segment" => {
                args["segments"][0]["from"] = json!("p0");
                args["segments"][0]["to"] = json!("p0");
            }
            "different-segments" => {
                args["segments"][1]
                    .as_object_mut()
                    .unwrap()
                    .remove("pieces");
                args["segments"][1]["from"] = json!("p1");
                args["segments"][1]["to"] = json!("p1");
            }
            "outer" => {
                args["from"] = json!("p0");
                args["to"] = json!("p1");
            }
            "empty" => args["segments"][1]["pieces"] = json!([]),
            "unknown" => args["segments"][1]["pieces"] = json!(["p999"]),
            _ => {
                args["segments"][1]
                    .as_object_mut()
                    .unwrap()
                    .remove("pieces");
            }
        }
        let before = state(&d);
        let reply = d.call("patch_annotations", args);
        assert_eq!(reply["ok"], false, "{mode}");
        if mode == "unknown" {
            assert_eq!(reply["unknownIds"], json!(["p999"]));
            assert_eq!(reply["segmentIndex"], 1);
        }
        assert_eq!(state(&d), before, "{mode}");
    }
}
#[test]
fn legacy_ranges_still_expand_only_explicit_inclusive_bounds_and_reject_overlap() {
    let mut d = fixture("analysis");
    let args = patch(&d, 1, 3, "range");
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    assert_eq!(d.segments.len(), 1);
    assert_eq!(
        (d.segments[0].start, d.segments[0].end),
        (d.pieces[1].start, d.pieces[3].end)
    );
    let before = state(&d);
    let bad = json!({"operationId":"bad-ranges","expectedRevision":1,"segments":[
        {"from":"p0","to":"p2","kind":"narration","speaker":"narrator","evidence":["p0"],"reason":"依据"},
        {"from":"p2","to":"p4","kind":"narration","speaker":"narrator","evidence":["p0"],"reason":"依据"}
    ]});
    let reply = d.call("patch_annotations", bad);
    assert_eq!(reply["conflicts"][0]["pieceIds"], json!(["p2"]));
    assert_eq!(state(&d), before);
}
fn many_piece_draft(count: usize) -> Draft {
    let text = "𠮷风。".repeat(count);
    let case = serde_json::from_value(
        json!({"version":1,"caseId":"many-pieces","evaluationTask":"analysis",
        "source":{"text":text,"sha256":hash(text.as_bytes())},"characters":[]}),
    )
    .unwrap();
    Draft::new(case, false).unwrap()
}
#[test]
fn more_than_sixteen_gaps_are_all_locatable_in_one_check() {
    let mut d = many_piece_draft(80);
    let args = sparse(&d, &(0..80).step_by(2).collect::<Vec<_>>(), "even", 0);
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    let reply = d.call("check_draft", json!({}));
    assert_eq!(reply["missingCount"], 40);
    assert_eq!(reply["missingIdsTruncated"], false);
    assert_eq!(
        reply["missingIds"],
        json!(
            (1..80)
                .step_by(2)
                .map(|i| format!("p{i}"))
                .collect::<Vec<_>>()
        )
    );
    assert_eq!(
        reply["missingRanges"],
        json!(
            (1..80)
                .step_by(2)
                .map(|i| json!({"from":format!("p{i}"),"to":format!("p{i}"),"count":1}))
                .collect::<Vec<_>>()
        )
    );
    assert_eq!(d.repair_rounds, 1);
    let repair = sparse(&d, &(1..80).step_by(2).collect::<Vec<_>>(), "all-gaps", 1);
    assert_eq!(d.call("patch_annotations", repair)["ok"], true);
    assert_eq!(
        d.call("finish_analysis", json!({"expectedRevision":2}))["completed"],
        true
    );
    assert_eq!(d.repair_rounds, 1);
}
#[test]
fn missing_ids_cap_does_not_truncate_compressed_gap_coverage() {
    let mut d = many_piece_draft(1100);
    let args = sparse(&d, &[100, 200, 1000], "islands", 0);
    assert_eq!(d.call("patch_annotations", args)["ok"], true);
    let reply = d.call("finish_analysis", json!({"expectedRevision":1}));
    assert_eq!(reply["error"], "incomplete_draft");
    assert_eq!(reply["missingCount"], 1097);
    assert_eq!(reply["missingIds"].as_array().unwrap().len(), 512);
    assert_eq!(reply["missingIdsTruncated"], true);
    assert_eq!(
        reply["missingRanges"],
        json!([
            {"from":"p0","to":"p99","count":100},{"from":"p101","to":"p199","count":99},
            {"from":"p201","to":"p999","count":799},{"from":"p1001","to":"p1099","count":99}
        ])
    );
    assert_eq!(d.logs.last().unwrap()["missingCount"], 1097);
    assert!(
        !d.logs
            .last()
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("missingRanges")
    );
    assert!(!d.finished());
    assert_eq!(d.repair_rounds, 1);
}

#[test]
fn conflict_groups_preserve_all_actual_overlapping_ids() {
    let mut d = many_piece_draft(40);
    let ids = (0..40).map(|i| format!("p{i}")).collect::<Vec<_>>();
    let group = ids.iter().map(String::as_str).collect::<Vec<_>>();
    let reply = d.call("patch_annotations", piece_batch(&[&group, &group]));
    assert_eq!(reply["conflictCount"], 1);
    assert_eq!(reply["conflicts"][0]["pieceCount"], 40);
    assert_eq!(
        reply["conflicts"][0]["pieceIds"],
        json!((0..40).map(|i| format!("p{i}")).collect::<Vec<_>>())
    );
    assert_eq!(d.revision, 0);
}
