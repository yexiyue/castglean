//! 纯核心测试：切分覆盖、归属解析、阻塞聚合与单元映射。
use super::*;
use crate::voice_binding::VoiceRef;
use serde_json::json;

fn segment(id: &str, start: usize, end: usize, attribution: Attribution) -> Segment {
    serde_json::from_value(json!({
        "id": id,
        "range": {"start": start, "end": end},
        "kind": "narration",
        "attribution": attribution,
        "review": "confirmed",
        "evidence": [],
        "reason": "test"
    }))
    .unwrap()
}

fn character(id: &str, name: &str) -> Character {
    serde_json::from_value(json!({
        "id": id,
        "projectId": "p",
        "displayName": name,
        "status": "confirmed",
        "revision": 1,
        "origin": {
            "projectId": "p", "chapterId": "c", "sourceId": "s",
            "sha256": "x", "start": 0, "end": 10
        },
        "evidence": []
    }))
    .unwrap()
}

fn binding(target: BindingTarget, voice: Option<VoiceRef>) -> BindingView {
    BindingView {
        binding_id: format!("b-{}", target.storage_key()),
        target,
        revision: 1,
        voice,
        origin: None,
        updated_at: "1".into(),
    }
}

fn role(id: &str) -> BindingTarget {
    BindingTarget::Character {
        character_id: id.into(),
    }
}

fn preset(backend: &str, model: &str, voice: &str) -> VoiceRef {
    VoiceRef::Preset {
        backend: backend.into(),
        model: model.into(),
        voice: voice.into(),
    }
}

fn kokoro(voices: &'static [&'static str]) -> impl Fn(&str, &str) -> Option<ModelFacts> {
    move |backend, model| {
        (backend == "kokoro" && model == "1.1-zh-g2pw").then(|| ModelFacts {
            text_semantics: "test-model:test-text".into(),
            ready: true,
            preset: true,
            cpu: true,
            voices: voices.iter().map(|v| v.to_string()).collect(),
            state: "Ready".into(),
        })
    }
}

fn blocked(outcome: Outcome) -> Vec<ChapterAudioBlocker> {
    match outcome {
        Outcome::Blocked(blockers) => blockers,
        Outcome::Ready(_) => panic!("expected blockers"),
    }
}

fn ready(outcome: Outcome) -> Plan {
    match outcome {
        Outcome::Ready(plan) => plan,
        Outcome::Blocked(blockers) => panic!("unexpected blockers: {blockers:?}"),
    }
}

fn whole(text: &str) -> ByteRange {
    ByteRange {
        start: 0,
        end: text.len() as u32,
    }
}

fn assert_partition(text: &str, range: &ByteRange, units: &[ByteRange]) {
    assert_eq!(units.first().unwrap().start, range.start);
    assert_eq!(units.last().unwrap().end, range.end);
    for pair in units.windows(2) {
        assert_eq!(pair[0].end, pair[1].start, "no gaps or overlaps");
    }
    for unit in units {
        let slice = &text[unit.start as usize..unit.end as usize];
        assert!(slice.chars().count() <= MAX_UNIT_CHARS, "{slice:?}");
    }
}

#[test]
fn split_counts_characters_already_scanned_after_early_sentence_boundary() {
    for boundary in [1, 2, 30, 119] {
        let text = format!("{}。{}", "字".repeat(boundary - 1), "字".repeat(260));
        let range = whole(&text);
        assert_partition(&text, &range, &split_range(&text, range.clone()));
    }
}

#[test]
fn split_prefers_sentence_bounds_and_covers_exactly() {
    let text = "他走了很远。".repeat(60);
    let range = whole(&text);
    let units = split_range(&text, range.clone());
    assert!(units.len() > 1);
    assert_partition(&text, &range, &units);
    for unit in &units {
        assert!(text[unit.start as usize..unit.end as usize].ends_with('。'));
    }
}

#[test]
fn split_keeps_closing_quotes_with_their_sentence() {
    let text = format!("{}“好。”他说。", "字".repeat(MAX_UNIT_CHARS - 4));
    let units = split_range(&text, whole(&text));
    assert_partition(&text, &whole(&text), &units);
    let first = &text[units[0].start as usize..units[0].end as usize];
    assert!(first.ends_with("“好。”"), "closing quote stays: {first:?}");
}

#[test]
fn split_hard_cuts_without_punctuation_and_merges_trailing_space() {
    let text = format!("{} \n\n", "字".repeat(300));
    let range = whole(&text);
    let units = split_range(&text, range.clone());
    assert_eq!(units.len(), 3);
    assert_partition(&text, &range, &units);
    assert_eq!(units.last().unwrap().end, range.end);
    for unit in &units {
        assert!(
            !text[unit.start as usize..unit.end as usize]
                .trim()
                .is_empty()
        );
    }
}

