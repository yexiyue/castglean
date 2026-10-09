//! Provider-independent analysis invariants and failure boundaries.
use castglean_core::*;
use serde_json::{Value, json};
use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

struct Fake<F>(F);
impl<F: Fn(ModelRequest) -> Result<ModelResponse, ModelError> + Sync> AnalysisModel for Fake<F> {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        (self.0)(request)
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
fn response(value: Value) -> ModelResponse {
    ModelResponse {
        text: value.to_string(),
        truncated: false,
        usage: TokenUsage::default(),
    }
}
fn blank(request: &ModelRequest) -> Value {
    let payload: Value = serde_json::from_str(&request.user).unwrap();
    json!({"characters":[], "segments": payload["segments"].as_array().unwrap().iter().filter(|s| s["target"] == true).map(|s| json!({"segment_id":s["id"],"kind":"narration","attribution":null})).collect::<Vec<_>>()})
}
async fn analyze<M: AnalysisModel>(model: &M, text: &str) -> Result<AnalysisResult, AnalysisError> {
    analyze_chapter(
        model,
        input(text),
        &AnalysisOptions {
            max_repairs_per_window: 0,
            ..Default::default()
        },
        &CancellationToken::new(),
    )
    .await
}

#[test]
fn partition_is_complete_deterministic_unicode_safe_and_nonsemantic() {
    for text in [
        "",
        "张三说：“走吧。”\r\n\r\n“走吧。”猫🙂e\u{301}",
        "「嵌套『词』」",
        "  ",
        "\"a\"b",
    ] {
        let source = SourceSnapshot::import(text);
        let a = partition_source(&source, 3).unwrap();
        assert_eq!(a, partition_source(&source, 3).unwrap());
        assert_eq!(
            a.iter()
                .map(|s| &source.text()[s.start..s.end])
                .collect::<String>(),
            source.text()
        );
        let mut ids = std::collections::HashSet::new();
        for s in a {
            assert!(ids.insert(s.id));
            assert_eq!(s.kind, ExpressionKind::Narration);
            assert!(source.text()[s.start..s.end].chars().count() <= 3);
        }
    }
}

#[tokio::test]
async fn evidence_guidance_is_shared_by_initial_and_repair_requests() {
    let calls = AtomicUsize::new(0);
    let model = Fake(|request: ModelRequest| {
        assert!(request.system.contains("resolved 需要明确"));
        assert!(request.system.contains("候选各有依据"));
        assert!(request.system.contains("连续无主对白须逐句判断"));
        assert!(request.system.contains("相同 display_name"));
        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
            Ok(ModelResponse {
                text: "invalid".into(),
                truncated: false,
                usage: TokenUsage::default(),
            })
        } else {
            assert!(request.user.contains("invalid_json"));
            Ok(response(blank(&request)))
        }
    });
    let result = analyze_chapter(
        &model,
        input("公开场景"),
        &AnalysisOptions::default(),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(result.stats.requests, 2);
    assert_eq!(ANALYSIS_PROMPT_VERSION, 9);
}

#[tokio::test]
async fn json_syntax_and_suggestion_structure_have_safe_distinct_errors() {
    for (text, category) in [
        ("{\"private\":", "invalid JSON syntax"),
        (
            "{\"private\":\"novel-secret\"}",
            "invalid suggestion structure",
        ),
        (
            "{\"characters\":[],\"segments\":\"novel-secret\"}",
            "invalid suggestion structure",
        ),
        (
            "{\"characters\":[],\"characters\":[],\"segments\":[]}",
            "invalid suggestion structure",
        ),
    ] {
        let model = Fake(|_| {
            Ok(ModelResponse {
                text: text.into(),
                truncated: false,
                usage: TokenUsage::default(),
            })
        });
        let error = analyze(&model, "正文").await.err().unwrap();
        assert!(matches!(error, AnalysisError::Suggestion(message) if message == category));
        assert!(!error.to_string().contains("novel-secret"));
    }
}
#[test]
fn suggestion_schema_tracks_structural_variants() {
    let schema = analysis_suggestion_schema().to_value();
    let validator = jsonschema::validator_for(&schema).unwrap();
    for attribution in [
        json!(null),
        json!({"status":"unknown","evidence_segment_ids":[]}),
        json!({"status":"resolved","character":{"scope":"new","id":"temp"},"evidence_segment_ids":["segment"]}),
        json!({"status":"ambiguous","candidates":[{"scope":"existing","id":"a"},{"scope":"new","id":"b"}],"evidence_segment_ids":["segment"]}),
    ] {
        let value = json!({"characters":[],"segments":[{"segment_id":"segment","kind":"speech","attribution":attribution}]});
        assert!(validator.is_valid(&value));
        assert!(serde_json::from_value::<AnalysisSuggestion>(value.clone()).is_ok());
        let mut invalid = value;
        invalid["segments"][0]["kind"] = json!("private-invalid");
        assert!(!validator.is_valid(&invalid));
        assert!(serde_json::from_value::<AnalysisSuggestion>(invalid).is_err());
    }
}
#[tokio::test]
async fn empty_chapter_never_calls_model() {
    let result = analyze(&Fake(|_| panic!("empty source must not call")), "")
        .await
        .unwrap();
    assert_eq!(result.stats.requests, 0);
}

#[test]
fn partition_keeps_closing_quotes_and_splits_thought_cues() {
    let source = SourceSnapshot::import("张三说：“走吧。”心想：回家。\n");
    let segments = partition_source(&source, 160).unwrap();
    let text: Vec<_> = segments
        .iter()
        .map(|s| &source.text()[s.start..s.end])
        .collect();
    assert_eq!(text, ["张三说：", "“走吧。”", "心想：", "回家。", "\n"]);
}
#[tokio::test]
async fn unknown_stays_unknown_and_no_fabricated_narrator() {
    let model = Fake(|request| {
        let mut value = blank(&request);
        for segment in value["segments"].as_array_mut().unwrap() {
            segment["kind"] = json!("speech");
            segment["attribution"] = json!({"status":"unknown","evidence_segment_ids":[]});
        }
        Ok(response(value))
    });
    let result = analyze(&model, "“有人吗？”").await.unwrap();
    assert!(result.book.registry().characters.is_empty());
    assert!(
        result.book.chapters()[0]
            .annotations()
            .segments
            .iter()
            .all(|s| matches!(
                s.attribution,
                Some(Attribution::Unknown {
                    review_status: ReviewStatus::Unreviewed,
                    ..
                })
            ))
    );
}
#[tokio::test]
async fn accepted_characters_enter_next_window_without_name_merging() {
    let calls = AtomicUsize::new(0);
    let model = Fake(|request| {
        let mut value = blank(&request);
        let payload: Value = serde_json::from_str(&request.user).unwrap();
        let first = value["segments"][0]["segment_id"].clone();
        let reference = if calls.fetch_add(1, Ordering::SeqCst) == 0 {
            value["characters"] = json!([
                {"temp_id":"a","display_name":"老张","aliases":[],"evidence_segment_ids":[first]},
                {"temp_id":"b","display_name":"老张","aliases":[],"evidence_segment_ids":[first]}
            ]);
            json!({"scope":"new","id":"a"})
        } else {
            assert_eq!(payload["characters"].as_array().unwrap().len(), 2);
            json!({"scope":"existing","id":payload["characters"][0]["id"]})
        };
        for s in value["segments"].as_array_mut().unwrap() {
            s["kind"] = json!("speech");
            s["attribution"] =
                json!({"status":"resolved","character":reference,"evidence_segment_ids":[first]});
        }
        Ok(response(value))
    });
    let options = AnalysisOptions {
        segment_chars: 3,
        window_chars: 3,
        ..Default::default()
    };
    let result = analyze_chapter(
        &model,
        input("老张说话。老张点头。"),
        &options,
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert!(result.stats.requests > 1);
    assert_eq!(result.book.registry().characters.len(), 2);
    assert_ne!(
        result.book.registry().characters[0].id,
        result.book.registry().characters[1].id
    );
}
#[tokio::test]
async fn invalid_suggestions_never_succeed() {
    for mode in 0..9 {
        let model = Fake(|request| {
            let mut value = blank(&request);
            match mode {
                0 => {
                    value["segments"] = json!([]);
                }
                1 => {
                    let s = value["segments"][0].clone();
                    value["segments"].as_array_mut().unwrap().push(s);
                }
                2 => {
                    value["segments"][0]["start"] = json!(0);
                }
                3 => {
                    value["segments"][0]["segment_id"] = json!("outside");
                }
                4 => {
                    value["segments"][0]["kind"] = json!("speech");
                }
                5 => {
                    value["segments"][0]["attribution"] = json!({"status":"resolved","character":{"scope":"existing","id":"ghost"},"evidence_segment_ids":[value["segments"][0]["segment_id"]]});
                }
                6 => {
                    value["segments"][0]["attribution"] =
                        json!({"status":"unknown","evidence_segment_ids":["ghost"]});
                }
                7 => {
                    value["characters"] = json!([{"temp_id":"a","display_name":"张三","aliases":[],"evidence_segment_ids":[]}]);
                }
                _ => {
                    return Ok(ModelResponse {
                        text: "private invalid output".into(),
                        truncated: false,
                        usage: Default::default(),
                    });
                }
            }
            Ok(response(value))
        });
        assert!(
            matches!(
                analyze(&model, "张三说话。").await,
                Err(AnalysisError::Suggestion(_))
            ),
            "mode={mode}"
        );
    }
}
#[tokio::test]
async fn ambiguous_requires_distinct_candidates() {
    for duplicate in [false, true] {
        let model = Fake(|request| {
            let mut v = blank(&request);
            let evidence = v["segments"][0]["segment_id"].clone();
            v["characters"] = json!([
                {"temp_id":"a","display_name":"老张","aliases":[],"evidence_segment_ids":[evidence]},
                {"temp_id":"b","display_name":"老张","aliases":[],"evidence_segment_ids":[evidence]}
            ]);
            v["segments"][0]["kind"] = json!("speech");
            v["segments"][0]["attribution"] = json!({"status":"ambiguous","candidates":[{"scope":"new","id":"a"},{"scope":"new","id":if duplicate {"a"} else {"b"}}],"evidence_segment_ids":[evidence]});
            Ok(response(v))
        });
        assert_eq!(analyze(&model, "谁说的。").await.is_ok(), !duplicate);
    }
}
struct Never;
impl AnalysisModel for Never {
    async fn generate(&self, _: ModelRequest) -> Result<ModelResponse, ModelError> {
        std::future::pending().await
    }
}
#[tokio::test(start_paused = true)]
async fn timeout_and_cancel_are_explicit() {
    let options = AnalysisOptions {
        request_timeout: Duration::from_millis(10),
        ..Default::default()
    };
    assert!(matches!(
        analyze_chapter(&Never, input("正文"), &options, &CancellationToken::new()).await,
        Err(AnalysisError::Timeout)
    ));
    let cancel = CancellationToken::new();
    let clone = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1)).await;
        clone.cancel();
    });
    assert!(matches!(
        analyze_chapter(&Never, input("正文"), &options, &cancel).await,
        Err(AnalysisError::Cancelled)
    ));
}
#[tokio::test]
async fn cancellation_wins_over_ready_late_result() {
    let cancel = CancellationToken::new();
    let model = Fake(|r| {
        cancel.cancel();
        Ok(response(blank(&r)))
    });
    assert!(matches!(
        analyze_chapter(&model, input("正文"), &Default::default(), &cancel).await,
        Err(AnalysisError::Cancelled)
    ));
}
#[tokio::test]
async fn budget_checked_before_calls_and_output_truncation_rejected() {
    let options = AnalysisOptions {
        segment_chars: 1,
        window_chars: 1,
        max_requests: 1,
        ..Default::default()
    };
    assert!(matches!(
        analyze_chapter(
            &Fake(|_| panic!("budget must preflight")),
            input("两个"),
            &options,
            &CancellationToken::new()
        )
        .await,
        Err(AnalysisError::Budget(_))
    ));
    let model = Fake(|r| {
        let mut res = response(blank(&r));
        res.truncated = true;
        Ok(res)
    });
    assert!(matches!(
        analyze(&model, "正文").await,
        Err(AnalysisError::Suggestion("truncated response"))
    ));
    let options = AnalysisOptions {
        max_input_bytes: 1,
        ..Default::default()
    };
    assert!(matches!(
        analyze_chapter(
            &Fake(|_| panic!("input budget")),
            input("正文"),
            &options,
            &CancellationToken::new()
        )
        .await,
        Err(AnalysisError::Budget(_))
    ));
    let options = AnalysisOptions {
        max_response_bytes: 1,
        ..Default::default()
    };
    assert!(matches!(
        analyze_chapter(
            &Fake(|r| Ok(response(blank(&r)))),
            input("正文"),
            &options,
            &CancellationToken::new()
        )
        .await,
        Err(AnalysisError::Budget(_))
    ));
}
#[tokio::test]
async fn context_preserves_human_records_and_rejects_reanalysis() {
    let model = Fake(|r| Ok(response(blank(&r))));
    let first = analyze(&model, "正文").await.unwrap();
    let result = analyze_chapter(
        &model,
        AnalysisInput {
            chapter_id: ChapterId::new("new").unwrap(),
            context: Some(&first.book),
            ..input("新章")
        },
        &Default::default(),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(
        result.book.chapters()[0].annotations(),
        first.book.chapters()[0].annotations()
    );
    assert!(matches!(
        analyze_chapter(
            &model,
            AnalysisInput {
                context: Some(&first.book),
                ..input("改写")
            },
            &Default::default(),
            &CancellationToken::new()
        )
        .await,
        Err(AnalysisError::Context(_))
    ));
}
#[tokio::test]
async fn malformed_output_error_does_not_echo_private_content() {
    let model = Fake(|_| {
        Ok(ModelResponse {
            text: "secret-novel-text".into(),
            truncated: false,
            usage: Default::default(),
        })
    });
    let error = match analyze(&model, "正文").await {
        Err(e) => e,
        Ok(_) => panic!("must fail"),
    };
    assert!(!format!("{error:?} {error}").contains("secret-novel-text"));
}

#[tokio::test]
async fn new_context_candidate_rebinds_revision_without_overwriting_corrections() {
    let discovery = Fake(|request| {
        let mut value = blank(&request);
        let evidence = value["segments"][0]["segment_id"].clone();
        value["characters"] = json!([{"temp_id":"a","display_name":"张三","aliases":[],"evidence_segment_ids":[evidence]}]);
        value["segments"][0]["kind"] = json!("speech");
        value["segments"][0]["attribution"] = json!({"status":"resolved","character":{"scope":"new","id":"a"},"evidence_segment_ids":[evidence]});
        Ok(response(value))
    });
    let first = analyze(&discovery, "张三说话。").await.unwrap();
    let mut registry = first.book.registry().clone();
    registry.characters[0].review_status = ReviewStatus::Confirmed;
    registry.characters[0].aliases = vec!["人工确认称呼".into()];
    let mut old_annotation = first.book.chapters()[0].annotations().clone();
    if let Some(Attribution::Resolved { review_status, .. }) =
        &mut old_annotation.segments[0].attribution
    {
        *review_status = ReviewStatus::Confirmed;
    }
    let context = validate_book(
        registry,
        vec![ChapterInput {
            annotations: old_annotation.clone(),
            source: first.book.chapters()[0].source().clone(),
        }],
    )
    .unwrap();
    let calls = AtomicUsize::new(0);
    let next = Fake(|request: ModelRequest| {
        let payload: Value = serde_json::from_str(&request.user).unwrap();
        assert_eq!(payload["characters"][0]["aliases"][0], "人工确认称呼");
        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
            let mut invalid = blank(&request);
            // A candidate cannot modify an existing human-confirmed record.
            invalid["characters"] =
                json!([{ "id": payload["characters"][0]["id"], "display_name": "覆盖人工姓名" }]);
            return Ok(response(invalid));
        }
        (discovery.0)(request)
    });
    let result = analyze_chapter(
        &next,
        AnalysisInput {
            chapter_id: ChapterId::new("chapter-2").unwrap(),
            context: Some(&context),
            ..input("另一个张三。")
        },
        &Default::default(),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(context.registry().revision, 1);
    assert_eq!(result.stats.repair_requests, 1);
    assert_eq!(result.stats.repaired_windows, 1);
    assert_eq!(result.book.registry().revision, 2);
    assert_eq!(result.book.registry().characters.len(), 2);
    assert_eq!(
        result.book.registry().characters[0],
        context.registry().characters[0]
    );
    old_annotation.character_revision = 2;
    assert_eq!(result.book.chapters()[0].annotations(), &old_annotation);
}

// Holding a Send future allows a host to spawn its own analysis tasks.
#[test]
fn analysis_future_is_send() {
    fn is_send(_: impl Send) {}
    let model = Fake(|r| Ok(response(blank(&r))));
    let options = AnalysisOptions::default();
    let cancel = CancellationToken::new();
    is_send(analyze_chapter(&model, input("正文"), &options, &cancel));
}

#[tokio::test]
async fn window_segment_cap_limits_response_growth() {
    let calls = AtomicUsize::new(0);
    let model = Fake(|request| {
        let value = blank(&request);
        assert!(value["segments"].as_array().unwrap().len() <= 2);
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(response(value))
    });
    let options = AnalysisOptions {
        window_segments: 2,
        ..Default::default()
    };
    let result = analyze_chapter(
        &model,
        input("甲。\n乙。\n丙。\n"),
        &options,
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(result.stats.requests, 3);
    assert_eq!(calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn detailed_failure_keeps_all_missing_targets_and_rejected_usage() {
    let calls = AtomicUsize::new(0);
    let model = Fake(|r: ModelRequest| {
        let call = calls.fetch_add(1, Ordering::SeqCst);
        if call == 0 {
            Ok(response(blank(&r)))
        } else {
            let mut response = response(json!({"characters":[],"segments":[]}));
            response.usage.input = Some(7);
            Ok(response)
        }
    });
    let options = AnalysisOptions {
        segment_chars: 1,
        window_chars: 2,
        window_segments: 2,
        context_segments: 0,
        ..Default::default()
    };
    let failure = analyze_chapter_detailed(
        &model,
        input("甲乙丙丁"),
        &options,
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(failure.error(), AnalysisError::RepairExhausted(_)));
    let d = failure.diagnostics().unwrap();
    assert_eq!(d.accepted_windows(), 1);
    assert_eq!(d.stats().requests, 3);
    assert_eq!(d.stats().repair_requests, 1);
    assert_eq!(d.stats().usage[0].input, None);
    assert_eq!(d.stats().usage[2].input, Some(7));
    let w = d.window().unwrap();
    assert_eq!(w.index(), 1);
    assert_eq!(w.missing_targets().len(), 2);
    assert!(w.repair_exhausted());
    assert_eq!(w.repairs_attempted(), 1);
    let report = serde_json::to_string(d).unwrap();
    assert!(!report.contains("甲乙丙丁"));
    assert!(report.contains("missing_target"));
    let schema = serde_json::to_value(analysis_failure_schema()).unwrap();
    jsonschema::validator_for(&schema)
        .unwrap()
        .validate(&serde_json::to_value(d).unwrap())
        .unwrap();
}
#[tokio::test]
async fn detailed_failures_preserve_preparation_zero_repair_and_truncation() {
    let model = Fake(|_: ModelRequest| Ok(response(json!({"characters":[],"segments":[]}))));
    let failure = analyze_chapter_detailed(
        &model,
        input("甲"),
        &AnalysisOptions {
            max_requests: 0,
            ..Default::default()
        },
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(
        failure.into_error(),
        AnalysisError::InvalidOptions
    ));
    let failure = analyze_chapter_detailed(
        &model,
        input("甲"),
        &AnalysisOptions {
            max_repairs_per_window: 0,
            ..Default::default()
        },
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    let d = failure.diagnostics().unwrap();
    assert_eq!(d.category(), "missing_target");
    assert_eq!(d.stats().requests, 1);
    assert_eq!(d.window().unwrap().missing_targets().len(), 1);
    assert_eq!(d.window().unwrap().repairs_attempted(), 0);
    let model = Fake(|_: ModelRequest| {
        let mut r = response(json!({}));
        r.truncated = true;
        Ok(r)
    });
    let failure = analyze_chapter_detailed(
        &model,
        input("甲"),
        &AnalysisOptions::default(),
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(failure.diagnostics().unwrap().stats().requests, 1);
    assert_eq!(
        failure.diagnostics().unwrap().category(),
        "truncated_response"
    );
}
#[tokio::test]
async fn detailed_service_and_timeout_do_not_invent_response_usage() {
    let model = Fake(|_: ModelRequest| Err(ModelError::Transport));
    let failure = analyze_chapter_detailed(
        &model,
        input("甲"),
        &AnalysisOptions::default(),
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(failure.diagnostics().unwrap().stats().requests, 0);
    assert_eq!(failure.diagnostics().unwrap().category(), "service");
    struct Slow;
    impl AnalysisModel for Slow {
        async fn generate(&self, _: ModelRequest) -> Result<ModelResponse, ModelError> {
            tokio::time::sleep(Duration::from_millis(80)).await;
            Ok(response(json!({})))
        }
    }
    for (request_ms, chapter_ms, category) in
        [(5, 100, "request_timeout"), (100, 5, "chapter_timeout")]
    {
        let failure = analyze_chapter_detailed(
            &Slow,
            input("甲"),
            &AnalysisOptions {
                request_timeout: Duration::from_millis(request_ms),
                chapter_timeout: Duration::from_millis(chapter_ms),
                ..Default::default()
            },
            &CancellationToken::new(),
        )
        .await
        .err()
        .unwrap();
        let d = failure.diagnostics().unwrap();
        assert_eq!(d.category(), category);
        assert_eq!(d.stats().requests, 0);
        assert!(d.stats().elapsed_ms >= 4);
    }
    let cancel = CancellationToken::new();
    let options = AnalysisOptions::default();
    let future = analyze_chapter_detailed(&Slow, input("甲"), &options, &cancel);
    let (_, failure) = tokio::join!(
        async {
            tokio::time::sleep(Duration::from_millis(5)).await;
            cancel.cancel();
        },
        future
    );
    assert_eq!(
        failure.err().unwrap().diagnostics().unwrap().category(),
        "cancelled"
    );
}

#[tokio::test]
async fn final_validation_stage_has_no_window_and_keeps_usage() {
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
    let model = Fake(|r: ModelRequest| {
        let mut candidate = blank(&r);
        candidate["characters"] = json!([{"temp_id":"new", "display_name":"甲", "aliases":[], "evidence_segment_ids":["s0"]}]);
        Ok(response(candidate))
    });
    let mut chapter = input("甲");
    chapter.context = Some(&context);
    let failure = analyze_chapter_detailed(
        &model,
        chapter,
        &AnalysisOptions::default(),
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    let d = failure.diagnostics().unwrap();
    assert_eq!(d.stage(), AnalysisStage::FinalValidation);
    assert!(d.window().is_none());
    assert_eq!(d.accepted_windows(), 1);
    assert_eq!(d.stats().requests, 1);
    assert!(matches!(
        failure.error(),
        AnalysisError::Context("revision overflow")
    ));
}

#[tokio::test]
async fn target_manifest_feedback_and_history_are_complete_and_safe() {
    let calls = AtomicUsize::new(0);
    let model = Fake(|r: ModelRequest| {
        let p: Value = serde_json::from_str(&r.user).unwrap();
        assert_eq!(p["target_count"], 2);
        assert_eq!(p["target_ids"], json!(["s0", "s1"]));
        let call = calls.fetch_add(1, Ordering::SeqCst);
        if call == 0 {
            Ok(response(json!({"characters":[],"segments":[]})))
        } else {
            assert_eq!(
                p["repair"]["issue"]["missing_segment_ids"],
                json!(["s0", "s1"])
            );
            Ok(response(
                json!({"characters":[],"segments":[{"segment_id":"s999","kind":"narration"}]}),
            ))
        }
    });
    let failure = analyze_chapter_detailed(
        &model,
        input("甲乙"),
        &AnalysisOptions {
            segment_chars: 1,
            window_chars: 2,
            ..Default::default()
        },
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    let d = failure.diagnostics().unwrap();
    assert_eq!(d.category(), "outside_target");
    let w = d.window().unwrap();
    assert_eq!(w.validation_issues().len(), 2);
    assert_eq!(w.validation_issues()[0].missing_segment_ids().len(), 2);
    assert_eq!(
        w.validation_issues()[1].code(),
        SuggestionIssueCode::OutsideTarget
    );
    assert!(!serde_json::to_string(d).unwrap().contains("s999"));
}
#[tokio::test]
async fn visible_context_annotation_is_rejected_even_with_valid_reference() {
    let model = Fake(|r: ModelRequest| {
        let p: Value = serde_json::from_str(&r.user).unwrap();
        if let Some(context) = p["segments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["target"] == false)
        {
            Ok(response(
                json!({"characters":[],"segments":[{"segment_id":context["id"],"kind":"narration"}]}),
            ))
        } else {
            Ok(response(blank(&r)))
        }
    });
    let failure = analyze_chapter_detailed(
        &model,
        input("甲乙"),
        &AnalysisOptions {
            segment_chars: 1,
            window_chars: 1,
            max_repairs_per_window: 0,
            ..Default::default()
        },
        &CancellationToken::new(),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(failure.diagnostics().unwrap().category(), "outside_target");
    assert_eq!(failure.diagnostics().unwrap().accepted_windows(), 0);
}

#[tokio::test]
async fn unicode_whitespace_and_mixed_source_keep_exact_complete_ranges() {
    let model = Fake(|r: ModelRequest| Ok(response(blank(&r))));
    for text in ["\u{2003} \t\r\n", "甲\n\n\u{3000} 乙"] {
        let source = SourceSnapshot::import(text);
        let expected = partition_source(&source, 160).unwrap();
        let result = analyze_chapter_detailed(
            &model,
            input(text),
            &AnalysisOptions::default(),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        let chapter = &result.book.chapters()[0];
        assert_eq!(chapter.source().text(), source.text());
        assert_eq!(chapter.annotations().segments, expected);
        assert_eq!(
            chapter.segments().map(|(_, text)| text).collect::<String>(),
            source.text()
        );
    }
}
