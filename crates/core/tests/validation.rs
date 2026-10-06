//! Public API tests for source-bound annotation invariants.

use castglean_core::*;
use serde_json::json;

fn fixture() -> (CharacterRegistry, Vec<ChapterInput>) {
    let registry = serde_json::from_value(json!({
        "format_version": 1, "book_id": "demo", "revision": 1,
        "characters": [{"id":"a", "display_name":"张三", "aliases":["老张"],
            "review_status":"unreviewed", "evidence":[{"chapter_id":"one", "segment_id":"n"}]}]
    }))
    .unwrap();
    let source = SourceSnapshot::import("张三说：“走吧。”");
    let annotations = serde_json::from_value(json!({
        "format_version":1, "book_id":"demo", "chapter_id":"one", "character_revision":1,
        "source":source.metadata(),
        "segments":[{"id":"n", "start":0, "end":12, "kind":"narration"},
            {"id":"s", "start":12, "end":27, "kind":"speech", "attribution": {
                "status":"resolved", "character_id":"a", "evidence_segment_ids":["n"], "review_status":"unreviewed"}}]
    })).unwrap();
    (
        registry,
        vec![ChapterInput {
            annotations,
            source,
        }],
    )
}

#[test]
fn validated_slices_reconstruct_source_and_clones_do_not_mutate_results() {
    let (registry, chapters) = fixture();
    let book = validate_book(registry, chapters).unwrap();
    let chapter = &book.chapters()[0];
    let restored: String = chapter.segments().map(|(_, text)| text).collect();
    assert_eq!(restored, chapter.source().text());
    assert_eq!(chapter.segments().nth(1).unwrap().1, "“走吧。”");
    let mut clone = chapter.annotations().clone();
    clone.segments[1].start = 13;
    assert!(
        validate_book(
            book.registry().clone(),
            vec![ChapterInput {
                annotations: clone,
                source: chapter.source().clone()
            }]
        )
        .is_err()
    );
    assert_eq!(chapter.segments().nth(1).unwrap().1, "“走吧。”");
}

#[test]
fn rejects_gaps_overlaps_unordered_empty_midpoint_and_incomplete_ranges() {
    for (start, end) in [(13, 27), (15, 27), (9, 27), (12, 12), (12, 30), (0, 27)] {
        let (registry, mut chapters) = fixture();
        chapters[0].annotations.segments[1].start = start;
        chapters[0].annotations.segments[1].end = end;
        assert!(validate_book(registry, chapters).is_err(), "{start}..{end}");
    }
    let (registry, mut chapters) = fixture();
    chapters[0].annotations.segments.pop();
    assert!(validate_book(registry, chapters).is_err());
}

#[test]
fn rejects_identity_version_and_revision_conflicts() {
    let (registry, chapters) = fixture();
    let mut bad_registry = registry.clone();
    bad_registry.characters.push(registry.characters[0].clone());
    assert!(validate_book(bad_registry, chapters.clone()).is_err());
    let mut bad_registry = registry.clone();
    bad_registry.format_version = 2;
    assert!(validate_book(bad_registry, chapters.clone()).is_err());
    let mut bad_registry = registry.clone();
    bad_registry.revision = 0;
    assert!(validate_book(bad_registry, chapters.clone()).is_err());
    let mut bad_registry = registry.clone();
    bad_registry.characters[0].display_name = " ".into();
    assert!(validate_book(bad_registry, chapters.clone()).is_err());
    let mut bad_registry = registry.clone();
    bad_registry.characters[0].aliases.push("\n".into());
    assert!(validate_book(bad_registry, chapters.clone()).is_err());
    for change in [0, 1, 2, 3, 4] {
        let mut bad = chapters.clone();
        match change {
            0 => bad[0].annotations.book_id = BookId::new("other").unwrap(),
            1 => bad[0].annotations.character_revision = 2,
            2 => bad[0].annotations.format_version = 2,
            3 => bad[0].annotations.source.sha256 = "0".repeat(64),
            _ => bad[0].annotations.segments[1].id = SegmentId::new("n").unwrap(),
        }
        assert!(validate_book(registry.clone(), bad).is_err());
    }
    let mut bad = chapters.clone();
    bad.push(chapters[0].clone());
    assert!(validate_book(registry, bad).is_err());
}

#[test]
fn shared_names_and_aliases_do_not_merge_characters() {
    let (mut registry, chapters) = fixture();
    let mut other = registry.characters[0].clone();
    other.id = CharacterId::new("b").unwrap();
    registry.characters.push(other);
    let book = validate_book(registry, chapters).unwrap();
    assert_eq!(book.registry().characters.len(), 2);
}

#[test]
fn unknown_and_ambiguous_attribution_are_preserved() {
    let (mut registry, mut chapters) = fixture();
    let mut other = registry.characters[0].clone();
    other.id = CharacterId::new("b").unwrap();
    registry.characters.push(other);
    chapters[0].annotations.segments[1].attribution = Some(Attribution::Ambiguous {
        candidate_ids: vec![
            CharacterId::new("a").unwrap(),
            CharacterId::new("b").unwrap(),
        ],
        evidence_segment_ids: vec![],
        review_status: ReviewStatus::Unreviewed,
    });
    assert!(validate_book(registry.clone(), chapters.clone()).is_ok());
    for ids in [vec!["a"], vec!["a", "a"], vec!["a", "missing"]] {
        chapters[0].annotations.segments[1].attribution = Some(Attribution::Ambiguous {
            candidate_ids: ids
                .into_iter()
                .map(|id| CharacterId::new(id).unwrap())
                .collect(),
            evidence_segment_ids: vec![],
            review_status: ReviewStatus::Unreviewed,
        });
        assert!(validate_book(registry.clone(), chapters.clone()).is_err());
    }
    chapters[0].annotations.segments[1].attribution = Some(Attribution::Unknown {
        evidence_segment_ids: vec![],
        review_status: ReviewStatus::Confirmed,
    });
    assert!(validate_book(registry, chapters).is_ok());
}

