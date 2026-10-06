//! Bounded recovery and state isolation, with no network requests.
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
fn response(text: impl Into<String>) -> ModelResponse {
    ModelResponse {
        text: text.into(),
        truncated: false,
        usage: TokenUsage {
            input: Some(10),
            output: Some(20),
            reasoning: None,
        },
    }
}
fn payload(request: &ModelRequest) -> Value {
    serde_json::from_str(&request.user).unwrap()
}
fn valid(request: &ModelRequest) -> Value {
    json!({"characters":[],"segments":payload(request)["segments"].as_array().unwrap().iter().filter(|s| s["target"] == true).map(|s| json!({"segment_id":s["id"],"kind":"speech","attribution":{"status":"unknown","evidence_segment_ids":[]}})).collect::<Vec<_>>()})
}
async fn run<M: AnalysisModel>(
    model: &M,
    text: &str,
    options: &AnalysisOptions,
) -> Result<AnalysisResult, AnalysisError> {
    analyze_chapter(model, input(text), options, &CancellationToken::new()).await
}

#[tokio::test]
async fn valid_unknown_finishes_without_repair() {
    let result = run(
        &Fake(|r: ModelRequest| {
            assert!(payload(&r).get("repair").is_none());
            Ok(response(valid(&r).to_string()))
        }),
        "“谁？”",
        &Default::default(),
    )
    .await
    .unwrap();
    assert_eq!(result.stats.requests, 1);
    assert_eq!(result.stats.repair_requests, 0);
    assert_eq!(result.stats.repaired_windows, 0);
}

#[tokio::test]
async fn syntax_and_structure_feedback_repair_and_count_rejected_responses() {
    for (first, code) in [
        ("{\"private\":", "invalid_json"),
        ("{\"private-secret\":1}", "invalid_structure"),
    ] {
        let calls = AtomicUsize::new(0);
        let model = Fake(|r: ModelRequest| {
            if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                return Ok(response(first));
            }
            let p = payload(&r);
            assert_eq!(p["repair"]["issue"]["code"], code);
            assert_eq!(p["repair"]["previous_candidate"], first);
            assert!(!p["repair"]["issue"].to_string().contains("private"));
            Ok(response(valid(&r).to_string()))
        });
        let result = run(&model, "正文", &Default::default()).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(result.stats.requests, 2);
        assert_eq!(result.stats.usage.len(), 2);
        assert_eq!(result.stats.response_bytes[0], first.len());
        assert_eq!(result.stats.repair_requests, 1);
        assert_eq!(result.stats.repaired_windows, 1);
    }
}

#[tokio::test]
async fn rejected_identity_never_enters_formal_context() {
    let calls = AtomicUsize::new(0);
    let model = Fake(|r: ModelRequest| {
        let mut v = valid(&r);
        let p = payload(&r);
        assert!(p["characters"].as_array().unwrap().is_empty());
        let n = calls.fetch_add(1, Ordering::SeqCst);
        if n == 0 {
            let id = v["segments"][0]["segment_id"].clone();
            v["characters"] = json!([{"temp_id":"discarded","display_name":"失败候选角色","aliases":[],"evidence_segment_ids":[id]}]);
            v["segments"][0]["attribution"] = json!({"status":"resolved","character":{"scope":"new","id":"undeclared-private"},"evidence_segment_ids":[id]});
        } else if n == 1 {
            assert_eq!(p["repair"]["issue"]["code"], "undeclared_identity");
            assert_eq!(p["repair"]["issue"]["path"], "/segments/0/attribution");
            assert_eq!(
                p["repair"]["issue"]["segment_id"],
                v["segments"][0]["segment_id"]
            );
            assert!(
                !p["repair"]["issue"]
                    .to_string()
                    .contains("undeclared-private")
            );
        } else {
            assert!(p.get("repair").is_none());
        }
        Ok(response(v.to_string()))
    });
    let options = AnalysisOptions {
        segment_chars: 1,
        window_chars: 1,
        max_requests: 3,
        ..Default::default()
    };
    let result = run(&model, "两字", &options).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    assert!(result.book.registry().characters.is_empty());
    let chapter = &result.book.chapters()[0];
    assert_eq!(chapter.source().text(), "两字");
    assert_eq!(
        chapter.annotations().source.sha256,
        input("两字").source.metadata().sha256
    );
    assert_eq!(
        chapter
            .annotations()
            .segments
            .iter()
            .map(|s| (s.start, s.end))
            .collect::<Vec<_>>(),
        [(0, 3), (3, 6)]
    );
}