#[test]
fn split_keeps_words_and_numbers_intact_at_the_limit() {
    for expression in [
        "hello-world",
        "don't",
        "S600",
        "12.5%",
        "２０２６/１２/０１",
    ] {
        for prefix in 110..120 {
            let text = format!("{}{expression}结尾", "字".repeat(prefix));
            let units = split_range(&text, whole(&text));
            assert_partition(&text, &whole(&text), &units);
            assert!(
                units.iter().any(|unit| {
                    text[unit.start as usize..unit.end as usize].contains(expression)
                }),
                "expression split: {expression}"
            );
        }
    }
    let text = format!("{}结束", "a".repeat(MAX_UNIT_CHARS + 1));
    let units = split_range(&text, whole(&text));
    assert_eq!(
        &text[units[0].start as usize..units[0].end as usize],
        "a".repeat(MAX_UNIT_CHARS + 1)
    );
}

#[test]
fn split_whitespace_segment_stays_a_single_covering_unit() {
    let text = "前文。\n\n \n后文。";
    let range = ByteRange {
        start: "前文。".len() as u32,
        end: "前文。\n\n \n".len() as u32,
    };
    assert_eq!(split_range(text, range.clone()), vec![range]);
}

#[test]
fn split_never_panics_on_ranges_off_character_boundaries() {
    // 分析校验在上游拒绝此类范围；切分自身只需保持覆盖、不切坏 UTF-8。
    let text = "汉字汉字";
    let misaligned = ByteRange { start: 1, end: 7 };
    assert_eq!(split_range(text, misaligned.clone()), vec![misaligned]);
    let beyond = ByteRange { start: 0, end: 99 };
    assert_eq!(split_range(text, beyond.clone()), vec![beyond]);
}

#[test]
fn assemble_builds_units_with_voices_in_source_order() {
    let narration = "夜色沉了下来。\n";
    let text = format!("{narration}“明天再走吧。”");
    let segments = vec![
        segment("s1", 0, narration.len(), Attribution::Narrator),
        segment(
            "s2",
            narration.len(),
            text.len(),
            Attribution::Resolved {
                character_id: "c1".into(),
            },
        ),
    ];
    let bindings = vec![
        binding(
            BindingTarget::Narrator,
            Some(preset("kokoro", "1.1-zh-g2pw", "zf_001")),
        ),
        binding(role("c1"), Some(preset("kokoro", "1.1-zh-g2pw", "zm_008"))),
    ];
    let plan = ready(assemble(
        &text,
        "v1",
        &segments,
        &[character("c1", "林川")],
        &bindings,
        kokoro(&["zf_001", "zm_008"]),
    ));
    assert_eq!(
        (plan.backend.as_str(), plan.model.as_str()),
        ("kokoro", "1.1-zh-g2pw")
    );
    assert_eq!(plan.version_id, "v1");
    assert_eq!(plan.text_semantics, "test-model:test-text");
    let voices: Vec<_> = plan.units.iter().map(|u| u.voice.as_str()).collect();
    assert_eq!(voices, ["zf_001", "zm_008"]);
    assert!(plan.units.iter().all(|u| !u.empty));
    let summary = plan.summary();
    assert_eq!(
        (
            summary.unit_count,
            summary.narration_units,
            summary.character_count
        ),
        (2, 1, 1)
    );
}

#[test]
fn assemble_reports_unknown_and_ambiguous_with_first_location() {
    let lines = ["一句话。\n", "又一句。\n", "第三句。"];
    let text = lines.concat();
    let (a, b) = (lines[0].len(), lines[0].len() + lines[1].len());
    let segments = vec![
        segment("s1", 0, a, Attribution::Unknown),
        segment("s2", a, b, Attribution::Unknown),
        segment(
            "s3",
            b,
            text.len(),
            Attribution::Ambiguous {
                character_ids: vec!["c1".into(), "c2".into()],
            },
        ),
    ];
    let blockers = blocked(assemble(
        &text,
        "v1",
        &segments,
        &[character("c1", "甲"), character("c2", "乙")],
        &[],
        kokoro(&["zf_001"]),
    ));
    assert_eq!(blockers.len(), 2, "{blockers:?}");
    let unknown = &blockers[0];
    assert_eq!(unknown.kind, ChapterAudioBlockerKind::UnknownAttribution);
    assert_eq!((unknown.count, unknown.line), (2, 0));
    assert_eq!(unknown.segment_id.as_deref(), Some("s1"));
    let ambiguous = &blockers[1];
    assert_eq!(
        ambiguous.kind,
        ChapterAudioBlockerKind::AmbiguousAttribution
    );
    assert_eq!((ambiguous.count, ambiguous.line), (1, 2));
}

fn three_speakers() -> (String, Vec<Segment>, Vec<Character>) {
    let lines = ["甲说话。\n", "旁白。\n", "乙说话。"];
    let text = lines.concat();
    let (a, b) = (lines[0].len(), lines[0].len() + lines[1].len());
    let segments = vec![
        segment(
            "s1",
            0,
            a,
            Attribution::Resolved {
                character_id: "c1".into(),
            },
        ),
        segment("s2", a, b, Attribution::Narrator),
        segment(
            "s3",
            b,
            text.len(),
            Attribution::Resolved {
                character_id: "c2".into(),
            },
        ),
    ];
    (
        text,
        segments,
        vec![character("c1", "甲"), character("c2", "乙")],
    )
}

