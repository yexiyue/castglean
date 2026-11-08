use super::*;
use serde_json::json;

fn fixture() -> (SourceBinding, Vec<Piece>, Vec<Character>) {
    let text = "前章\n甲：你好🙂。\r\n乙：再见！";
    let b = SourceBinding {
        project_id: "p".into(),
        chapter_id: "chapter".into(),
        source_id: "source".into(),
        sha256: crate::project::hash(text.as_bytes()),
        start: "前章\n".len() as u32,
        end: text.len() as u32,
    };
    let pieces = super::super::precut::partition(text, &b).unwrap();
    let known = vec![Character {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: b.project_id.clone(),
        display_name: "甲".into(),
        status: CharacterStatus::Confirmed,
        revision: 2,
        origin: b.clone(),
        evidence: vec![Evidence {
            range: pieces[0].range.clone(),
            reason: "人工确认身份".into(),
        }],
    }];
    (b, pieces, known)
}
fn role_output() -> Value {
    json!({"characters":[{"key":"new:0","name":"乙","evidence":["s2"],"reason":"乙的姓名出现在发言提示中"}]})
}
fn segment(from: &str, to: &str, kind: &str, who: Value) -> Value {
    json!({"from":from,"to":to,"kind":kind,"who":who,"evidence":["s0"],"reason":"发言提示说明此处人物归属"})
}
fn review_output() -> Value {
    json!({"issues":[{"targetIds":["s1"],"category":"attribution","reason":"前面的姓名提示指向甲","suggestedKind":"speech","suggestedWho":["c0"],"certainty":"clear"}],"summary":"发现一处可定位的归属问题"})
}

#[test]
fn schemas_and_protocol_versions_are_available() {
    for schema in [role_schema(), analysis_schema(), review_schema()] {
        assert!(serde_json::to_value(schema).unwrap().is_object());
    }
    assert!(!PROMPT_VERSION.is_empty());
    assert_eq!(PROTOCOL_VERSION, 1);
    assert!(ANALYSIS_PROMPT.contains("嵌套称号"));
    assert!(IDENTITY_PROMPT.contains("真实简短理由"));
    assert!(REVIEW_PROMPT.contains("不确认人工状态"));
}

#[test]
fn new_identities_have_host_ids_and_preserve_same_name_candidates() {
    let (b, p, known) = fixture();
    let value = json!({"characters":[
        {"key":"new:0","name":"甲","evidence":["s0"],"reason":"此人同名，身份尚待确认"},
        {"key":"new:1","name":"甲","evidence":["s2"],"reason":"另一处人物出现，不能仅凭同名合并"}
    ]});
    let local = decode_roles(value, &p, &b, &known).unwrap();
    assert_ne!(local["new:0"].id, known[0].id);
    assert_ne!(local["new:0"].id, local["new:1"].id);
    assert_eq!(local["new:0"].status, CharacterStatus::Candidate);
    assert_eq!(local["new:1"].evidence[0].range, p[2].range);
    assert!(uuid::Uuid::parse_str(&local["new:0"].id).is_ok());
}

#[test]
fn role_redeclaration_fake_evidence_and_empty_reasons_are_rejected() {
    let (b, p, known) = fixture();
    for key in ["c0", known[0].id.as_str(), "new:", "new:00", "new:x"] {
        let mut value = role_output();
        value["characters"][0]["key"] = json!(key);
        assert!(decode_roles(value, &p, &b, &known).is_err(), "{key}");
    }
    for field in ["reason", "name"] {
        let mut value = role_output();
        value["characters"][0][field] = json!(" \n");
        assert!(decode_roles(value, &p, &b, &known).is_err());
    }
    let mut value = role_output();
    value["characters"][0]["evidence"] = json!(["s9999"]);
    assert!(decode_roles(value, &p, &b, &known).is_err());
    let mut value = role_output();
    let duplicate = value["characters"][0].clone();
    value["characters"].as_array_mut().unwrap().push(duplicate);
    assert!(decode_roles(value, &p, &b, &known).is_err());
}