#[tokio::test]
async fn exhausted_and_disabled_repair_are_bounded_and_redacted() {
    for repairs in [0, 1, 2] {
        let calls = AtomicUsize::new(0);
        let model = Fake(|_| {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(response("private-secret-invalid"))
        });
        let error = run(
            &model,
            "正文",
            &AnalysisOptions {
                max_repairs_per_window: repairs,
                ..Default::default()
            },
        )
        .await
        .err()
        .unwrap();
        if repairs == 0 {
            assert!(matches!(
                error,
                AnalysisError::Suggestion("invalid JSON syntax")
            ));
        } else {
            let AnalysisError::RepairExhausted(issue) = &error else {
                panic!("{error}")
            };
            assert_eq!(issue.code(), SuggestionIssueCode::InvalidJson);
        }
        assert_eq!(calls.load(Ordering::SeqCst), repairs + 1);
        assert!(!format!("{error:?} {error}").contains("private-secret"));
    }
}

#[tokio::test]
async fn repairs_do_not_spend_later_windows_initial_requests() {
    let calls = AtomicUsize::new(0);
    let model = Fake(|_| {
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(response("bad"))
    });
    let error = run(
        &model,
        "两字",
        &AnalysisOptions {
            segment_chars: 1,
            window_chars: 1,
            max_requests: 2,
            ..Default::default()
        },
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(error, AnalysisError::Budget("request count")));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn feedback_keeps_only_latest_candidate() {
    let calls = AtomicUsize::new(0);
    let model = Fake(|r: ModelRequest| {
        let n = calls.fetch_add(1, Ordering::SeqCst);
        if n == 0 {
            return Ok(response("bad-first"));
        }
        if n == 1 {
            assert_eq!(payload(&r)["repair"]["previous_candidate"], "bad-first");
            return Ok(response("bad-second"));
        }
        assert_eq!(payload(&r)["repair"]["previous_candidate"], "bad-second");
        assert!(!r.user.contains("bad-first"));
        Ok(response(valid(&r).to_string()))
    });
    let result = run(
        &model,
        "正文",
        &AnalysisOptions {
            max_repairs_per_window: 2,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(result.stats.repair_requests, 2);
    assert_eq!(result.stats.repaired_windows, 1);
}

#[tokio::test]
async fn oversized_previous_candidate_is_omitted_but_feedback_is_required() {
    // Measure an actual first request without depending on prompt constants.
    let base_bytes = AtomicUsize::new(0);
    run(
        &Fake(|r: ModelRequest| {
            base_bytes.store(r.system.len() + r.user.len(), Ordering::SeqCst);
            Ok(response(valid(&r).to_string()))
        }),
        "正文",
        &Default::default(),
    )
    .await
    .unwrap();
    for slack in [1, 200] {
        let calls = AtomicUsize::new(0);
        let model = Fake(|r: ModelRequest| {
            if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                return Ok(response("x".repeat(10_000)));
            }
            let p = payload(&r);
            assert!(p["repair"].get("previous_candidate").is_none());
            assert_eq!(p["repair"]["issue"]["code"], "invalid_json");
            Ok(response(valid(&r).to_string()))
        });
        let options = AnalysisOptions {
            max_input_bytes: base_bytes.load(Ordering::SeqCst) + slack,
            ..Default::default()
        };
        let result = run(&model, "正文", &options).await;
        if slack == 1 {
            assert!(matches!(result, Err(AnalysisError::Budget("input bytes"))));
            assert_eq!(calls.load(Ordering::SeqCst), 1);
        } else {
            assert!(result.is_ok());
            assert_eq!(calls.load(Ordering::SeqCst), 2);
        }
    }
}

struct Slow;
impl AnalysisModel for Slow {
    async fn generate(&self, _: ModelRequest) -> Result<ModelResponse, ModelError> {
        std::future::pending().await
    }
}
#[tokio::test(start_paused = true)]
async fn chapter_deadline_wins_over_longer_request_timeout() {
    let result = run(
        &Slow,
        "正文",
        &AnalysisOptions {
            chapter_timeout: Duration::from_millis(10),
            request_timeout: Duration::from_secs(1),
            ..Default::default()
        },
    )
    .await;
    assert!(matches!(result, Err(AnalysisError::ChapterTimeout)));
}

struct Delayed;
impl AnalysisModel for Delayed {
    async fn generate(&self, r: ModelRequest) -> Result<ModelResponse, ModelError> {
        tokio::time::sleep(Duration::from_millis(6)).await;
        Ok(response(valid(&r).to_string()))
    }
}
#[tokio::test(start_paused = true)]
async fn chapter_deadline_is_shared_across_windows() {
    let result = run(
        &Delayed,
        "两字",
        &AnalysisOptions {
            segment_chars: 1,
            window_chars: 1,
            chapter_timeout: Duration::from_millis(10),
            ..Default::default()
        },
    )
    .await;
    assert!(matches!(result, Err(AnalysisError::ChapterTimeout)));
}

struct PendingRepair(AtomicUsize);
impl AnalysisModel for PendingRepair {
    async fn generate(&self, _: ModelRequest) -> Result<ModelResponse, ModelError> {
        if self.0.fetch_add(1, Ordering::SeqCst) == 0 {
            return Ok(response("bad"));
        }
        std::future::pending().await
    }
}

#[tokio::test(start_paused = true)]
async fn request_timeout_and_cancellation_apply_during_repair() {
    for cancelled in [false, true] {
        let model = PendingRepair(AtomicUsize::new(0));
        let cancel = CancellationToken::new();
        if cancelled {
            let token = cancel.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(1)).await;
                token.cancel();
            });
        }
        let options = AnalysisOptions {
            request_timeout: Duration::from_millis(10),
            ..Default::default()
        };
        let result = analyze_chapter(&model, input("正文"), &options, &cancel).await;
        if cancelled {
            assert!(matches!(result, Err(AnalysisError::Cancelled)));
        } else {
            assert!(matches!(result, Err(AnalysisError::Timeout)));
        }
        assert_eq!(model.0.load(Ordering::SeqCst), 2);
    }
}

