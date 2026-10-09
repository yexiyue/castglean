//! Incremental handoff invariants without model, TTS or filesystem dependencies.
use castglean_core::*;
use serde_json::{Value, json};
use std::{
    future::pending,
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

struct Model<F>(F);
impl<F: Fn(ModelRequest) -> Result<ModelResponse, ModelError> + Sync> AnalysisModel for Model<F> {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        (self.0)(request)
    }
}
#[derive(Default)]
struct Collect(Vec<AcceptedPrefixBatch>);
impl AnalysisConsumer for Collect {
    async fn accept(&mut self, batch: AcceptedPrefixBatch) -> Result<(), DeliveryError> {
        self.0.push(batch);
        Ok(())
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
        segment_chars: 10,
        window_chars: 10,
        window_segments: 1,
        context_segments: 1,
        ..Default::default()
    }
}
fn response(v: Value) -> ModelResponse {
    ModelResponse {
        text: v.to_string(),
        truncated: false,
        usage: TokenUsage {
            input: Some(2),
            output: Some(3),
            reasoning: None,
        },
    }
}
fn narration(request: ModelRequest) -> Result<ModelResponse, ModelError> {
    let p: Value = serde_json::from_str(&request.user).unwrap();
    Ok(response(
        json!({"characters":[],"segments":p["target_ids"].as_array().unwrap().iter().map(|id|json!({"segment_id":id,"kind":"narration","attribution":null})).collect::<Vec<_>>() }),
    ))
}
fn identities(request: ModelRequest) -> Result<ModelResponse, ModelError> {
    let p: Value = serde_json::from_str(&request.user).unwrap();
    // Synthetic fixture policy; names are never used as identity keys.
    let target = p["segments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["target"] == true)
        .unwrap();
    let existing = p["characters"].as_array().unwrap();
    let fresh = existing.is_empty();
    let mut people = vec![];
    if fresh {
        for id in ["a", "b"] {
            people.push(json!({"temp_id":id,"display_name":"同名","aliases":[],"evidence_segment_ids":[target["id"]]}));
        }
    }
    let id = if fresh {
        json!({"scope":"new","id":"a"})
    } else {
        json!({"scope":"existing","id":existing[usize::from(target["text"] == "乙。")]["id"]})
    };
    Ok(response(
        json!({"characters":people,"segments":[{"segment_id":target["id"],"kind":"speech","attribution":{"status":"resolved","character":id,"evidence_segment_ids":[target["id"]]}}]}),
    ))
}

#[tokio::test]
async fn continuous_prefixes_match_whole_analysis_for_unicode_whitespace_and_empty_sources() {
    let model = Model(narration);
    for text in ["", "\u{3000}\t\r\n", "甲。乙。🙂e\u{301}。"] {
        let mut consumer = Collect::default();
        let whole = analyze_chapter(&model, input(text), &options(), &CancellationToken::new())
            .await
            .unwrap();
        let incremental = analyze_chapter_incremental(
            &model,
            input(text),
            &options(),
            &CancellationToken::new(),
            "execution",
            &mut consumer,
        )
        .await
        .unwrap();
        assert_eq!(
            serde_json::to_value(whole.book.registry()).unwrap(),
            serde_json::to_value(incremental.result.book.registry()).unwrap()
        );
        assert_eq!(
            whole.book.chapters()[0].annotations(),
            incremental.result.book.chapters()[0].annotations()
        );
        let source = input(text).source;
        let validator =
            jsonschema::validator_for(&serde_json::to_value(accepted_prefix_schema()).unwrap())
                .unwrap();
        let mut cursor = 0;
        let mut reconstructed = String::new();
        for (i, b) in consumer.0.iter().enumerate() {
            assert_eq!(b.sequence(), i + 1);
            assert_eq!(b.range().start, cursor);
            assert_eq!(b.source_sha256(), source.metadata().sha256);
            assert_eq!(b.run_id(), incremental.delivery.run_id().unwrap());
            assert_eq!(b.base_revision(), 1);
            validator
                .validate(&serde_json::to_value(b).unwrap())
                .unwrap();
            for s in b.segments() {
                reconstructed.push_str(&source.text()[s.start..s.end]);
            }
            cursor = b.range().end;
        }
        assert_eq!(reconstructed, source.text());
        assert_eq!(incremental.delivery.confirmed_end(), source.text().len());
        assert!(incremental.delivery.offered_end().is_none());
        assert_eq!(incremental.result.stats.requests, whole.stats.requests);
    }
}

#[tokio::test]
async fn new_same_name_identities_are_resolvable_before_reuse_without_rewriting_batches() {
    let mut consumer = Collect::default();
    let result = analyze_chapter_incremental(
        &Model(identities),
        input("甲。乙。丙。"),
        &options(),
        &CancellationToken::new(),
        "aba",
        &mut consumer,
    )
    .await
    .unwrap();
    let ids: Vec<_> = consumer
        .0
        .iter()
        .map(|b| {
            let Some(Attribution::Resolved { character_id, .. }) = &b.segments()[0].attribution
            else {
                panic!("resolved");
            };
            assert!(b.characters().iter().any(|c| &c.id == character_id));
            character_id.clone()
        })
        .collect();
    assert_eq!(ids[0], ids[2]);
    assert_ne!(ids[0], ids[1]);
    assert_eq!(result.result.book.registry().characters.len(), 2);
    assert!(
        result
            .result
            .book
            .registry()
            .characters
            .iter()
            .all(|c| c.display_name == "同名")
    );
    assert_eq!(
        consumer.0[0].segments()[0],
        result.result.book.chapters()[0].annotations().segments[0]
    );
}

#[tokio::test]
async fn future_identity_and_attribution_evidence_delay_delivery_until_accepted() {
    let calls = AtomicUsize::new(0);
    let model = Model(|request: ModelRequest| {
        let p: Value = serde_json::from_str(&request.user).unwrap();
        let first = calls.fetch_add(1, Ordering::SeqCst) == 0;
        let target = p["segments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["target"] == true)
            .unwrap();
        if !first {
            return narration(request);
        }
        let future = p["segments"].as_array().unwrap().last().unwrap();
        Ok(response(
            json!({"characters":[{"temp_id":"a","display_name":"甲","aliases":[],"evidence_segment_ids":[future["id"]]}],"segments":[{"segment_id":target["id"],"kind":"speech","attribution":{"status":"resolved","character":{"scope":"new","id":"a"},"evidence_segment_ids":[future["id"]]}}]}),
        ))
    });
    struct Observe<'a> {
        calls: &'a AtomicUsize,
        received: Vec<AcceptedPrefixBatch>,
    }
    impl AnalysisConsumer for Observe<'_> {
        async fn accept(&mut self, b: AcceptedPrefixBatch) -> Result<(), DeliveryError> {
            assert!(self.calls.load(Ordering::SeqCst) >= 2);
            self.received.push(b);
            Ok(())
        }
    }
    let mut consumer = Observe {
        calls: &calls,
        received: vec![],
    };
    let result = analyze_chapter_incremental(
        &model,
        input("甲。乙。丙。"),
        &options(),
        &CancellationToken::new(),
        "future",
        &mut consumer,
    )
    .await
    .unwrap();
    assert_eq!(consumer.received[0].segments().len(), 2);
    assert_eq!(consumer.received.len(), 2);
    assert_eq!(result.delivery.confirmed_end(), 18);
}

