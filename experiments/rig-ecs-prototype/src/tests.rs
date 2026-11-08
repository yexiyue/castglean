//! Synthetic transport fixtures are authored independently from any evaluation gold.
use super::*;
use crate::{contract::*, driver::*, journal::*};
use rig_core::{
    completion::Usage as RigUsage,
    test_utils::{MockError, MockStreamEvent},
};
use serde_json::json;
use std::sync::Arc;

fn fixture() -> (Case, Script, Options) {
    let text = "甲说。乙答。风起。";
    let case = Case {
        version: 1,
        evaluation_task: "pipeline".into(),
        case_id: "controlled-lifecycle".into(),
        source: Source {
            text: text.into(),
            sha256: hash(text.as_bytes()),
        },
        review_input: None,
        characters: vec![
            Character {
                id: "c1".into(),
                name: "甲".into(),
            },
            Character {
                id: "c2".into(),
                name: "乙".into(),
            },
        ],
    };
    // Hard-coded answers describe this public transport scenario; no gold enters the mock builder.
    let outputs = [
        json!({"segments":[{"start":0,"end":9,"kind":"speech","speaker":"c1","evidence":[{"start":0,"end":9}]}]}),
        json!({"segments":[{"start":9,"end":18,"kind":"speech","speaker":"c2","evidence":[{"start":9,"end":18}]}]}),
        json!({"segments":[{"start":18,"end":27,"kind":"narration","speaker":"narrator","evidence":[{"start":18,"end":27}]}]}),
    ];
    let script = Script {
        analysis: outputs.into_iter().map(|o| events(&o)).collect(),
        review: events(
            &json!({"issues":[{"start":0,"end":9,"category":"kind","certainty":"uncertain"}]}),
        ),
        delay_ms: vec![40, 60, 80, 10],
    };
    let options = Options {
        deadline: Duration::from_secs(3),
        cancel_after: None,
        barrier: true,
        code_revision: "test-revision".into(),
        dataset_hash: "controlled-independent-cassette".into(),
        dataset_version: "controlled-1".into(),
        interrupt_after: None,
    };
    (case, script, options)
}
fn events(value: &serde_json::Value) -> Vec<MockStreamEvent> {
    vec![
        MockStreamEvent::text(value.to_string()),
        MockStreamEvent::final_response(RigUsage::new()),
    ]
}
fn path() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/test-runs")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("checkpoint.json")
}
fn execute(case: &Case, script: &Script, options: &Options, path: &std::path::Path) -> Report {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(3)
        .enable_all()
        .build()
        .unwrap();
    run(case, script, options, path, rt.handle().clone()).unwrap()
}