#[tokio::test]
async fn cancellation_after_invalid_response_prevents_repair() {
    let cancel = CancellationToken::new();
    let calls = AtomicUsize::new(0);
    let model = Fake(|_| {
        calls.fetch_add(1, Ordering::SeqCst);
        cancel.cancel();
        Ok(response("bad"))
    });
    let result = analyze_chapter(&model, input("正文"), &Default::default(), &cancel).await;
    assert!(matches!(result, Err(AnalysisError::Cancelled)));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn provider_errors_truncation_and_response_limit_are_not_repaired() {
    for mode in 0..6 {
        let calls = AtomicUsize::new(0);
        let model = Fake(|_| {
            calls.fetch_add(1, Ordering::SeqCst);
            match mode {
                0 => Err(ModelError::Authentication),
                1 => Err(ModelError::Configuration),
                2 => Err(ModelError::RateLimited),
                3 => Err(ModelError::Transport),
                4 => {
                    let mut r = response("bad");
                    r.truncated = true;
                    Ok(r)
                }
                _ => Ok(response("x".repeat(300_000))),
            }
        });
        assert!(run(&model, "正文", &Default::default()).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn old_stats_default_new_fields_and_unknown_usage() {
    let stats: AnalysisStats = serde_json::from_str(
        r#"{"requests":1,"usage":[{"input":null,"output":null}],"elapsed_ms":5}"#,
    )
    .unwrap();
    assert_eq!(stats.repair_requests, 0);
    assert_eq!(stats.repaired_windows, 0);
    assert_eq!(stats.usage[0].input, None);
}