#[tokio::test]
async fn repair_candidates_never_escape_and_later_failure_preserves_prefix_and_statistics() {
    let calls = AtomicUsize::new(0);
    let model = Model(
        |request: ModelRequest| match calls.fetch_add(1, Ordering::SeqCst) {
            0 => Ok(ModelResponse {
                text: "private invalid response".into(),
                truncated: false,
                usage: Default::default(),
            }),
            1 => narration(request),
            _ => Err(ModelError::Transport),
        },
    );
    let mut consumer = Collect::default();
    let failure = analyze_chapter_incremental(
        &model,
        input("甲。乙。"),
        &options(),
        &CancellationToken::new(),
        "failure",
        &mut consumer,
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(
        failure.error(),
        AnalysisError::Model(ModelError::Transport)
    ));
    assert_eq!(consumer.0.len(), 1);
    assert_eq!(failure.delivery().confirmed_end(), 6);
    assert_eq!(failure.stats().unwrap().requests, 2);
    assert_eq!(failure.stats().unwrap().repair_requests, 1);
    assert_eq!(failure.diagnostics().unwrap().accepted_windows(), 1);
    assert!(failure.delivery().offered_end().is_none());
    assert!(
        !serde_json::to_string(failure.diagnostics().unwrap())
            .unwrap()
            .contains("private invalid response")
    );
}

