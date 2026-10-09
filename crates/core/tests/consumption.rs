//! Whole-chapter handoff through existing public APIs, independent of TTS.
use castglean_core::*;

fn fixture() -> (CharacterRegistry, ChapterInput) {
    let registry = read_json(
        include_bytes!("../../../examples/chapter-consumption/characters.json").as_slice(),
    )
    .unwrap();
    let annotations: ChapterAnnotations = read_json(
        include_bytes!("../../../examples/chapter-consumption/chapter.annotations.json").as_slice(),
    )
    .unwrap();
    let source = SourceSnapshot::from_saved(
        include_str!("../../../examples/chapter-consumption/chapter.txt").into(),
        annotations.source.clone(),
    )
    .unwrap();
    (
        registry,
        ChapterInput {
            annotations,
            source,
        },
    )
}

#[test]
fn whole_chapter_preserves_partition_identities_and_attribution_states() {
    let (registry, input) = fixture();
    let original = input.annotations.clone();
    let book = validate_book(registry, vec![input]).unwrap();
    let chapter = &book.chapters()[0];
    let mut cursor = 0;
    let mut text = String::new();
    for (segment, slice) in chapter.segments() {
        assert_eq!(segment.start, cursor);
        assert_eq!(slice, &chapter.source().text()[segment.start..segment.end]);
        cursor = segment.end;
        text.push_str(slice);
        if let Some(Attribution::Resolved { character_id, .. }) = &segment.attribution {
            assert!(
                book.registry()
                    .characters
                    .iter()
                    .any(|c| &c.id == character_id)
            );
        }
    }
    assert_eq!(text, chapter.source().text());
    assert_eq!(cursor, text.len());
    assert_eq!(chapter.annotations(), &original);
    let segments = &chapter.annotations().segments;
    let ids: Vec<_> = [1, 3, 4]
        .into_iter()
        .map(|i| {
            let Some(Attribution::Resolved { character_id, .. }) = &segments[i].attribution else {
                panic!("resolved dialogue expected");
            };
            character_id.as_str()
        })
        .collect();
    assert_eq!(ids, ["person-a", "person-b", "person-a"]);
    assert_eq!(segments[0].kind, ExpressionKind::Narration);
    assert!(
        matches!(&segments[0].attribution, Some(Attribution::Resolved { character_id, .. }) if character_id.as_str() == "narrator")
    );
    assert!(segments[5].attribution.is_none());
    assert!(
        chapter
            .segments()
            .nth(5)
            .unwrap()
            .1
            .chars()
            .all(char::is_whitespace)
    );
    assert!(matches!(
        segments[6].attribution,
        Some(Attribution::Unknown { .. })
    ));
    assert!(
        matches!(&segments[7].attribution, Some(Attribution::Ambiguous { candidate_ids, .. }) if candidate_ids.len() == 2)
    );
    let state = BookState::from_validated(book).unwrap();
    let candidates = state
        .candidates("张三", &ChapterId::new("chapter").unwrap())
        .unwrap();
    assert_eq!(candidates.len(), 2);
    assert_ne!(candidates[0].id, candidates[1].id);
}

#[test]
fn normalization_whitespace_and_empty_chapters_are_consumed_exactly_once() {
    for raw in [
        "我\r\n🙂\re\u{301}\t\u{3000}",
        "\r\n\t\u{a0}\u{2003}\u{3000}",
        "",
    ] {
        // A host can freeze this snapshot before starting any analysis.
        let source = SourceSnapshot::import(raw);
        let expected = raw.replace("\r\n", "\n").replace('\r', "\n");
        let (mut registry, input) = fixture();
        registry.characters.clear();
        let mut annotations = input.annotations;
        annotations.source = source.metadata().clone();
        annotations.segments = if expected.is_empty() {
            vec![]
        } else {
            vec![Segment {
                id: SegmentId::new("whole").unwrap(),
                start: 0,
                end: source.text().len(),
                kind: ExpressionKind::Narration,
                attribution: None,
                extensions: Default::default(),
            }]
        };
        let book = validate_book(
            registry,
            vec![ChapterInput {
                annotations,
                source,
            }],
        )
        .unwrap();
        let chapter = &book.chapters()[0];
        assert_eq!(
            chapter.segments().map(|(_, t)| t).collect::<String>(),
            expected
        );
        assert_eq!(chapter.segments().len(), usize::from(!expected.is_empty()));
        assert_eq!(chapter.source().text(), expected);
    }
}

