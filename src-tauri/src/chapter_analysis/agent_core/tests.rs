use super::*;

const SOURCE: &str = "风起。她说。";
fn draft() -> SharedDraft {
    Draft::analysis(
        SOURCE,
        vec![],
        json!({"confirmedAliases":[],"readOnlyBefore":"前文","readOnlyAfter":"后文"}),
    )
    .unwrap()
}
fn full() -> Value {
    json!({"operationId":"full","expectedRevision":0,"characters":[{"ref":"new:a","name":"她","evidence":["p1"]}],"runs":[{"end":0,"kind":"n","speaker":"narrator"},{"end":1,"kind":"s","speaker":"new:a"}]})
}
fn completed() -> ValidatedAnalysis {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    assert_eq!(d.call("finish_analysis", full())["ok"], true);
    d.result().unwrap()
}
fn character(id: &str, name: &str) -> CoreCharacter {
    CoreCharacter {
        id: id.into(),
        name: name.into(),
        description: Some("身份描述".into()),
        extra: BTreeMap::from([("relationships".into(), json!(["其他人"]))]),
    }
}
fn patch(id: &str, revision: u64, pieces: &[&str], finalize: bool) -> Value {
    json!({"operationId":id,"expectedRevision":revision,"finalize":finalize,"segments":[{"pieces":pieces,"kind":"narration","speaker":"narrator","evidence":pieces,"reason":"仅测试依据"}]})
}
#[test]
fn compact_atomic_partition_retains_evidence_and_refs() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    assert!(d.result().is_err());
    let out = d.call("finish_analysis", full());
    assert_eq!(out["completed"], true);
    assert!(d.finished());
    assert!(d.terminal());
    let result = d.result().unwrap();
    assert_eq!(result.new_characters.len(), 1);
    assert_eq!(result.segments[1].speaker, result.new_characters[0].id);
    assert_eq!(
        result.new_characters[0].evidence,
        vec![CoreRange { start: 9, end: 18 }]
    );
    assert_eq!(result.character_refs["new:a"], result.new_characters[0].id);
    assert_eq!(out["published"], false);
    assert_eq!(out["humanConfirmed"], false);
}
#[test]
fn failed_partitions_never_leak_characters_refs_labels_or_revision() {
    for mutation in [
        "gap",
        "duplicate",
        "bounds",
        "identity",
        "null",
        "future",
        "extra",
        "bad_evidence",
    ] {
        let shared = draft();
        let mut d = shared.lock().unwrap();
        let mut a = full();
        match mutation {
            "gap" => {
                a["runs"].as_array_mut().unwrap().pop();
            }
            "duplicate" => a["runs"][1]["end"] = json!(0),
            "bounds" => a["runs"][1]["end"] = json!(100),
            "identity" => a["runs"][1]["speaker"] = json!("她"),
            "null" => a["runs"][1]["candidates"] = Value::Null,
            "future" => a["expectedRevision"] = json!(1),
            "extra" => a["explanation"] = json!("private"),
            "bad_evidence" => a["characters"][0]["evidence"] = json!(["p99"]),
            _ => unreachable!(),
        }
        assert_eq!(d.call("finish_analysis", a)["ok"], false, "{mutation}");
        assert!(d.state.characters.is_empty());
        assert!(d.state.new_characters.is_empty());
        assert!(d.character_refs.is_empty());
        assert!(d.segments.is_empty());
        assert_eq!(d.revision, 0);
        assert!(d.result().is_err());
    }
}
#[test]
fn source_piece_ids_reconstruct_unicode_and_exact_whitespace() {
    for text in [
        "a",
        "𠮷说：“你好🙂。”\r\n\t e\u{301}。  ",
        "\n \t",
        "一二三\"test\"末",
    ] {
        let shared = Draft::analysis(text, vec![], Value::Null).unwrap();
        let d = shared.lock().unwrap();
        let mut reconstructed = String::new();
        let mut end = 0;
        for (i, piece) in d.pieces.iter().enumerate() {
            assert_eq!(piece.id, format!("p{i}"));
            assert_eq!(piece.start, end);
            assert_eq!(&text[piece.start..piece.end], piece.text);
            reconstructed.push_str(&piece.text);
            end = piece.end;
        }
        assert_eq!(reconstructed, text);
        assert_eq!(end, text.len());
    }
    assert!(Draft::analysis("", vec![], Value::Null).is_err());
}
#[test]
fn opening_quote_is_a_boundary_and_long_piece_split_is_scalar_safe() {
    let text = format!("{}“句。", "𠮷".repeat(121));
    let shared = Draft::analysis(&text, vec![], Value::Null).unwrap();
    let d = shared.lock().unwrap();
    assert_eq!(d.pieces[0].text.chars().count(), 120);
    let quote = text.find('“').unwrap();
    assert!(d.pieces.iter().any(|p| p.start == quote));
}
#[test]
fn names_do_not_merge_identity_and_short_refs_never_shadow_canonical_ids() {
    let roles = vec![character("c1", "同名"), character("c0", "同名")];
    let shared = Draft::analysis(SOURCE, roles, json!({"a":1})).unwrap();
    let d = shared.lock().unwrap();
    assert_eq!(d.resolve_identity("c1"), "c1");
    assert_eq!(d.resolve_identity("c0"), "c0");
    let input = d.input();
    assert_ne!(input["characters"][0]["id"], input["characters"][1]["id"]);
    assert_eq!(input["characters"][0]["description"], "身份描述");
    assert_eq!(input["characters"][0]["relationships"], json!(["其他人"]));
    assert_eq!(input["aliases"], json!({"a":1}));
}
#[test]
fn duplicate_reserved_or_blank_character_ids_fail_at_construction() {
    for roles in [
        vec![character("unknown", "甲")],
        vec![character("narrator", "甲")],
        vec![character(" ", "甲")],
        vec![character("a", "甲"), character("a", "乙")],
    ] {
        assert!(Draft::analysis(SOURCE, roles, Value::Null).is_err());
    }
}
#[test]
fn replay_is_idempotent_and_changed_operation_is_rejected() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    let a = full();
    let result = d.call("finish_analysis", a.clone());
    let snapshot = d.result().unwrap();
    assert_eq!(d.call("finish_analysis", a), result);
    assert_eq!(d.result().unwrap(), snapshot);
    let mut changed = full();
    changed["runs"][1]["kind"] = json!("t");
    assert_eq!(
        d.call("finish_analysis", changed)["error"],
        "operation_id_conflict"
    );
}
#[test]
fn new_candidate_ids_are_stable_across_drafts_without_name_based_merging() {
    let a = completed();
    let b = completed();
    assert_eq!(a.new_characters, b.new_characters);
    let shared = draft();
    let mut d = shared.lock().unwrap();
    let mut args = full();
    args["characters"]
        .as_array_mut()
        .unwrap()
        .push(json!({"ref":"new:b","name":"她","evidence":["p1"]}));
    assert_eq!(d.call("finish_analysis", args)["ok"], true);
    let result = d.result().unwrap();
    assert_eq!(result.new_characters.len(), 2);
    assert_ne!(result.new_characters[0].id, result.new_characters[1].id);
}
#[test]
fn candidates_only_on_unknown_with_distinct_registered_identities() {
    for (speaker, candidates, valid) in [
        ("c0", json!([]), false),
        ("narrator", json!(["c0", "c1"]), false),
        ("unknown", json!(["c0"]), false),
        ("unknown", json!(["c0", "c0"]), false),
        ("unknown", json!(["c0", "unregistered"]), false),
        ("unknown", json!(["c0", "c1"]), true),
    ] {
        let shared = Draft::analysis(
            SOURCE,
            vec![character("A", "甲"), character("B", "乙")],
            Value::Null,
        )
        .unwrap();
        let mut d = shared.lock().unwrap();
        let args = json!({"operationId":"unknown","expectedRevision":0,"runs":[{"end":1,"kind":"s","speaker":speaker,"candidates":candidates}]});
        assert_eq!(d.call("finish_analysis", args)["ok"], valid, "{speaker}");
        if !valid {
            assert_eq!(d.revision, 0);
            assert!(d.segments.is_empty());
        }
    }
}
#[test]
fn failed_patch_finalize_rolls_back_and_three_failures_terminate() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    for i in 0..3 {
        let value = d.call(
            "patch_annotations",
            patch(&format!("partial{i}"), 0, &["p0"], true),
        );
        assert_eq!(value["error"], "incomplete_draft");
        assert_eq!(d.revision, 0);
        assert!(d.segments.is_empty());
        assert_eq!(d.repair_rounds, i + 1);
    }
    assert!(d.terminal());
    assert!(!d.finished());
    assert_eq!(
        d.call("finish_analysis", full())["error"],
        "repair_budget_exhausted"
    );
}
#[test]
fn partial_patch_then_finalize_is_a_single_validated_boundary() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    assert_eq!(
        d.call("patch_annotations", patch("part", 0, &["p0"], false))["ok"],
        true
    );
    assert!(d.result().is_err());
    assert_eq!(
        d.call("patch_annotations", patch("rest", 1, &["p1"], true))["completed"],
        true
    );
    assert_eq!(d.result().unwrap().segments.len(), 2);
}
#[test]
fn duplicate_piece_patch_rejects_whole_batch_and_reports_conflict() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    let result = d.call("patch_annotations", patch("dup", 0, &["p0", "p0"], false));
    assert_eq!(result["error"], "overlapping_segments");
    assert_eq!(result["conflictCount"], 1);
    assert_eq!(d.revision, 0);
    assert!(d.segments.is_empty());
}
#[test]
fn stale_patch_only_accepts_untouched_pieces() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    assert_eq!(
        d.call("patch_annotations", patch("one", 0, &["p0"], false))["ok"],
        true
    );
    assert_eq!(
        d.call("patch_annotations", patch("same", 0, &["p0"], false))["error"],
        "revision_conflict"
    );
    assert_eq!(
        d.call("patch_annotations", patch("other", 0, &["p1"], false))["ok"],
        true
    );
}
#[test]
fn partial_overwrite_of_existing_segment_cannot_erase_middle() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    assert_eq!(
        d.call("patch_annotations", patch("all", 0, &["p0", "p1"], false))["ok"],
        true
    );
    assert_eq!(
        d.call("patch_annotations", patch("part", 1, &["p1"], false))["error"],
        "existing_segment_crosses_patch_boundary"
    );
    assert_eq!(d.segments.len(), 1);
    assert_eq!(d.segments[0].start, 0);
    assert_eq!(d.segments[0].end, SOURCE.len());
}
#[test]
fn analysis_tool_admission_is_32_without_a_model_request_limit() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    assert!(!prompt().contains("16次模型请求"));
    for _ in 0..32 {
        assert_eq!(
            d.call("read_source", json!({"from":"p0","to":"p1"}))["ok"],
            true
        );
    }
    assert!(d.terminal());
    assert!(!d.finished());
    assert_eq!(
        d.call("finish_analysis", full())["error"],
        "tool_budget_exhausted"
    );
}
#[test]
fn tools_and_context_match_compact_analysis_and_review_contract() {
    let shared = draft();
    let d = shared.lock().unwrap();
    assert_eq!(
        d.definitions()
            .iter()
            .map(|(n, _, _)| *n)
            .collect::<Vec<_>>(),
        vec!["read_source", "patch_annotations", "finish_analysis"]
    );
    drop(d);
    assert!(dynamic_tools(shared.clone()).is_ok());
}
#[test]
fn checkpoint_roundtrip_is_source_free_and_review_is_read_only() {
    let analysis = completed();
    let encoded = serde_json::to_string(&analysis).unwrap();
    assert!(!encoded.contains(SOURCE));
    let decoded: ValidatedAnalysis = serde_json::from_str(&encoded).unwrap();
    let restored = Draft::restore_analysis(SOURCE, decoded.clone()).unwrap();
    assert_eq!(restored.lock().unwrap().result().unwrap(), analysis);
    let shared = Draft::review(SOURCE, decoded).unwrap();
    let mut d = shared.lock().unwrap();
    assert_eq!(
        d.definitions()
            .iter()
            .map(|(n, _, _)| *n)
            .collect::<Vec<_>>(),
        vec!["finish_analysis"]
    );
    let input = d.input();
    assert!(input.get("pieces").is_none());
    let reconstructed: String = input["annotations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["text"].as_str().unwrap())
        .collect();
    assert_eq!(reconstructed, SOURCE);
    assert_eq!(
        d.call("patch_annotations", patch("no", 1, &["p0"], false))["error"],
        "tool_not_offered"
    );
    let before = d.segments();
    assert_eq!(d.call("finish_analysis",json!({"expectedRevision":analysis.revision,"issues":[{"targetId":"r1","suggestion":{"kind":"thought","speaker":"new:a"}}]}))["ok"],true);
    assert_eq!(d.segments(), before);
    assert!(d.result().is_err());
    let review = d.review_result().unwrap();
    assert_eq!(review.issues.len(), 1);
    assert_eq!(
        review.issues[0].suggestion.as_ref().unwrap().speaker,
        analysis.new_characters[0].id
    );
    assert_eq!(analysis, completed());
}
#[test]
fn checkpoint_rejects_changed_source_protocol_prompt_or_broken_identity() {
    let analysis = completed();
    assert!(Draft::review("别的正文", analysis.clone()).is_err());
    for mutation in [
        "protocol",
        "prompt",
        "utf8",
        "gap",
        "refs",
        "characters",
        "evidence",
        "revision",
    ] {
        let mut a = analysis.clone();
        match mutation {
            "protocol" => a.protocol_version = "old".into(),
            "prompt" => a.prompt_hash = "changed".into(),
            "utf8" => a.segments[0].end = 1,
            "gap" => a.segments[0].start = 3,
            "refs" => {
                a.character_refs.insert("new:a".into(), "missing".into());
            }
            "characters" => a.new_characters[0].name = "篡改".into(),
            "evidence" => a.new_characters[0].evidence[0].end = 10000,
            "revision" => a.revision = 0,
            _ => unreachable!(),
        }
        assert!(Draft::review(SOURCE, a).is_err(), "{mutation}");
    }
}
#[test]
fn invalid_review_never_commits_partial_suggestions() {
    for issue in [
        json!({"targetId":"r99","suggestion":{"kind":"speech","speaker":"new:a"}}),
        json!({"targetId":"r0","suggestion":{"kind":"speech","speaker":"名字"}}),
        json!({"targetId":"r0","suggestion":{"kind":"speech","speaker":"new:a","candidates":[]}}),
    ] {
        let analysis = completed();
        let shared = Draft::review(SOURCE, analysis.clone()).unwrap();
        let mut d = shared.lock().unwrap();
        assert_eq!(
            d.call(
                "finish_analysis",
                json!({"expectedRevision":analysis.revision,"issues":[issue]})
            )["ok"],
            false
        );
        assert!(d.review_result().is_none());
        assert!(!d.finished());
        assert_eq!(d.segments(), analysis.segments);
    }
}
#[test]
fn audit_contains_no_source_names_args_or_tool_results() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    d.call("finish_analysis", full());
    let audit = serde_json::to_string(d.audit()).unwrap();
    for private in [SOURCE, "她", "new:a", "characters", "runs", "arguments"] {
        assert!(!audit.contains(private), "{private}");
    }
    assert_eq!(d.audit().len(), 1);
    assert_eq!(d.audit()[0]["status"], "completed");
}

