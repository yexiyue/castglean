//! The evidence gate checks exact provenance, not semantic entailment.
use castglean_core::*;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Fake<F>(F);
impl<F: Fn(ModelRequest) -> Value + Sync> AnalysisModel for Fake<F> {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        Ok(ModelResponse {
            text: (self.0)(request).to_string(),
            truncated: false,
            usage: TokenUsage::default(),
        })
    }
}
fn input(text: &str) -> AnalysisInput<'static> {
    AnalysisInput {
        book_id: BookId::new("book").unwrap(),
        chapter_id: ChapterId::new("chapter").unwrap(),
        source: SourceSnapshot::import(text),
        context: None,
    }
}
fn options() -> AnalysisOptions {
    AnalysisOptions {
        evidence_mode: EvidenceMode::VerifiedQuotes,
        max_repairs_per_window: 1,
        ..Default::default()
    }
}
fn candidate(request: &ModelRequest) -> Value {
    let payload: Value = serde_json::from_str(&request.user).unwrap();
    let id = &payload["segments"][0]["id"];
    let quotes = json!([{"segment_id":id,"quote":"张三说"}]);
    json!({"characters":[{"temp_id":"a","display_name":"张三","aliases":[],"evidence_segment_ids":[id],"evidence_quotes":quotes}],
        "segments":payload["segments"].as_array().unwrap().iter().filter(|s| s["target"]==true).map(|s| {
            if s["text"].as_str().unwrap().starts_with('“') {
                json!({"segment_id":s["id"],"kind":"speech","attribution":{"status":"resolved","character":{"scope":"new","id":"a"},"evidence_segment_ids":[id],"evidence_quotes":quotes}})
            } else {json!({"segment_id":s["id"],"kind":"narration","attribution":null})}
        }).collect::<Vec<_>>()})
}
async fn run<F: Fn(ModelRequest) -> Value + Sync>(
    f: F,
    text: &str,
    opts: &AnalysisOptions,
) -> Result<AnalysisResult, AnalysisError> {
    analyze_chapter(&Fake(f), input(text), opts, &CancellationToken::new()).await
}

#[tokio::test]
async fn exact_quotes_generate_hash_bound_unicode_byte_ranges_and_roundtrip() {
    let result = run(
        |r| {
            assert_eq!(r.evidence_mode, EvidenceMode::VerifiedQuotes);
            assert!(r.system.contains("本次启用原文引文校验"));
            candidate(&r)
        },
        "🙂张三说：“走吧。”",
        &options(),
    )
    .await
    .unwrap();
    let character = &result.book.registry().characters[0];
    let proof = &character.extensions["castglean.quotation_evidence"]["quotes"][0];
    assert_eq!(proof["start"], 4);
    assert_eq!(proof["end"], 13);
    assert_eq!(
        proof["source_sha256"],
        result.book.chapters()[0].source().metadata().sha256
    );
    let chapter = &result.book.chapters()[0];
    let annotated = chapter
        .annotations()
        .segments
        .iter()
        .find(|s| s.kind == ExpressionKind::Speech)
        .unwrap();
    assert_eq!(
        annotated.extensions["castglean.quotation_evidence"]["quotes"][0],
        *proof
    );
    validate_book(
        result.book.registry().clone(),
        vec![ChapterInput {
            annotations: chapter.annotations().clone(),
            source: chapter.source().clone(),
        }],
    )
    .unwrap();
}