#[test]
fn invalid_handoffs_never_become_validated_results() {
    let (registry, input) = fixture();
    let mut cases = Vec::new();
    let mut wrong_hash = input.clone();
    wrong_hash.annotations.source.sha256 = "0".repeat(64);
    cases.push(wrong_hash);
    let mut wrong_revision = input.clone();
    wrong_revision.annotations.character_revision += 1;
    cases.push(wrong_revision);
    let mut bad_utf8 = input.clone();
    bad_utf8.annotations.segments[0].end = 1;
    cases.push(bad_utf8);
    let mut gap = input.clone();
    gap.annotations.segments.remove(2);
    cases.push(gap);
    let mut overlap = input.clone();
    overlap.annotations.segments[1].start = 0;
    cases.push(overlap);
    let mut missing = input.clone();
    missing.annotations.segments.pop();
    cases.push(missing);
    let mut wrong_character = input.clone();
    if let Some(Attribution::Resolved { character_id, .. }) =
        &mut wrong_character.annotations.segments[1].attribution
    {
        *character_id = CharacterId::new("absent").unwrap();
    }
    cases.push(wrong_character);
    let mut bad_evidence = input.clone();
    if let Some(Attribution::Resolved {
        evidence_segment_ids,
        ..
    }) = &mut bad_evidence.annotations.segments[1].attribution
    {
        evidence_segment_ids.push(SegmentId::new("absent").unwrap());
    }
    cases.push(bad_evidence);
    for candidate in cases {
        assert!(validate_book(registry.clone(), vec![candidate]).is_err());
    }
    assert!(
        SourceSnapshot::from_saved(
            format!("{}!", input.source.text()),
            input.source.metadata().clone()
        )
        .is_err()
    );
    assert_ne!(
        SourceSnapshot::import(&format!("{}!", input.source.text()))
            .metadata()
            .sha256,
        input.source.metadata().sha256
    );
}

#[test]
fn correction_requires_new_handoff_identity_and_preserves_old_consumption() {
    let (registry, input) = fixture();
    let state = BookState::from_validated(validate_book(registry, vec![input]).unwrap()).unwrap();
    let before = state.document();
    let chapter = &state.book().chapters()[0];
    let handoff = (
        &chapter.annotations().book_id,
        &chapter.annotations().chapter_id,
        &chapter.source().metadata().sha256,
        chapter.annotations().character_revision,
    );
    let correction = CorrectionBatch {
        book_id: handoff.0.clone(),
        expected_revision: handoff.3,
        corrections: vec![Correction::Attribution {
            chapter_id: handoff.1.clone(),
            source_sha256: handoff.2.clone(),
            segment_id: SegmentId::new("s6").unwrap(),
            expression_kind: ExpressionKind::Speech,
            attribution: Some(Attribution::Resolved {
                character_id: CharacterId::new("person-b").unwrap(),
                evidence_segment_ids: vec![SegmentId::new("s3").unwrap()],
                review_status: ReviewStatus::Unreviewed,
            }),
        }],
    };
    let corrected = state.correct(correction.clone()).unwrap();
    let updated = &corrected.book().chapters()[0];
    assert_ne!(updated.annotations().character_revision, handoff.3);
    assert_eq!(updated.source().metadata().sha256, *handoff.2);
    assert_eq!(updated.source().text(), chapter.source().text());
    assert_eq!(
        corrected.book().registry().characters,
        state.book().registry().characters
    );
    assert!(
        matches!(&updated.annotations().segments[6].attribution, Some(Attribution::Resolved { character_id, review_status: ReviewStatus::Confirmed, .. }) if character_id.as_str() == "person-b")
    );
    assert_eq!(state.document(), before);
    assert!(matches!(
        corrected.correct(correction),
        Err(BookError::Revision { .. })
    ));
    assert!(matches!(
        chapter.annotations().segments[6].attribution,
        Some(Attribution::Unknown { .. })
    ));
}