#[test]
fn owned_range_expands_exact_bytes_and_evidence_can_use_other_owned_groups() {
    let (b, p, known) = fixture();
    let local = decode_roles(role_output(), &p, &b, &known).unwrap();
    let mut s = segment("s2", &p.last().unwrap().id, "speech", json!(["new:0"]));
    s["evidence"] = json!(["s0", "s2"]);
    let result =
        decode_analysis(json!({"segments":[s]}), &p, 2..p.len(), &b, &known, &local).unwrap();
    assert_eq!(
        result[0].range,
        ByteRange {
            start: p[2].range.start,
            end: b.end
        }
    );
    assert_eq!(
        result[0].attribution,
        Attribution::Resolved {
            character_id: local["new:0"].id.clone()
        }
    );
    assert_eq!(result[0].evidence[0].range, p[0].range);
    assert_eq!(result[0].review, ReviewStatus::Unreviewed);
    assert_eq!(result[0].reason, "发言提示说明此处人物归属");
}

#[test]
fn known_keys_map_by_frozen_order_and_distinct_candidates_remain_ambiguous() {
    let (b, p, known) = fixture();
    let local = decode_roles(role_output(), &p, &b, &known).unwrap();
    let result = decode_analysis(json!({"segments":[segment("s0", &p.last().unwrap().id, "thought", json!(["c0", "new:0"]))]}), &p, 0..p.len(), &b, &known, &local).unwrap();
    assert_eq!(
        result[0].attribution,
        Attribution::Ambiguous {
            character_ids: vec![known[0].id.clone(), local["new:0"].id.clone()]
        }
    );
}

#[test]
fn missing_reversed_repeated_and_outside_owned_intervals_are_rejected() {
    let (b, p, known) = fixture();
    let last = &p.last().unwrap().id;
    let local = BTreeMap::new();
    for segments in [
        vec![],
        vec![segment("s1", last, "narration", json!(["narrator"]))],
        vec![segment("s0", "s0", "narration", json!(["narrator"]))],
        vec![
            segment("s0", last, "narration", json!(["narrator"])),
            segment("s0", last, "narration", json!(["narrator"])),
        ],
        vec![segment("s0", "s999", "narration", json!(["narrator"]))],
        vec![
            segment("s0", "s0", "narration", json!(["narrator"])),
            segment("s2", "s1", "narration", json!(["narrator"])),
        ],
    ] {
        assert!(
            decode_analysis(
                json!({"segments":segments}),
                &p,
                0..p.len(),
                &b,
                &known,
                &local
            )
            .is_err()
        );
    }
    assert!(
        decode_analysis(
            json!({"segments":[segment("s0", last, "narration", json!(["narrator"]))]}),
            &p,
            1..p.len(),
            &b,
            &known,
            &local
        )
        .is_err()
    );
}

#[test]
fn illegal_identity_duplicates_and_narrator_voice_conflicts_are_rejected() {
    let (b, p, known) = fixture();
    for (kind, who) in [
        ("speech", json!(["narrator"])),
        ("thought", json!(["narrator"])),
        ("narration", json!(["unknown"])),
        ("narration", json!(["c0"])),
        ("speech", json!([])),
        ("speech", json!(["c0", "c0"])),
        ("speech", json!(["c0", "unknown"])),
        ("speech", json!(["new:9"])),
        ("speech", json!([known[0].id])),
        ("speech", json!(["甲"])),
    ] {
        assert!(
            decode_analysis(
                json!({"segments":[segment("s0", &p.last().unwrap().id, kind, who)]}),
                &p,
                0..p.len(),
                &b,
                &known,
                &BTreeMap::new()
            )
            .is_err()
        );
    }
}