#[tokio::test]
async fn consumer_errors_stop_model_calls_and_preserve_unacknowledged_offer() {
    struct Reject(DeliveryError);
    impl AnalysisConsumer for Reject {
        async fn accept(&mut self, _: AcceptedPrefixBatch) -> Result<(), DeliveryError> {
            Err(self.0)
        }
    }
    for error in [DeliveryError::Closed, DeliveryError::Rejected] {
        let calls = AtomicUsize::new(0);
        let model = Model(|request| {
            calls.fetch_add(1, Ordering::SeqCst);
            narration(request)
        });
        let failure = analyze_chapter_incremental(
            &model,
            input("甲。乙。"),
            &options(),
            &CancellationToken::new(),
            "rejected",
            &mut Reject(error),
        )
        .await
        .err()
        .unwrap();
        assert!(matches!(failure.error(),AnalysisError::Delivery(e) if *e==error));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(failure.delivery().confirmed_end(), 0);
        assert_eq!(failure.delivery().offered_end(), Some(6));
        assert_eq!(failure.stats().unwrap().requests, 1);
    }
}

struct Block {
    cancel: Option<CancellationToken>,
}
impl AnalysisConsumer for Block {
    async fn accept(&mut self, _: AcceptedPrefixBatch) -> Result<(), DeliveryError> {
        if let Some(cancel) = &self.cancel {
            cancel.cancel();
        }
        pending().await
    }
}
#[tokio::test(start_paused = true)]
async fn backpressure_waits_obey_cancellation_and_chapter_deadline() {
    for cancelled in [true, false] {
        let cancel = CancellationToken::new();
        let mut consumer = Block {
            cancel: cancelled.then(|| cancel.clone()),
        };
        let mut opts = options();
        opts.chapter_timeout = Duration::from_millis(10);
        let failure = analyze_chapter_incremental(
            &Model(narration),
            input("甲。乙。"),
            &opts,
            &cancel,
            "slow",
            &mut consumer,
        )
        .await
        .err()
        .unwrap();
        if cancelled {
            assert!(matches!(failure.error(), AnalysisError::Cancelled));
        } else {
            assert!(matches!(failure.error(), AnalysisError::ChapterTimeout));
        }
        assert_eq!(failure.delivery().confirmed_batches(), 0);
        assert_eq!(failure.delivery().offered_end(), Some(6));
        assert_eq!(failure.stats().unwrap().requests, 1);
    }
}

#[tokio::test]
async fn acknowledged_side_effect_is_retained_when_consumer_cancels_before_return() {
    struct Cancel(CancellationToken);
    impl AnalysisConsumer for Cancel {
        async fn accept(&mut self, _: AcceptedPrefixBatch) -> Result<(), DeliveryError> {
            self.0.cancel();
            Ok(())
        }
    }
    let cancel = CancellationToken::new();
    let failure = analyze_chapter_incremental(
        &Model(narration),
        input("甲。乙。"),
        &options(),
        &cancel,
        "cancel-after-ack",
        &mut Cancel(cancel.clone()),
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(failure.error(), AnalysisError::Cancelled));
    assert_eq!(failure.delivery().confirmed_end(), 6);
    assert!(failure.delivery().offered_end().is_none());
}

#[tokio::test]
async fn final_validation_failure_never_becomes_success_even_after_full_prefix() {
    let context = validate_book(
        CharacterRegistry {
            format_version: 1,
            book_id: BookId::new("book").unwrap(),
            revision: u64::MAX,
            characters: vec![],
            extensions: Default::default(),
        },
        vec![],
    )
    .unwrap();
    let mut request = input("甲。");
    request.context = Some(&context);
    let mut consumer = Collect::default();
    let failure = analyze_chapter_incremental(
        &Model(identities),
        request,
        &options(),
        &CancellationToken::new(),
        "overflow",
        &mut consumer,
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(
        failure.error(),
        AnalysisError::Context("revision overflow")
    ));
    assert_eq!(failure.delivery().confirmed_end(), 6);
    assert_eq!(
        failure.diagnostics().unwrap().stage(),
        AnalysisStage::FinalValidation
    );
    assert!(failure.diagnostics().unwrap().window().is_none());
    assert_eq!(context.registry().characters.len(), 0);
}

#[tokio::test]
async fn execution_keys_configuration_and_source_changes_isolate_attempts() {
    let mut ids = vec![];
    for (key, text, chars) in [
        ("first", "甲。", 10),
        ("retry", "甲。", 10),
        ("first", "乙。", 10),
        ("first", "甲。", 9),
    ] {
        let mut opts = options();
        opts.segment_chars = chars;
        let result = analyze_chapter_incremental(
            &Model(narration),
            input(text),
            &opts,
            &CancellationToken::new(),
            key,
            &mut Collect::default(),
        )
        .await
        .unwrap();
        ids.push(result.delivery.run_id().unwrap().clone());
    }
    for i in 0..ids.len() {
        for j in i + 1..ids.len() {
            assert_ne!(ids[i], ids[j]);
        }
    }
    let failure = analyze_chapter_incremental(
        &Model(narration),
        input("甲。"),
        &options(),
        &CancellationToken::new(),
        " ",
        &mut Collect::default(),
    )
    .await
    .err()
    .unwrap();
    assert!(failure.delivery().run_id().is_none());
    assert_eq!(failure.stats().unwrap().requests, 0);
}