#[tokio::test]
async fn quote_failures_are_safe_and_do_not_accept_candidates() {
    for (quotes, expected) in [
        (json!([]), SuggestionIssueCode::MissingQuotation),
        (
            json!([{"quote":"秘密不是原文"}]),
            SuggestionIssueCode::QuotationNotFound,
        ),
        (
            json!([{"quote":" \n"}]),
            SuggestionIssueCode::InvalidQuotation,
        ),
        (
            json!([{"quote":"🙂".repeat(257)}]),
            SuggestionIssueCode::InvalidQuotation,
        ),
        (
            json!([{"quote":"张三说"},{"quote":"张三说"}]),
            SuggestionIssueCode::InvalidQuotation,
        ),
        (
            json!([{"quote":"张三说","segment_id":"private-rejected-id"}]),
            SuggestionIssueCode::InvalidQuotation,
        ),
        (
            json!(
                (0..9)
                    .map(|_| json!({"quote":"张三说"}))
                    .collect::<Vec<_>>()
            ),
            SuggestionIssueCode::InvalidQuotation,
        ),
    ] {
        let error = run(
            |r| {
                let mut c = candidate(&r);
                let id = c["characters"][0]["evidence_segment_ids"][0].clone();
                let mut q = quotes.clone();
                for item in q.as_array_mut().unwrap() {
                    if item.get("segment_id").is_none() {
                        item["segment_id"] = id.clone();
                    }
                }
                c["characters"][0]["evidence_quotes"] = q;
                c
            },
            "张三说：“走吧。”",
            &options(),
        )
        .await
        .err()
        .unwrap();
        let AnalysisError::RepairExhausted(issue) = error else {
            panic!("unexpected error")
        };
        assert_eq!(issue.code(), expected);
        assert!(!format!("{issue:?} {issue}").contains("private-rejected"));
        assert!(!format!("{issue:?} {issue}").contains("秘密"));
    }
    let error = run(|r| candidate(&r), "张三说，张三说：“走吧。”", &options())
        .await
        .err()
        .unwrap();
    assert!(
        matches!(error, AnalysisError::RepairExhausted(i) if i.code()==SuggestionIssueCode::QuotationNotUnique)
    );
}

#[tokio::test]
async fn missing_attribution_quote_repairs_without_identity_pollution() {
    let calls = AtomicUsize::new(0);
    let result = run(
        |r| {
            let payload: Value = serde_json::from_str(&r.user).unwrap();
            assert!(payload["characters"].as_array().unwrap().is_empty());
            let mut c = candidate(&r);
            if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                c["segments"][1]["attribution"]
                    .as_object_mut()
                    .unwrap()
                    .remove("evidence_quotes");
            } else {
                assert_eq!(payload["repair"]["issue"]["code"], "missing_quotation");
                assert_eq!(
                    payload["repair"]["issue"]["path"],
                    "/segments/1/attribution/evidence_quotes"
                );
            }
            c
        },
        "张三说：“走吧。”",
        &AnalysisOptions {
            max_repairs_per_window: 1,
            ..options()
        },
    )
    .await
    .unwrap();
    assert_eq!(result.book.registry().characters.len(), 1);
    assert_eq!(result.stats.requests, 2);
    assert_eq!(result.stats.repaired_windows, 1);
}