#[test]
fn one_character_means_resolved_and_unknown_never_becomes_narrator() {
    let (b, p, known) = fixture();
    for (who, expected) in [
        (
            json!(["c0"]),
            Attribution::Resolved {
                character_id: known[0].id.clone(),
            },
        ),
        (json!(["unknown"]), Attribution::Unknown),
    ] {
        let result = decode_analysis(
            json!({"segments":[segment("s0", &p.last().unwrap().id, "speech", who)]}),
            &p,
            0..p.len(),
            &b,
            &known,
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(result[0].attribution, expected);
        assert_eq!(result[0].review, ReviewStatus::Unreviewed);
    }
    // An explicit ambiguous state with one candidate is not part of this protocol.
    let mut invalid = segment("s0", &p.last().unwrap().id, "speech", json!(["c0"]));
    invalid["attribution"] = json!({"state":"ambiguous","keys":["c0"]});
    assert!(
        decode_analysis(
            json!({"segments":[invalid]}),
            &p,
            0..p.len(),
            &b,
            &known,
            &BTreeMap::new()
        )
        .is_err()
    );
}

#[test]
fn evidence_and_plan_corruption_are_rejected_before_returning_annotations() {
    let (b, p, known) = fixture();
    for evidence in [
        json!([]),
        json!(["s9999"]),
        json!(["s0", "s0"]),
        json!(["s00"]),
    ] {
        let mut s = segment("s0", &p.last().unwrap().id, "speech", json!(["c0"]));
        s["evidence"] = evidence;
        assert!(
            decode_analysis(
                json!({"segments":[s]}),
                &p,
                0..p.len(),
                &b,
                &known,
                &BTreeMap::new()
            )
            .is_err()
        );
    }
    let mut broken = p.clone();
    broken[0].range.start += 1;
    assert!(decode_roles(role_output(), &broken, &b, &known).is_err());
    let mut foreign = known;
    foreign[0].project_id = "foreign".into();
    assert!(decode_roles(role_output(), &p, &b, &foreign).is_err());
}

#[test]
fn reviews_roundtrip_with_references_and_do_not_mutate_results_or_identities() {
    let (_, p, known) = fixture();
    let before = known.clone();
    let review = validate_review(review_output(), &p, &known, &BTreeMap::new()).unwrap();
    assert_eq!(review.issues[0].target_ids, ["s1"]);
    assert_eq!(review.issues[0].suggested_who, ["c0"]);
    assert_eq!(known, before);
    assert_eq!(
        serde_json::from_value::<Review>(serde_json::to_value(&review).unwrap()).unwrap(),
        review
    );
    assert!(
        validate_review(
            json!({"issues":[],"summary":"未发现可定位的问题，仍须人工审阅"}),
            &p,
            &known,
            &BTreeMap::new()
        )
        .unwrap()
        .issues
        .is_empty()
    );
}

#[test]
fn reviews_reject_forged_targets_suggestions_conflicts_and_unknown_certainty() {
    let (_, p, known) = fixture();
    for (field, value) in [
        ("targetIds", json!(["s9999"])),
        ("targetIds", json!([])),
        ("targetIds", json!(["s0", "s0"])),
        ("reason", json!(" \n")),
        ("category", json!("")),
        ("suggestedWho", json!(["new:99"])),
        ("suggestedWho", json!(["c0", "c0"])),
        ("suggestedWho", json!(["narrator"])),
        ("certainty", json!("confirmed")),
        ("suggestedKind", json!("narration")),
    ] {
        let mut v = review_output();
        v["issues"][0][field] = value;
        assert!(
            validate_review(v, &p, &known, &BTreeMap::new()).is_err(),
            "{field}"
        );
    }
}

#[test]
fn uncertain_review_can_have_only_a_kind_or_only_an_identity_suggestion() {
    let (_, p, known) = fixture();
    let mut v = review_output();
    v["issues"][0]["certainty"] = json!("uncertain");
    v["issues"][0]["suggestedWho"] = json!([]);
    assert!(validate_review(v.clone(), &p, &known, &BTreeMap::new()).is_ok());
    v["issues"][0]["suggestedKind"] = Value::Null;
    v["issues"][0]["suggestedWho"] = json!(["c0"]);
    assert!(validate_review(v, &p, &known, &BTreeMap::new()).is_ok());
}

#[test]
fn two_keys_for_one_uuid_cannot_forge_two_ambiguous_candidates() {
    let (b, p, known) = fixture();
    let mut local = decode_roles(role_output(), &p, &b, &known).unwrap();
    local.get_mut("new:0").unwrap().id = known[0].id.clone();
    let value = json!({"segments":[segment("s0", &p.last().unwrap().id, "speech", json!(["c0", "new:0"]))]});
    assert!(decode_analysis(value, &p, 0..p.len(), &b, &known, &local).is_err());
}

#[test]
fn blank_segment_reason_and_unrequested_output_fields_are_rejected() {
    let (b, p, known) = fixture();
    for (field, value) in [("reason", json!(" \r\n")), ("review", json!("confirmed"))] {
        let mut s = segment("s0", &p.last().unwrap().id, "speech", json!(["c0"]));
        s[field] = value;
        assert!(
            decode_analysis(
                json!({"segments":[s]}),
                &p,
                0..p.len(),
                &b,
                &known,
                &BTreeMap::new()
            )
            .is_err()
        );
    }
}