#[test]
fn three_actual_model_turns_overlap_and_review_does_not_adopt() {
    let (case, script, options) = fixture();
    let report = execute(&case, &script, &options, &path());
    assert_eq!(report.status, "completed", "{:?}", report.diagnostics);
    assert_eq!(report.request_count, 4);
    assert_eq!(
        report.max_concurrency, 3,
        "the barrier cannot complete with serial requests"
    );
    assert!(!report.kernel_effect_ids.is_empty());
    assert_eq!(report.review["status"], "completed");
    assert_eq!(report.review["humanReviewStatus"], "unreviewed");
    assert_eq!(
        report.segments[0].kind, "speech",
        "the review flags kind but must not rewrite it"
    );
    assert_eq!(report.review["issues"].as_array().unwrap().len(), 1);
    assert!(
        report.trace.iter().all(|s| s.usage.input_tokens.is_none()),
        "unknown token usage stays null"
    );
    let encoded = serde_json::to_string(&report).unwrap();
    assert!(!encoded.contains(&case.source.text));
    assert!(!encoded.contains("甲"));
    let review = report.trace.iter().find(|s| s.stage == "review").unwrap();
    assert!(
        report
            .trace
            .iter()
            .filter(|s| s.stage == "analysis")
            .all(|s| s.started_unix_ms + s.elapsed_ms <= review.started_unix_ms)
    );
}
#[test]
fn parent_cancel_stops_all_children_and_drops_tokio_work() {
    let (case, mut script, mut options) = fixture();
    script.delay_ms = vec![500; 4];
    options.cancel_after = Some(Duration::from_millis(50));
    let report = execute(&case, &script, &options, &path());
    assert_eq!(report.status, "cancelled");
    assert_eq!(report.request_count, 3);
    assert_eq!(report.cancelled_futures, 3);
    assert!(
        report
            .trace
            .iter()
            .filter(|s| s.stage == "analysis")
            .all(|s| s.status == "cancelled")
    );
}
#[test]
fn deadline_records_timeout_and_never_starts_review() {
    let (case, mut script, mut options) = fixture();
    script.delay_ms = vec![500; 4];
    options.deadline = Duration::from_millis(45);
    let report = execute(&case, &script, &options, &path());
    assert_eq!(report.status, "failed");
    assert_eq!(report.cancelled_futures, 3);
    assert_eq!(report.failure_kind.as_deref(), Some("timeout"));
    assert!(report.trace.iter().any(|s| s.status == "timeout"));
    assert!(!report.trace.iter().any(|s| s.stage == "review"));
}
#[test]
fn retryable_failure_is_sent_once_and_is_not_restarted_after_recovery() {
    let (case, mut script, options) = fixture();
    script.analysis[0] = vec![MockStreamEvent::Error(MockError::Stalled(
        Duration::from_secs(2),
    ))];
    let location = path();
    let report = execute(&case, &script, &options, &location);
    assert_eq!(report.status, "failed");
    assert_eq!(report.request_count, 3);
    // A new kernel on the durable checkpoint also must not resend this failure.
    let resumed = execute(&case, &script, &options, &location);
    assert_eq!(resumed.request_count, 0);
    assert_eq!(resumed.reused_subresults, 2);
}
#[test]
fn interrupted_run_reuses_two_results_and_does_not_resend_in_flight() {
    let (case, mut script, mut options) = fixture();
    script.delay_ms = vec![10, 20, 700, 10];
    options.interrupt_after = Some(2);
    let location = path();
    let report = execute(&case, &script, &options, &location);
    assert_eq!(report.status, "interrupted");
    assert!(report.trace.iter().all(|s| s.status != "running"));
    assert_eq!(report.request_count, 3);
    options.interrupt_after = None;
    let resumed = execute(&case, &script, &options, &location);
    assert_eq!(resumed.status, "interrupted");
    assert_eq!(resumed.reused_subresults, 2);
    assert_eq!(resumed.request_count, 0);
    assert!(resumed.trace.iter().all(|s| s.status != "running"));
    let persisted: Journal = serde_json::from_slice(&std::fs::read(&location).unwrap()).unwrap();
    assert_eq!(persisted.slots[2].state, State::Unknown);
    assert!(
        resumed
            .trace
            .iter()
            .any(|s| s.stage == "analysis" && s.status == "interrupted")
    );
}
#[test]
fn fully_completed_run_reopens_without_any_model_call() {
    let (case, script, options) = fixture();
    let location = path();
    let first = execute(&case, &script, &options, &location);
    let resumed = execute(&case, &script, &options, &location);
    assert_eq!(resumed.status, "completed");
    assert_eq!(resumed.request_count, 0);
    assert_eq!(resumed.segments, first.segments);
    assert_eq!(resumed.trace[0].run_id, first.trace[0].run_id);
}
#[test]
fn resumed_completed_analysis_can_run_only_unsent_review() {
    let (case, script, options) = fixture();
    let location = path();
    execute(&case, &script, &options, &location);
    let mut journal: Journal = serde_json::from_slice(&std::fs::read(&location).unwrap()).unwrap();
    journal.slots[3] = Slot::default();
    journal.save(&location).unwrap();
    let report = execute(&case, &script, &options, &location);
    assert_eq!(report.status, "completed");
    assert_eq!(report.request_count, 1);
    assert_eq!(report.reused_subresults, 3);
}
#[test]
fn configuration_source_code_and_dataset_changes_refuse_checkpoint() {
    let (case, script, options) = fixture();
    let location = path();
    execute(&case, &script, &options, &location);
    let rt = tokio::runtime::Runtime::new().unwrap();
    let mut changed = options.clone();
    changed.code_revision = "other-revision".into();
    assert!(run(&case, &script, &changed, &location, rt.handle().clone()).is_err());
    changed = options.clone();
    changed.dataset_hash = "other-dataset".into();
    assert!(run(&case, &script, &changed, &location, rt.handle().clone()).is_err());
    changed = options.clone();
    changed.dataset_version = "changed-version".into();
    assert!(run(&case, &script, &changed, &location, rt.handle().clone()).is_err());
    let mut changed_script = script.clone();
    changed_script.delay_ms[0] += 1;
    assert!(
        run(
            &case,
            &changed_script,
            &options,
            &location,
            rt.handle().clone()
        )
        .is_err()
    );
    let mut changed_case = case.clone();
    changed_case.source.text.push('！');
    changed_case.source.sha256 = hash(changed_case.source.text.as_bytes());
    assert!(
        run(
            &changed_case,
            &script,
            &options,
            &location,
            rt.handle().clone()
        )
        .is_err()
    );
}
#[test]
fn malformed_analysis_prevents_valid_delivery_and_review() {
    let (case, mut script, options) = fixture();
    script.analysis[0] = events(
        &json!({"segments":[{"start":0,"end":8,"kind":"speech","speaker":"c1","evidence":[{"start":0,"end":9}]}]}),
    );
    let report = execute(&case, &script, &options, &path());
    assert_eq!(report.status, "failed");
    assert!(report.segments.is_empty());
    assert_eq!(report.request_count, 3);
}
#[test]
fn invalid_review_reference_is_rejected_without_mutating_analysis() {
    let (case, mut script, options) = fixture();
    script.review =
        events(&json!({"issues":[{"start":1,"end":9,"category":"kind","certainty":"definite"}]}));
    let report = execute(&case, &script, &options, &path());
    assert_eq!(report.status, "failed");
    assert_eq!(report.segments[0].kind, "speech");
    assert_eq!(report.review["status"], "not_completed");
}
#[test]
fn unrecognized_id_invalid_evidence_and_utf8_boundaries_are_rejected() {
    let (case, script, _) = fixture();
    let MockStreamEvent::Text(text) = &script.analysis[0][0] else {
        panic!()
    };
    let original: Analysis = serde_json::from_str(text).unwrap();
    let mut segment = original.segments[0].clone();
    segment.speaker = "invented".into();
    assert!(
        case.validate_segments(&[segment], case.shards()[0])
            .is_err()
    );
    let mut segment = original.segments[0].clone();
    segment.evidence[0].end = 100;
    assert!(
        case.validate_segments(&[segment], case.shards()[0])
            .is_err()
    );
    let mut segment = original.segments[0].clone();
    segment.end = 8;
    assert!(
        case.validate_segments(&[segment], case.shards()[0])
            .is_err()
    );
}
#[test]
fn kernel_delivers_same_snapshot_and_never_exposes_gold_or_tools() {
    use rig_core::{
        operation::Completion,
        serve::{ErasedHandler, adapters::ModelAdapter},
        test_utils::MockCompletionModel,
    };
    let (case, _, _) = fixture();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let mut kernel = kernel::Kernel::new();
    let counters = Arc::new(kernel::Counters::default());
    let mut models = Vec::new();
    let mut agents = Vec::new();
    for range in case.shards() {
        let model = MockCompletionModel::from_stream_turns([events(&json!({"segments":[]}))]);
        let handler = ErasedHandler::new(kernel::RuntimeHandler {
            inner: ErasedHandler::new(ModelAdapter::<Completion>::new(
                "controlled-script",
                model.clone(),
            )),
            runtime: runtime.handle().clone(),
            delay: Duration::ZERO,
            counters: Arc::clone(&counters),
            barrier: None,
        });
        agents.push(
            kernel
                .launch(
                    handler,
                    ANALYSIS_PROMPT,
                    json!({"characters":case.characters,"range":range,"source":case.source.text})
                        .to_string(),
                )
                .unwrap(),
        );
        models.push(model);
    }
    let started = std::time::Instant::now();
    while models.iter().any(|m| m.request_count() == 0)
        && started.elapsed() < Duration::from_secs(3)
    {
        kernel.tick();
        std::thread::sleep(Duration::from_millis(2));
    }
    for model in models {
        let requests = model.requests();
        assert_eq!(requests.len(), 1);
        let request = &requests[0];
        assert!(request.tools.is_empty());
        assert_eq!(
            request.options.reasoning,
            Some(rig_core::completion::Reasoning::Effort(
                rig_core::completion::Effort::Low
            ))
        );
        assert!(!request.record_telemetry_content);
        let encoded = serde_json::to_value(&request.chat_history).unwrap();
        let payload = encoded.to_string();
        for character in &case.characters {
            assert!(payload.contains(&character.name));
            assert!(payload.contains(&character.id));
        }
        assert!(!payload.contains("reviewGold"));
        assert!(!payload.contains("gold"));
    }
    kernel.stop();
}
#[test]
fn review_tool_attempt_cannot_start_a_second_model_request() {
    let (case, mut script, options) = fixture();
    script.review = vec![
        MockStreamEvent::tool_call("call-evil", "publish_annotations", json!({})),
        MockStreamEvent::final_response(RigUsage::new()),
    ];
    let report = execute(&case, &script, &options, &path());
    assert_eq!(report.status, "failed");
    assert_eq!(
        report.request_count, 4,
        "one model dispatch per role, no tool-feedback loop"
    );
    assert_eq!(report.segments[0].kind, "speech");
}
#[test]
fn cached_analysis_is_validated_again_on_resume() {
    let (case, script, options) = fixture();
    let location = path();
    execute(&case, &script, &options, &location);
    let mut journal: Journal = serde_json::from_slice(&std::fs::read(&location).unwrap()).unwrap();
    journal.slots[0].analysis.as_mut().unwrap().segments[0].speaker = "forged".into();
    journal.save(&location).unwrap();
    let rt = tokio::runtime::Runtime::new().unwrap();
    assert!(run(&case, &script, &options, &location, rt.handle().clone()).is_err());
}
#[test]
fn output_paths_cannot_escape_ignored_target() {
    assert!(journal::target_path(std::path::Path::new("README.md")).is_err());
    let target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target");
    assert!(journal::target_path(&target.join("../private.json")).is_err());
    assert!(journal::target_path(&target.join("test-safe/checkpoint.json")).is_ok());
}