#[tokio::test]
async fn dynamic_tool_callback_mutates_shared_state_and_exposes_json_feedback() {
    let shared = draft();
    let tools = dynamic_tools(shared.clone()).unwrap();
    let finish = tools
        .iter()
        .find(|tool| tool.name().as_str() == "finish_analysis")
        .unwrap();
    let invalid = finish.run(json!({"expectedRevision":0})).await.unwrap();
    assert_eq!(invalid.as_json().unwrap()["ok"], false);
    assert!(!shared.lock().unwrap().finished());
    let output = finish.run(full()).await.unwrap();
    assert_eq!(output.as_json().unwrap()["completed"], true);
    assert!(shared.lock().unwrap().result().is_ok());
}
#[test]
fn finalized_patch_replay_is_idempotent_and_does_not_lose_prior_operations() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    let partial = patch("part", 0, &["p0"], false);
    assert_eq!(d.call("patch_annotations", partial.clone())["ok"], true);
    let final_args = patch("rest", 1, &["p1"], true);
    let out = d.call("patch_annotations", final_args.clone());
    assert_eq!(out["completed"], true);
    let result = d.result().unwrap();
    assert_eq!(d.call("patch_annotations", final_args), out);
    assert_eq!(d.result().unwrap(), result);
    assert!(d.operations.contains_key("part"));
}
#[test]
fn schemas_restrict_candidates_and_review_uses_the_input_refs() {
    let shared = Draft::analysis(
        SOURCE,
        vec![character("a", "甲"), character("b", "乙")],
        Value::Null,
    )
    .unwrap();
    let mut d = shared.lock().unwrap();
    let defs = d.definitions();
    let schema = &defs
        .iter()
        .find(|(name, _, _)| *name == "finish_analysis")
        .unwrap()
        .2;
    assert_eq!(schema["additionalProperties"], false);
    assert_eq!(
        schema["properties"]["runs"]["items"]["allOf"][0]["else"]["not"]["required"],
        json!(["candidates"])
    );
    assert_eq!(d.call("finish_analysis",json!({"operationId":"all","expectedRevision":0,"runs":[{"end":1,"kind":"s","speaker":"unknown","candidates":["c0","c1"]}]}))["ok"],true);
    let analysis = d.result().unwrap();
    drop(d);
    let review = Draft::review(SOURCE, analysis).unwrap();
    let review = review.lock().unwrap();
    assert_eq!(review.input()["discoveryAllowed"], false);
    let defs = review.definitions();
    let schema = &defs[0].2;
    assert_eq!(
        schema["properties"]["issues"]["items"]["properties"]["suggestion"]["properties"]["speaker"]
            ["enum"],
        json!(["c0", "c1", "unknown", "narrator"])
    );
    assert_eq!(
        review.input()["annotations"][0]["candidates"],
        json!(["c0", "c1"])
    );
}
#[test]
fn candidate_ids_use_stable_uuid_format_and_reject_forged_checkpoint_candidates() {
    let mut analysis = completed();
    uuid::Uuid::parse_str(
        analysis.new_characters[0]
            .id
            .strip_prefix("candidate:")
            .unwrap(),
    )
    .unwrap();
    analysis.new_characters[0].id = "candidate:00000000-0000-0000-0000-000000000000".into();
    assert!(Draft::review(SOURCE, analysis).is_err());
}
#[test]
fn unoffered_tool_names_are_redacted_in_audit() {
    let shared = draft();
    let mut d = shared.lock().unwrap();
    d.call("私密正文伪装为工具名", Value::Null);
    assert!(
        !serde_json::to_string(d.audit())
            .unwrap()
            .contains("私密正文")
    );
    assert_eq!(d.audit()[0]["tool"], "unknown_tool");
}