#[tokio::test]
async fn book_revision_checks_and_protected_reanalysis_share_incremental_execution() {
    let state = BookState::new(BookId::new("book").unwrap()).unwrap();
    let request = || BookAnalysisInput {
        chapter_id: ChapterId::new("chapter").unwrap(),
        source: SourceSnapshot::import("甲。乙。丙。"),
        expected_revision: state.revision(),
        mode: BookAnalysisMode::Append,
    };
    let first = state
        .analyze_incremental(
            &Model(identities),
            request(),
            &options(),
            &CancellationToken::new(),
            "append",
            &mut Collect::default(),
        )
        .await
        .unwrap()
        .result
        .state;
    let ch = &first.book().chapters()[0];
    let corrected = first
        .correct(CorrectionBatch {
            book_id: BookId::new("book").unwrap(),
            expected_revision: first.revision(),
            corrections: vec![Correction::Attribution {
                chapter_id: ch.annotations().chapter_id.clone(),
                source_sha256: ch.source().metadata().sha256.clone(),
                segment_id: ch.annotations().segments[0].id.clone(),
                expression_kind: ExpressionKind::Speech,
                attribution: Some(Attribution::Unknown {
                    evidence_segment_ids: vec![],
                    review_status: ReviewStatus::Unreviewed,
                }),
            }],
        })
        .unwrap();
    let mut consumer = Collect::default();
    let before = corrected.document();
    let request = BookAnalysisInput {
        chapter_id: ChapterId::new("chapter").unwrap(),
        source: SourceSnapshot::import("甲。乙。丙。"),
        expected_revision: corrected.revision(),
        mode: BookAnalysisMode::ReanalyzeLast,
    };
    let result = corrected
        .analyze_incremental(
            &Model(identities),
            request,
            &options(),
            &CancellationToken::new(),
            "reanalysis",
            &mut consumer,
        )
        .await
        .unwrap();
    assert!(matches!(
        consumer.0[0].segments()[0].attribution,
        Some(Attribution::Unknown {
            review_status: ReviewStatus::Confirmed,
            ..
        })
    ));
    assert_eq!(
        consumer.0[0].segments()[0],
        result.result.state.book().chapters()[0]
            .annotations()
            .segments[0]
    );
    assert_eq!(corrected.document(), before);
    let failure = corrected
        .analyze_incremental(
            &Model(identities),
            BookAnalysisInput {
                chapter_id: ChapterId::new("new").unwrap(),
                source: SourceSnapshot::import("甲。"),
                expected_revision: 1,
                mode: BookAnalysisMode::Append,
            },
            &options(),
            &CancellationToken::new(),
            "stale",
            &mut Collect::default(),
        )
        .await
        .err()
        .unwrap();
    assert!(matches!(failure.error(), BookError::Revision { .. }));
    assert!(failure.delivery().run_id().is_none());
    assert!(failure.stats().is_none());
}

#[tokio::test]
async fn late_model_response_after_partial_delivery_is_counted_but_not_published() {
    let cancel = CancellationToken::new();
    let calls = AtomicUsize::new(0);
    let model = Model(|request| {
        if calls.fetch_add(1, Ordering::SeqCst) == 1 {
            cancel.cancel();
        }
        narration(request)
    });
    let mut consumer = Collect::default();
    let failure = analyze_chapter_incremental(
        &model,
        input("甲。乙。"),
        &options(),
        &cancel,
        "late",
        &mut consumer,
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(failure.error(), AnalysisError::Cancelled));
    assert_eq!(consumer.0.len(), 1);
    assert_eq!(failure.delivery().confirmed_end(), 6);
    assert_eq!(failure.stats().unwrap().requests, 2);
}