#[test]
fn assemble_blocks_missing_and_unbound_targets_without_fallback() {
    let (text, segments, characters) = three_speakers();
    let bindings = vec![
        binding(
            BindingTarget::Narrator,
            Some(preset("kokoro", "1.1-zh-g2pw", "zf_001")),
        ),
        binding(role("c2"), None),
    ];
    let blockers = blocked(assemble(
        &text,
        "v1",
        &segments,
        &characters,
        &bindings,
        kokoro(&["zf_001"]),
    ));
    assert_eq!(blockers.len(), 2, "{blockers:?}");
    assert!(
        blockers
            .iter()
            .all(|b| b.kind == ChapterAudioBlockerKind::MissingBinding)
    );
    let names: Vec<_> = blockers
        .iter()
        .map(|b| b.character_name.as_deref().unwrap())
        .collect();
    assert_eq!(names, ["甲", "乙"]);
    assert_eq!(blockers[1].line, 2, "locates the unbound character's line");
}

#[test]
fn assemble_blocks_library_voices_and_mixed_combinations() {
    let (text, segments, characters) = three_speakers();
    let narrator = binding(
        BindingTarget::Narrator,
        Some(preset("kokoro", "1.1-zh-g2pw", "zf_001")),
    );
    let library = vec![
        narrator.clone(),
        binding(
            role("c1"),
            Some(VoiceRef::Library {
                id: "voice-a".into(),
            }),
        ),
        binding(role("c2"), Some(preset("kokoro", "1.1-zh-g2pw", "zm_008"))),
    ];
    let blockers = blocked(assemble(
        &text,
        "v1",
        &segments,
        &characters,
        &library,
        kokoro(&["zf_001", "zm_008"]),
    ));
    assert_eq!(blockers.len(), 1);
    assert_eq!(blockers[0].kind, ChapterAudioBlockerKind::VoiceNotPreset);
    assert_eq!(blockers[0].character_name.as_deref(), Some("甲"));

    let mixed = vec![
        narrator,
        binding(role("c1"), Some(preset("kokoro", "1.1-zh-g2pw", "zm_008"))),
        binding(role("c2"), Some(preset("moss", "nano-candle", "Weiguo"))),
    ];
    let blockers = blocked(assemble(
        &text,
        "v1",
        &segments,
        &characters,
        &mixed,
        kokoro(&["zf_001", "zm_008"]),
    ));
    assert_eq!(blockers.len(), 1);
    assert_eq!(blockers[0].kind, ChapterAudioBlockerKind::MixedCombos);
    let detail = blockers[0].detail.as_deref().unwrap();
    assert!(detail.contains("kokoro/1.1-zh-g2pw") && detail.contains("moss/nano-candle"));
}

#[test]
fn assemble_blocks_unready_resources_and_missing_catalog_voices() {
    let text = "旁白一句。";
    let segments = vec![segment("s1", 0, text.len(), Attribution::Narrator)];
    let bindings = vec![binding(
        BindingTarget::Narrator,
        Some(preset("kokoro", "1.1-zh-g2pw", "zf_001")),
    )];

    let not_ready = |_: &str, _: &str| {
        Some(ModelFacts {
            text_semantics: "test-model:test-text".into(),
            ready: false,
            preset: true,
            cpu: true,
            voices: vec!["zf_001".into()],
            state: "Missing".into(),
        })
    };
    let blockers = blocked(assemble(text, "v1", &segments, &[], &bindings, not_ready));
    assert_eq!(blockers[0].kind, ChapterAudioBlockerKind::ResourceNotReady);
    assert!(blockers[0].detail.as_deref().unwrap().contains("Missing"));

    let unknown = blocked(assemble(text, "v1", &segments, &[], &bindings, |_, _| None));
    assert_eq!(unknown[0].kind, ChapterAudioBlockerKind::ResourceNotReady);
    assert_eq!(unknown[0].detail.as_deref(), Some("kokoro/1.1-zh-g2pw"));

    let missing = blocked(assemble(
        text,
        "v1",
        &segments,
        &[],
        &bindings,
        kokoro(&["zm_008"]),
    ));
    assert_eq!(missing[0].kind, ChapterAudioBlockerKind::VoiceMissing);
    assert_eq!(
        missing[0].detail.as_deref(),
        Some("kokoro/1.1-zh-g2pw/zf_001")
    );
}

#[test]
fn assemble_splits_long_segments_into_contiguous_units() {
    let text = "他走了很远。".repeat(40);
    let segments = vec![segment("s1", 0, text.len(), Attribution::Narrator)];
    let bindings = vec![binding(
        BindingTarget::Narrator,
        Some(preset("kokoro", "1.1-zh-g2pw", "zf_001")),
    )];
    let plan = ready(assemble(
        &text,
        "v1",
        &segments,
        &[],
        &bindings,
        kokoro(&["zf_001"]),
    ));
    assert!(plan.units.len() > 1);
    let ranges: Vec<_> = plan.units.iter().map(|u| u.range.clone()).collect();
    assert_partition(&text, &whole(&text), &ranges);
    assert!(plan.units.iter().all(|u| u.segment_id == "s1"));
}
