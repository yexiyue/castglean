//! Chapter commits, corruption rejection, cancellation and configuration drift.
use castglean_core::*;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
struct Model {
    calls: AtomicUsize,
    fail: bool,
}
impl Model {
    fn new(fail: bool) -> Self {
        Self {
            calls: AtomicUsize::new(0),
            fail,
        }
    }
}
impl AnalysisModel for Model {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            return Err(ModelError::Transport);
        }
        let p: Value = serde_json::from_str(&request.user).unwrap();
        let segments: Vec<_> = p["segments"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["target"] == true)
            .map(|s| json!({"segment_id":s["id"],"kind":"narration","attribution":null}))
            .collect();
        Ok(ModelResponse {
            text: json!({"characters":[],"segments":segments}).to_string(),
            truncated: false,
            usage: TokenUsage {
                input: Some(10),
                output: None,
                reasoning: None,
            },
        })
    }
}
fn plan() -> RunPlan {
    RunPlan {
        format_version: 1,
        base: BookState::new(BookId::new("demo").unwrap())
            .unwrap()
            .document(),
        chapters: ["first", "second"]
            .into_iter()
            .map(|id| {
                RunChapter::new(
                    ChapterId::new(id).unwrap(),
                    SourceSnapshot::import("张三走过门口。\r\n"),
                )
            })
            .collect(),
        config: RunConfig::new(
            RunModel {
                backend: "offline".into(),
                model: "fixture".into(),
                endpoint: "none".into(),
                reasoning_effort: "off".into(),
                output_mode: "json".into(),
            },
            AnalysisOptions::default(),
            "fixture-1".into(),
        ),
    }
}
#[tokio::test]
async fn resume_skips_commits_and_repeated_resume_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("run");
    let plan = plan();
    let model = Model::new(false);
    let cancel = CancellationToken::new();
    let mut run = BookRun::create(&path, plan.clone()).unwrap();
    assert!(matches!(BookRun::open(&path), Err(RunError::Busy)));
    assert!(run.advance(&model, &plan.config, &cancel).await.unwrap());
    let first = run.state().document();
    drop(run);
    // Torn unpublished JSON is ignored, regardless of how far staging progressed.
    std::fs::create_dir(path.join("commits/.pending-crash")).unwrap();
    std::fs::write(
        path.join("commits/.pending-crash/commit.json"),
        "{incomplete",
    )
    .unwrap();
    let mut run = BookRun::open(&path).unwrap();
    assert_eq!(run.progress().completed, 1);
    assert_eq!(run.state().document(), first);
    assert!(run.advance(&model, &plan.config, &cancel).await.unwrap());
    assert!(!run.advance(&model, &plan.config, &cancel).await.unwrap());
    assert_eq!(model.calls.load(Ordering::SeqCst), 2);
    assert_eq!(run.progress().committed_stats[0].usage[0].output, None);
    assert!(run.progress().uncommitted_usage.is_none());
    let complete = run.state().document();
    drop(run);
    let mut run = BookRun::open(&path).unwrap();
    assert!(!run.advance(&model, &plan.config, &cancel).await.unwrap());
    assert_eq!(run.state().document(), complete);
    let mut drift = plan.config.clone();
    drift.options.max_output_tokens += 1;
    assert!(matches!(
        run.advance(&model, &drift, &cancel).await,
        Err(RunError::Configuration)
    ));
    assert_eq!(model.calls.load(Ordering::SeqCst), 2);
    assert!(BookRun::create(&path, plan).is_err());
}
#[tokio::test]
async fn failure_and_cancellation_preserve_committed_prefix() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("run");
    let plan = plan();
    let mut run = BookRun::create(&path, plan.clone()).unwrap();
    let cancel = CancellationToken::new();
    run.advance(&Model::new(false), &plan.config, &cancel)
        .await
        .unwrap();
    let before = run.state().document();
    assert!(
        run.advance(&Model::new(true), &plan.config, &cancel)
            .await
            .is_err()
    );
    cancel.cancel();
    let model = Model::new(false);
    assert!(matches!(
        run.advance(&model, &plan.config, &cancel).await,
        Err(RunError::Analysis(AnalysisError::Cancelled))
    ));
    assert_eq!(model.calls.load(Ordering::SeqCst), 0);
    assert_eq!(run.state().document(), before);
    drop(run);
    let run = BookRun::open(&path).unwrap();
    assert_eq!(run.progress().completed, 1);
    assert!(!path.join("commits/00000002").exists());
}
struct CancelModel {
    cancel: CancellationToken,
}
impl AnalysisModel for CancelModel {
    async fn generate(&self, _: ModelRequest) -> Result<ModelResponse, ModelError> {
        self.cancel.cancel();
        std::future::pending().await
    }
}
#[tokio::test]
async fn cancellation_during_call_never_publishes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("run");
    let plan = plan();
    let mut run = BookRun::create(&path, plan.clone()).unwrap();
    let cancel = CancellationToken::new();
    assert!(
        run.advance(
            &CancelModel {
                cancel: cancel.clone()
            },
            &plan.config,
            &cancel
        )
        .await
        .is_err()
    );
    assert_eq!(run.progress().completed, 0);
    drop(run);
    assert_eq!(BookRun::open(&path).unwrap().progress().completed, 0);
}
#[tokio::test]
async fn corrupt_or_missing_formal_commits_are_not_retried() {
    for mode in ["corrupt", "gap", "manifest", "missing-file"] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("run");
        let plan = plan();
        let mut run = BookRun::create(&path, plan.clone()).unwrap();
        run.advance(&Model::new(false), &plan.config, &CancellationToken::new())
            .await
            .unwrap();
        drop(run);
        match mode {
            "corrupt" => std::fs::write(path.join("commits/00000001/commit.json"), "{}").unwrap(),
            "missing-file" => {
                std::fs::remove_file(path.join("commits/00000001/commit.json")).unwrap()
            }
            "gap" => std::fs::rename(path.join("commits/00000001"), path.join("commits/00000002"))
                .unwrap(),
            _ => {
                let p = path.join("manifest.json");
                let mut data: Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
                data["plan"]["chapters"][0]["text"] = json!("changed source");
                std::fs::write(p, data.to_string()).unwrap();
            }
        }
        assert!(BookRun::open(&path).is_err());
    }
}
#[tokio::test]
async fn commit_io_failure_requires_reopen_and_never_overwrites() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("run");
    let plan = plan();
    let mut run = BookRun::create(&path, plan.clone()).unwrap();
    let destination = path.join("commits/00000001");
    std::fs::create_dir(&destination).unwrap();
    let model = Model::new(false);
    let cancel = CancellationToken::new();
    assert!(run.advance(&model, &plan.config, &cancel).await.is_err());
    assert_eq!(run.progress().completed, 0);
    assert!(!destination.join("commit.json").exists());
    assert!(matches!(
        run.advance(&model, &plan.config, &cancel).await,
        Err(RunError::Invalid("reopen after commit IO failure"))
    ));
    assert_eq!(model.calls.load(Ordering::SeqCst), 1);
    drop(run);
    // Remove only this test's deliberately introduced empty obstruction.
    std::fs::remove_dir(destination).unwrap();
    let mut run = BookRun::open(&path).unwrap();
    assert!(run.advance(&model, &plan.config, &cancel).await.unwrap());
    assert_eq!(run.progress().completed, 1);
}
#[test]
fn invalid_plans_and_fingerprints_cover_all_inputs() {
    let base = plan();
    let dir = tempfile::tempdir().unwrap();
    for change in ["source", "base", "config", "order"] {
        let mut candidate = base.clone();
        match change {
            "source" => {
                candidate.chapters[0] = RunChapter::new(
                    ChapterId::new("first").unwrap(),
                    SourceSnapshot::import("different"),
                )
            }
            "base" => candidate.base.registry.revision += 1,
            "config" => candidate.config.model.model = "other".into(),
            _ => candidate.chapters.reverse(),
        }
        assert_ne!(
            base.fingerprint().unwrap(),
            candidate.fingerprint().unwrap()
        );
    }
    for mode in [
        "duplicate",
        "bad-source",
        "version",
        "zero",
        "overflow",
        "protocol",
    ] {
        let mut bad = base.clone();
        match mode {
            "duplicate" => bad.chapters[1].chapter_id = bad.chapters[0].chapter_id.clone(),
            "bad-source" => bad.chapters[0].text.push('!'),
            "version" => bad.format_version = 2,
            "zero" => bad.config.options.max_requests = 0,
            "overflow" => bad.base.registry.revision = u64::MAX,
            _ => bad.config.prompt_version += 1,
        }
        let path = dir.path().join(mode);
        assert!(BookRun::create(&path, bad).is_err());
        assert!(!path.exists());
    }
}
#[test]
fn public_plan_and_schema_are_consistent() {
    let schema = run_plan_schema().to_value();
    assert_eq!(
        schema,
        serde_json::from_str::<Value>(include_str!("../../../schemas/run-plan.schema.json"))
            .unwrap()
    );
    let value: Value =
        serde_json::from_str(include_str!("../../../examples/run-recovery/glm-plan.json")).unwrap();
    jsonschema::validate(&schema, &value).unwrap();
    let plan: RunPlan = serde_json::from_value(value).unwrap();
    let temp = tempfile::tempdir().unwrap();
    assert_eq!(
        BookRun::create(&temp.path().join("sample"), plan)
            .unwrap()
            .progress()
            .total,
        2
    );
}
#[tokio::test]
async fn human_base_data_survives_new_run() {
    let mut plan = plan();
    let base = BookState::new(BookId::new("demo").unwrap()).unwrap();
    let base = base
        .analyze(
            &Model::new(false),
            BookAnalysisInput {
                chapter_id: ChapterId::new("old").unwrap(),
                source: SourceSnapshot::import("人工修正的正文。"),
                expected_revision: base.revision(),
                mode: BookAnalysisMode::Append,
            },
            &plan.config.options,
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .state;
    let ch = &base.document().chapters[0];
    let base = base
        .correct(CorrectionBatch {
            book_id: base.book().registry().book_id.clone(),
            expected_revision: base.revision(),
            corrections: vec![Correction::Attribution {
                chapter_id: ch.annotations.chapter_id.clone(),
                source_sha256: ch.annotations.source.sha256.clone(),
                segment_id: ch.annotations.segments[0].id.clone(),
                expression_kind: ExpressionKind::QuotedText,
                attribution: None,
            }],
        })
        .unwrap();
    plan.base = base.document();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("run");
    let mut run = BookRun::create(&path, plan.clone()).unwrap();
    run.advance(&Model::new(false), &plan.config, &CancellationToken::new())
        .await
        .unwrap();
    let before = &plan.base.chapters[0];
    let mut saved = run.state().document().chapters[0].clone();
    saved.annotations.character_revision = before.annotations.character_revision;
    assert_eq!(&saved, before);
    drop(run);
    assert_eq!(BookRun::open(&path).unwrap().progress().completed, 1);
}

#[tokio::test]
async fn detailed_run_failure_preserves_prior_receipt_and_book() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("run");
    let plan = plan();
    let mut run = BookRun::create(&path, plan.clone()).unwrap();
    assert!(
        run.advance(&Model::new(false), &plan.config, &CancellationToken::new())
            .await
            .unwrap()
    );
    let before = run.state().document();
    let receipt_path = path.join("commits/00000001/commit.json");
    let receipt = std::fs::read(&receipt_path).unwrap();
    let failure = run
        .advance_detailed(&Model::new(true), &plan.config, &CancellationToken::new())
        .await
        .unwrap_err();
    assert_eq!(failure.diagnostics().unwrap().category(), "service");
    assert_eq!(run.state().document(), before);
    assert_eq!(run.progress().completed, 1);
    assert_eq!(std::fs::read(receipt_path).unwrap(), receipt);
    assert!(!path.join("commits/00000002").exists());
    assert!(matches!(
        failure.into_error(),
        RunError::Book(BookError::Analysis(AnalysisError::Model(
            ModelError::Transport
        )))
    ));
}