#[tokio::test]
async fn unknown_ambiguous_and_first_person_narration_remain_distinct_in_prefixes() {
    let model = Model(|request: ModelRequest| {
        let p: Value = serde_json::from_str(&request.user).unwrap();
        let target = p["segments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["target"] == true)
            .unwrap();
        let fresh = p["characters"].as_array().unwrap().is_empty();
        let people = if fresh {
            json!([
                {"temp_id":"a","display_name":"同名","aliases":[],"evidence_segment_ids":[target["id"]]},
                {"temp_id":"b","display_name":"同名","aliases":[],"evidence_segment_ids":[target["id"]]}
            ])
        } else {
            json!([])
        };
        let attribution = match target["text"].as_str().unwrap() {
            "我。" => {
                json!({"status":"resolved","character":{"scope":"new","id":"a"},"evidence_segment_ids":[target["id"]]})
            }
            "谁。" => {
                json!({"status":"ambiguous","candidates":p["characters"].as_array().unwrap().iter().map(|c|json!({"scope":"existing","id":c["id"]})).collect::<Vec<_>>(),"evidence_segment_ids":[target["id"]]})
            }
            _ => json!({"status":"unknown","evidence_segment_ids":[]}),
        };
        Ok(response(
            json!({"characters":people,"segments":[{"segment_id":target["id"],"kind":if fresh {"narration"} else {"speech"},"attribution":attribution}]}),
        ))
    });
    let mut consumer = Collect::default();
    let result = analyze_chapter_incremental(
        &model,
        input("我。谁。不明。"),
        &options(),
        &CancellationToken::new(),
        "states",
        &mut consumer,
    )
    .await
    .unwrap();
    assert_eq!(consumer.0[0].segments()[0].kind, ExpressionKind::Narration);
    assert!(matches!(
        consumer.0[0].segments()[0].attribution,
        Some(Attribution::Resolved { .. })
    ));
    assert!(matches!(
        consumer.0[1].segments()[0].attribution,
        Some(Attribution::Ambiguous { .. })
    ));
    assert!(matches!(
        consumer.0[2].segments()[0].attribution,
        Some(Attribution::Unknown { .. })
    ));
    let delivered: Vec<_> = consumer.0.iter().flat_map(|b| b.segments()).collect();
    assert_eq!(
        delivered,
        result.result.book.chapters()[0]
            .annotations()
            .segments
            .iter()
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn verified_quotation_payloads_are_preserved_and_provable_from_delivered_source() {
    let model = Model(|request: ModelRequest| {
        let p: Value = serde_json::from_str(&request.user).unwrap();
        let target = p["segments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["target"] == true)
            .unwrap();
        let fresh = p["characters"].as_array().unwrap().is_empty();
        let quotes = json!([{"segment_id":target["id"],"quote":target["text"]}]);
        let people = if fresh {
            json!([{"temp_id":"a","display_name":"甲","aliases":[],"evidence_segment_ids":[target["id"]],"evidence_quotes":quotes}])
        } else {
            json!([])
        };
        let id = if fresh {
            json!({"scope":"new","id":"a"})
        } else {
            json!({"scope":"existing","id":p["characters"][0]["id"]})
        };
        Ok(response(
            json!({"characters":people,"segments":[{"segment_id":target["id"],"kind":"speech","attribution":{"status":"resolved","character":id,"evidence_segment_ids":[target["id"]],"evidence_quotes":quotes}}]}),
        ))
    });
    let mut opts = options();
    opts.evidence_mode = EvidenceMode::VerifiedQuotes;
    let mut consumer = Collect::default();
    let result = analyze_chapter_incremental(
        &model,
        input("甲。乙。"),
        &opts,
        &CancellationToken::new(),
        "quotes",
        &mut consumer,
    )
    .await
    .unwrap();
    assert!(!consumer.0[0].characters()[0].extensions.is_empty());
    for (b, s) in consumer
        .0
        .iter()
        .zip(&result.result.book.chapters()[0].annotations().segments)
    {
        assert_eq!(&b.segments()[0], s);
        assert!(!s.extensions.is_empty());
    }
}

#[tokio::test]
async fn incremental_future_is_send_and_precancelled_calls_never_offer_a_batch() {
    fn is_send<T: Send>(_: T) {}
    let model = Model(narration);
    let mut consumer = Collect::default();
    let opts = options();
    let cancel = CancellationToken::new();
    is_send(analyze_chapter_incremental(
        &model,
        input("甲。"),
        &opts,
        &cancel,
        "send",
        &mut consumer,
    ));
    cancel.cancel();
    let failure = analyze_chapter_incremental(
        &model,
        input("甲。"),
        &opts,
        &cancel,
        "cancelled",
        &mut consumer,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(failure.delivery().confirmed_end(), 0);
    assert!(failure.delivery().offered_end().is_none());
    assert_eq!(failure.stats().unwrap().requests, 0);
    assert!(consumer.0.is_empty());
}