#[test]
fn lossless_aliases_bind_to_explicit_canonical_id_in_analysis_and_review() {
    let id = "f61f0994-5621-449b-b2ee-c1ce366e94dd";
    let aliases = json!({"confirmedAliases":[{"characterId":id,"text":"她","evidence":{"start":9,"end":12}}],"readOnlyBefore":"前文","readOnlyAfter":"后文"});
    let shared = Draft::analysis(SOURCE, vec![character(id, "同名")], aliases.clone()).unwrap();
    let mut d = shared.lock().unwrap();
    let context = d.input();
    assert_eq!(context["aliases"], aliases);
    assert_eq!(context["characters"][0]["id"], "c0");
    assert_eq!(
        context["characters"][0]["canonicalId"],
        context["aliases"]["confirmedAliases"][0]["characterId"]
    );
    assert_eq!(d.call("finish_analysis",json!({"operationId":"all","expectedRevision":0,"runs":[{"end":1,"kind":"s","speaker":"c0"}]}))["ok"],true);
    let checkpoint = d.result().unwrap();
    drop(d);
    let review = Draft::review(SOURCE, checkpoint).unwrap();
    let context = review.lock().unwrap().input();
    assert_eq!(context["aliases"], aliases);
    assert_eq!(
        context["characters"][0]["canonicalId"],
        context["aliases"]["confirmedAliases"][0]["characterId"]
    );
    assert_eq!(
        context["annotations"][0]["speaker"],
        context["characters"][0]["id"]
    );
}
#[test]
fn extra_context_cannot_spoof_host_canonical_id() {
    let mut role = character("actual", "甲");
    role.extra.insert("canonicalId".into(), json!("forged"));
    assert!(Draft::analysis(SOURCE, vec![role], Value::Null).is_err());
}