#[tokio::test]
async fn unknown_needs_no_quote_and_exact_text_does_not_prove_semantics() {
    let result=run(|r| {
        let p:Value=serde_json::from_str(&r.user).unwrap();
        json!({"characters":[],"segments":p["segments"].as_array().unwrap().iter().map(|s|json!({"segment_id":s["id"],"kind":"speech","attribution":{"status":"unknown","evidence_segment_ids":[]}})).collect::<Vec<_>>()})
    }, "“有人吗？”", &options()).await.unwrap();
    assert_eq!(result.stats.requests, 1);
    // The quote is real, but the display name and attribution are not entailed.
    run(
        |r| {
            let mut c = candidate(&r);
            c["characters"][0]["display_name"] = json!("李四");
            c
        },
        "张三说：“走吧。”",
        &options(),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn saved_evidence_tampering_is_rejected_even_when_original_documents_are_valid() {
    let result = run(|r| candidate(&r), "🙂张三说：“走吧。”", &options())
        .await
        .unwrap();
    let ch = &result.book.chapters()[0];
    for (field, value) in [
        ("start", json!(5)),
        ("end", json!(1000)),
        ("quote", json!("private-value")),
        ("source_sha256", json!("wrong")),
        ("chapter_id", json!("wrong")),
        ("segment_id", json!("wrong")),
    ] {
        let mut registry = result.book.registry().clone();
        registry.characters[0]
            .extensions
            .get_mut("castglean.quotation_evidence")
            .unwrap()["quotes"][0][field] = value.clone();
        let error = validate_book(
            registry,
            vec![ChapterInput {
                annotations: ch.annotations().clone(),
                source: ch.source().clone(),
            }],
        )
        .unwrap_err();
        assert!(!error.to_string().contains("private-value"));
        let mut annotations = ch.annotations().clone();
        let s = annotations
            .segments
            .iter_mut()
            .find(|s| s.kind == ExpressionKind::Speech)
            .unwrap();
        s.extensions
            .get_mut("castglean.quotation_evidence")
            .unwrap()["quotes"][0][field] = value;
        assert!(
            validate_book(
                result.book.registry().clone(),
                vec![ChapterInput {
                    annotations,
                    source: ch.source().clone()
                }]
            )
            .is_err()
        );
    }
}

#[test]
fn legacy_schema_omits_quotes_and_experimental_schema_describes_them() {
    assert!(
        !analysis_suggestion_schema()
            .to_value()
            .to_string()
            .contains("evidence_quotes")
    );
    let schema = analysis_suggestion_schema_for(EvidenceMode::VerifiedQuotes).to_value();
    assert!(schema.to_string().contains("evidence_quotes"));
    let validator = jsonschema::validator_for(&schema).unwrap();
    assert!(!validator.is_valid(&json!({"characters":[{"temp_id":"a","display_name":"张三","aliases":[],"evidence_segment_ids":["s"]}],"segments":[]})));
    assert!(!validator.is_valid(&json!({"characters":[],"segments":[{"segment_id":"s","kind":"speech","attribution":{"status":"resolved","character":{"scope":"new","id":"a"},"evidence_segment_ids":["s"]}}]})));
    assert!(validator.is_valid(&json!({"characters":[],"segments":[{"segment_id":"s","kind":"speech","attribution":{"status":"unknown","evidence_segment_ids":[]}}]})));
    assert_eq!(EvidenceMode::default().prompt_version(), 9);
    assert_eq!(EvidenceMode::VerifiedQuotes.prompt_version(), 10);
}

#[tokio::test]
async fn disabled_repair_and_cancellation_keep_quotation_gate_bounded() {
    let calls = AtomicUsize::new(0);
    let model = Fake(|r| {
        calls.fetch_add(1, Ordering::SeqCst);
        let mut c = candidate(&r);
        c["characters"][0]
            .as_object_mut()
            .unwrap()
            .remove("evidence_quotes");
        c
    });
    let error = analyze_chapter(
        &model,
        input("张三说：“走吧。”"),
        &AnalysisOptions {
            max_repairs_per_window: 0,
            ..options()
        },
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(
        error,
        AnalysisError::Suggestion("supporting source quotation required")
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let cancel = CancellationToken::new();
    let model = Fake(|r| {
        cancel.cancel();
        candidate(&r)
    });
    assert!(matches!(
        analyze_chapter(&model, input("张三说：“走吧。”"), &options(), &cancel).await,
        Err(AnalysisError::Cancelled)
    ));
}

#[tokio::test(start_paused = true)]
async fn quotation_mode_obeys_chapter_deadline() {
    struct Pending;
    impl AnalysisModel for Pending {
        async fn generate(&self, _: ModelRequest) -> Result<ModelResponse, ModelError> {
            std::future::pending().await
        }
    }
    let error = analyze_chapter(
        &Pending,
        input("张三说：“走吧。”"),
        &AnalysisOptions {
            chapter_timeout: std::time::Duration::from_millis(10),
            ..options()
        },
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(error, AnalysisError::ChapterTimeout));
}