#[test]
fn actual_reported_usage_is_preserved_without_adding_cached_tokens() {
    let (case, mut script, options) = fixture();
    let mut usage = RigUsage::new();
    usage.input_tokens = Some(100);
    usage.output_tokens = Some(9);
    usage.cached_input_tokens = Some(20);
    usage.reasoning_tokens = Some(2);
    script.analysis[0][1] = MockStreamEvent::final_response(usage);
    let report = execute(&case, &script, &options, &path());
    let reported = report
        .trace
        .iter()
        .find(|s| s.stage == "analysis" && s.usage.input_tokens.is_some())
        .unwrap();
    assert_eq!(reported.usage.input_tokens, Some(100));
    assert_eq!(reported.usage.cached_input_tokens, Some(20));
    assert_eq!(reported.usage.reasoning_tokens, Some(2));
}
#[test]
fn checkpoint_has_single_writer_and_crash_releases_ownership() {
    let location = path();
    let owner = journal::lock(&location).unwrap();
    assert!(journal::lock(&location).is_err());
    drop(owner);
    assert!(journal::lock(&location).is_ok());
}

#[test]
fn independent_review_uses_candidate_and_only_one_agent_request() {
    let (mut case, script, options) = fixture();
    let candidate = case
        .shards()
        .into_iter()
        .map(|r| Segment {
            start: r.start,
            end: r.end,
            kind: "narration".into(),
            speaker: "narrator".into(),
            evidence: vec![r],
            candidates: vec![],
        })
        .collect();
    case.evaluation_task = "review".into();
    case.review_input = Some(Analysis {
        segments: candidate,
    });
    let report = execute(&case, &script, &options, &path());
    assert_eq!(report.status, "completed", "{:?}", report.diagnostics);
    assert_eq!(report.request_count, 1);
    assert!(!report.trace.iter().any(|s| s.stage == "analysis"));
    assert_eq!(report.segments, case.review_input.unwrap().segments);
}
#[test]
fn analysis_rejects_planted_candidate_and_invalid_review_suggestion() {
    let (mut case, mut script, options) = fixture();
    case.evaluation_task = "analysis".into();
    case.review_input = Some(Analysis { segments: vec![] });
    assert!(case.validate().is_err());
    case.review_input = None;
    script.review = events(
        &json!({"issues":[{"start":0,"end":9,"category":"speaker","certainty":"definite","suggestion":{"kind":"speech","speaker":"invented"}}]}),
    );
    let report = execute(&case, &script, &options, &path());
    assert_eq!(report.status, "failed");
    assert_eq!(report.segments[0].speaker, "c1");
}
