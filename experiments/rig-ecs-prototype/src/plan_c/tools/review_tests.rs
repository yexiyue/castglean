//! Offline regressions from the independent Plan C review.
//!
//! The parent module owns registration (`#[cfg(test)] mod review_tests;`).
//! Runner trace normalization is deliberately not reimplemented here: it needs
//! an actual runner result passed to the public Python evaluator.

use super::*;

fn analysis_draft(text: &str) -> Draft {
    let case = serde_json::from_value(json!({
        "version": 1,
        "caseId": "review-regression",
        "evaluationTask": "analysis",
        "source": {"text": text, "sha256": hash(text.as_bytes())},
        "characters": [{"id": "c-speaker", "name": "她"}]
    }))
    .unwrap();
    Draft::new(case, false).unwrap()
}

#[test]
fn opening_quote_without_colon_allows_exact_narration_and_speech() {
    for (open, close) in [
        ('“', '”'),
        ('‘', '’'),
        ('「', '」'),
        ('『', '』'),
        ('"', '"'),
    ] {
        // A supplementary character before the boundary catches character-
        // versus UTF-8-byte offsets as well as the original missing boundary.
        let narration = "她指着𠮷字说";
        let speech = format!("{open}好。{close}");
        let text = format!("{narration}{speech}");
        let mut draft = analysis_draft(&text);
        let boundary = narration.len();
        let speech_first = draft
            .pieces
            .iter()
            .position(|piece| piece.start == boundary)
            .expect("opening quote must start a separately addressable piece");
        assert!(speech_first > 0);
        assert_eq!(draft.pieces[speech_first - 1].end, boundary);
        assert_eq!(
            draft
                .pieces
                .iter()
                .map(|p| p.text.as_str())
                .collect::<String>(),
            text
        );

        let first = draft.pieces.first().unwrap().id.clone();
        let narration_last = draft.pieces[speech_first - 1].id.clone();
        let speech_first = draft.pieces[speech_first].id.clone();
        let last = draft.pieces.last().unwrap().id.clone();
        let patched = draft.call(
            "patch_annotations",
            json!({
                "operationId": "quote-boundary",
                "expectedRevision": 0,
                "from": first,
                "to": last,
                "segments": [
                    {"from": first, "to": narration_last,
                     "kind": "narration", "speaker": "narrator",
                     "evidence": [first], "reason": "引语前的叙述提示语"},
                    {"from": speech_first, "to": last,
                     "kind": "speech", "speaker": "c-speaker",
                     "evidence": [first], "reason": "她实际说出的完整引语"}
                ]
            }),
        );
        assert_eq!(patched["ok"], true, "{open}: {patched}");
        let finished = draft.call("finish_analysis", json!({"expectedRevision": 1}));
        assert_eq!(finished["completed"], true, "{open}: {finished}");
        let segments = draft.segments();
        assert_eq!(segments.len(), 2);
        assert_eq!((segments[0].start, segments[0].end), (0, boundary));
        assert_eq!(segments[0].kind, "narration");
        assert_eq!(segments[0].speaker, "narrator");
        assert_eq!((segments[1].start, segments[1].end), (boundary, text.len()));
        assert_eq!(segments[1].kind, "speech");
        assert_eq!(segments[1].speaker, "c-speaker");
        assert_eq!(&text[segments[1].start..segments[1].end], speech);
    }
}

#[test]
fn third_failed_validation_exhausts_budget_without_incrementing_again() {
    // Both public validation entry points must consume the same fixed budget.
    for validation_tool in ["check_draft", "finish_analysis"] {
        let mut draft = analysis_draft("她说“好。”");
        for expected_round in 1..=3 {
            let reply = draft.call(validation_tool, json!({"expectedRevision": 0}));
            assert_eq!(reply["ok"], false);
            assert_eq!(reply["error"], "incomplete_draft");
            assert_eq!(reply["repairRounds"], expected_round);
            assert_eq!(draft.repair_rounds, expected_round);
        }
        let revision = draft.revision;
        let segments = draft.segments();
        for tool in ["check_draft", "finish_analysis", "check_draft"] {
            let reply = draft.call(tool, json!({"expectedRevision": revision}));
            assert_eq!(reply["ok"], false);
            assert_eq!(reply["error"], "repair_budget_exhausted");
            assert_eq!(draft.repair_rounds, 3);
            assert_eq!(draft.revision, revision);
            assert_eq!(draft.segments(), segments);
            assert!(!draft.finished());
        }
        assert_eq!(draft.first_check_valid, Some(false));
    }
}
