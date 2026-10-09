//! Recovery at actual journal write boundaries, including validly hashed bad transitions.
use super::*;
struct Narration;
impl AnalysisModel for Narration {
    async fn generate(
        &self,
        request: crate::ModelRequest,
    ) -> Result<crate::ModelResponse, crate::ModelError> {
        let input: serde_json::Value = serde_json::from_str(&request.user).unwrap();
        let segments: Vec<_> = input["segments"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["target"] == true)
            .map(
                |s| serde_json::json!({"segment_id":s["id"],"kind":"narration","attribution":null}),
            )
            .collect();
        Ok(crate::ModelResponse {
            text: serde_json::json!({"characters":[],"segments":segments}).to_string(),
            truncated: false,
            usage: Default::default(),
        })
    }
}
fn plan() -> RunPlan {
    RunPlan {
        format_version: 1,
        base: BookState::new(crate::BookId::new("fixture").unwrap())
            .unwrap()
            .document(),
        chapters: vec![RunChapter::new(
            ChapterId::new("one").unwrap(),
            SourceSnapshot::import("原文。"),
        )],
        config: RunConfig::new(
            RunModel {
                backend: "offline".into(),
                model: "fixture".into(),
                endpoint: "none".into(),
                reasoning_effort: "off".into(),
                output_mode: "json".into(),
            },
            AnalysisOptions::default(),
            "test-1".into(),
        ),
    }
}
async fn candidate(run: &BookRun) -> Receipt {
    let chapter = &run.plan().chapters[0];
    let result = run
        .state()
        .analyze(
            &Narration,
            BookAnalysisInput {
                chapter_id: chapter.chapter_id.clone(),
                source: chapter.snapshot().unwrap(),
                expected_revision: run.state().revision(),
                mode: BookAnalysisMode::Append,
            },
            &run.plan().config.options,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    let commit = Commit {
        fingerprint: run.manifest.fingerprint.clone(),
        parent: run.parent.clone(),
        sequence: 1,
        book: result.state.document(),
        stats: result.stats,
    };
    Receipt {
        digest: digest(&commit).unwrap(),
        commit,
    }
}
#[tokio::test]
async fn recovery_at_each_publication_boundary() {
    for stage in 0..5 {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("run");
        let run = BookRun::create(&path, plan()).unwrap();
        let receipt = candidate(&run).await;
        let pending = path.join("commits/.pending-interrupted");
        fs::create_dir(&pending).unwrap();
        if stage == 1 {
            fs::write(pending.join("commit.json"), "{torn").unwrap();
        }
        if stage >= 2 {
            save(&pending.join("commit.json"), &receipt).unwrap();
            sync_dir(&pending).unwrap();
        }
        if stage >= 3 {
            fs::rename(&pending, path.join("commits/00000001")).unwrap();
        }
        if stage == 4 {
            sync_dir(&path.join("commits")).unwrap();
        }
        // Neither an in-memory update nor a separate progress write occurred.
        drop(run);
        let recovered = BookRun::open(&path).unwrap();
        assert_eq!(recovered.progress().completed, usize::from(stage >= 3));
    }
}
#[tokio::test]
async fn recomputed_digest_does_not_bypass_transition_validation() {
    for mode in [
        "parent", "sequence", "revision", "history", "chapter", "base",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("run");
        let run = BookRun::create(&path, plan()).unwrap();
        let mut receipt = candidate(&run).await;
        match mode {
            "parent" => receipt.commit.parent = "other".into(),
            "sequence" => receipt.commit.sequence = 2,
            "revision" => receipt.commit.book.registry.revision += 1,
            "history" => receipt.commit.book.changes.clear(),
            "chapter" => {
                receipt.commit.book.chapters[0].annotations.chapter_id =
                    ChapterId::new("other").unwrap()
            }
            _ => {
                receipt
                    .commit
                    .book
                    .registry
                    .extensions
                    .insert("unauthorized".into(), serde_json::json!(true));
            }
        }
        receipt.digest = digest(&receipt.commit).unwrap();
        let commit = path.join("commits/00000001");
        fs::create_dir(&commit).unwrap();
        save(&commit.join("commit.json"), &receipt).unwrap();
        drop(run);
        assert!(BookRun::open(&path).is_err(), "{mode}");
    }
}