#[test]
fn expressions_do_not_conflate_narration_and_unknown_speakers() {
    let (registry, chapters) = fixture();
    for kind in [ExpressionKind::Speech, ExpressionKind::Thought] {
        let mut bad = chapters.clone();
        bad[0].annotations.segments[1].kind = kind;
        bad[0].annotations.segments[1].attribution = None;
        assert!(validate_book(registry.clone(), bad).is_err());
    }
    let mut quoted = chapters.clone();
    quoted[0].annotations.segments[1].kind = ExpressionKind::QuotedText;
    quoted[0].annotations.segments[1].attribution = None;
    assert!(validate_book(registry.clone(), quoted).is_ok());
    let mut narrator = chapters;
    narrator[0].annotations.segments[0].attribution =
        narrator[0].annotations.segments[1].attribution.clone();
    assert!(validate_book(registry, narrator).is_ok());
}

#[test]
fn evidence_requires_explicit_chapters_and_segments() {
    let (mut registry, chapters) = fixture();
    registry.characters[0].evidence[0].chapter_id = ChapterId::new("two").unwrap();
    assert!(validate_book(registry.clone(), chapters.clone()).is_err());
    let mut second = chapters[0].clone();
    second.annotations.chapter_id = ChapterId::new("two").unwrap();
    let mut both = chapters.clone();
    both.push(second);
    assert!(validate_book(registry.clone(), both).is_ok());
    registry.characters[0].evidence[0].segment_id = SegmentId::new("missing").unwrap();
    assert!(validate_book(registry, chapters).is_err());
    let (registry, mut chapters) = fixture();
    let Some(Attribution::Resolved { character_id, .. }) =
        &mut chapters[0].annotations.segments[1].attribution
    else {
        unreachable!()
    };
    *character_id = CharacterId::new("missing").unwrap();
    assert!(validate_book(registry.clone(), chapters.clone()).is_err());
    let Some(Attribution::Resolved {
        character_id,
        evidence_segment_ids,
        ..
    }) = &mut chapters[0].annotations.segments[1].attribution
    else {
        unreachable!()
    };
    *character_id = CharacterId::new("a").unwrap();
    *evidence_segment_ids = vec![SegmentId::new("missing").unwrap()];
    assert!(validate_book(registry, chapters).is_err());
}

#[test]
fn voice_claims_require_valid_evidence_and_unknown_profile_can_be_empty() {
    let (mut registry, chapters) = fixture();
    registry.characters[0].voice_profile = Some(VoiceProfile {
        gender: Some("unknown".into()),
        age_band: None,
        impressions: vec![],
        evidence: vec![],
    });
    assert!(validate_book(registry.clone(), chapters.clone()).is_ok());
    registry.characters[0]
        .voice_profile
        .as_mut()
        .unwrap()
        .impressions
        .push("低沉".into());
    assert!(validate_book(registry.clone(), chapters.clone()).is_err());
    let evidence = registry.characters[0].evidence.clone();
    registry.characters[0]
        .voice_profile
        .as_mut()
        .unwrap()
        .evidence = evidence;
    assert!(validate_book(registry.clone(), chapters.clone()).is_ok());
    registry.characters[0]
        .voice_profile
        .as_mut()
        .unwrap()
        .evidence[0]
        .segment_id = SegmentId::new("missing").unwrap();
    assert!(validate_book(registry, chapters).is_err());
}

#[test]
fn empty_source_requires_empty_partition_but_whitespace_must_be_covered() {
    let (mut registry, mut chapters) = fixture();
    registry.characters.clear();
    chapters[0].source = SourceSnapshot::import("");
    chapters[0].annotations.source = chapters[0].source.metadata().clone();
    chapters[0].annotations.segments.clear();
    assert!(validate_book(registry.clone(), chapters.clone()).is_ok());
    chapters[0].source = SourceSnapshot::import(" \n");
    chapters[0].annotations.source = chapters[0].source.metadata().clone();
    assert!(validate_book(registry, chapters).is_err());
}

#[test]
fn unknown_fields_blank_ids_and_mixed_attribution_states_are_rejected() {
    assert!(BookId::new(" \n").is_err());
    assert!(serde_json::from_str::<CharacterId>("\" \"").is_err());
    let (registry, chapters) = fixture();
    let mut value = serde_json::to_value(registry).unwrap();
    value["revison"] = json!(1);
    assert!(serde_json::from_value::<CharacterRegistry>(value).is_err());
    let mut annotation = serde_json::to_value(&chapters[0].annotations).unwrap();
    annotation["segments"][1]["attribution"]["status"] = json!("unknown");
    assert!(serde_json::from_value::<ChapterAnnotations>(annotation).is_err());
}
