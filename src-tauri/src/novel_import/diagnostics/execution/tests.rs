use super::*;
fn storage() -> (tempfile::TempDir, LocalGraphStorage) {
    let (root, state, draft) = super::super::tests::fixture();
    let model = rig_core::providers::openai::OpenAIConfig::new("unused")
        .connect(rig_reqwest::ReqwestClient::default())
        .chat("unused")
        .erase();
    let storage = LocalGraphStorage {
        context: RunContext {
            state: Arc::new(state),
            draft,
            session: "session".into(),
            run: "run".into(),
            token: CancellationToken::new(),
            workers: Arc::new(tokio::sync::Semaphore::new(1)),
            model,
        },
    };
    (root, storage)
}
struct TestNode {
    id: &'static str,
    wait: bool,
    runs: Arc<std::sync::atomic::AtomicUsize>,
    read_only: Option<std::path::PathBuf>,
}
#[async_trait::async_trait]
impl Task for TestNode {
    fn id(&self) -> &str {
        self.id
    }
    async fn run(&self, _: Context) -> graph_flow::Result<TaskResult> {
        self.runs.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        #[cfg(unix)]
        if let Some(path) = &self.read_only {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o500)).unwrap();
        }
        Ok(TaskResult::new(
            None,
            if self.wait {
                NextAction::WaitForInput
            } else {
                NextAction::Continue
            },
        ))
    }
}

#[tokio::test]
async fn single_steps_follow_conditional_edges_and_wait_without_model_requests() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    for yes in [true, false] {
        let (_root, storage) = storage();
        storage
            .save(
                Session::new_from_task("session".into(), "first")
                    .with_graph_id("chapter-splitting-v1"),
            )
            .await
            .unwrap();
        let storage = Arc::new(storage);
        let first = Arc::new(AtomicUsize::new(0));
        let selected = Arc::new(AtomicUsize::new(0));
        let other = Arc::new(AtomicUsize::new(0));
        let graph = GraphBuilder::new("chapter-splitting-v1")
            .add_task(Arc::new(TestNode {
                id: "first",
                wait: false,
                runs: first.clone(),
                read_only: None,
            }))
            .add_task(Arc::new(TestNode {
                id: "yes",
                wait: true,
                runs: if yes { selected.clone() } else { other.clone() },
                read_only: None,
            }))
            .add_task(Arc::new(TestNode {
                id: "no",
                wait: true,
                runs: if yes { other.clone() } else { selected.clone() },
                read_only: None,
            }))
            .add_conditional_edge("first", move |_| yes, "yes", "no")
            .build()
            .unwrap();
        let runner = FlowRunner::new(Arc::new(graph), storage.clone());
        assert!(matches!(
            runner.run("session").await.unwrap().status,
            ExecutionStatus::Paused { .. }
        ));
        assert_eq!(first.load(Ordering::SeqCst), 1);
        assert_eq!(selected.load(Ordering::SeqCst), 0);
        let loaded = storage.get("session").await.unwrap().unwrap();
        assert_eq!(loaded.current_task_id, if yes { "yes" } else { "no" });
        let result = runner.run("session").await.unwrap();
        assert!(!matches!(result.status, ExecutionStatus::Paused { .. }));
        assert_eq!(selected.load(Ordering::SeqCst), 1);
        assert_eq!(other.load(Ordering::SeqCst), 0);
        assert_eq!(
            storage.context.read().await.unwrap().diagnostics[0].requests,
            0
        );
        // The production review node also waits without touching the deliberately unusable model.
        let node = GraphNode {
            id: "review",
            context: storage.context.clone(),
        };
        node.run(Context::new()).await.unwrap();
    }
}

#[cfg(unix)]
#[tokio::test]
async fn node_side_effect_precedes_checkpoint_and_save_failure_keeps_old_position() {
    use std::{
        os::unix::fs::PermissionsExt,
        sync::atomic::{AtomicUsize, Ordering},
    };
    let (root, storage) = storage();
    storage
        .save(
            Session::new_from_task("session".into(), "first").with_graph_id("chapter-splitting-v1"),
        )
        .await
        .unwrap();
    let folder = root.path().join("drafts").join(&storage.context.draft);
    let storage = Arc::new(storage);
    let counter = Arc::new(AtomicUsize::new(0));
    let graph = GraphBuilder::new("chapter-splitting-v1")
        .add_task(Arc::new(TestNode {
            id: "first",
            wait: false,
            runs: counter.clone(),
            read_only: Some(folder.clone()),
        }))
        .add_task(Arc::new(TestNode {
            id: "review",
            wait: true,
            runs: counter.clone(),
            read_only: None,
        }))
        .add_edge("first", "review")
        .build()
        .unwrap();
    let result = FlowRunner::new(Arc::new(graph), storage.clone())
        .run("session")
        .await;
    std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.is_err());
    assert_eq!(counter.load(Ordering::SeqCst), 1);
    assert_eq!(
        storage
            .get("session")
            .await
            .unwrap()
            .unwrap()
            .current_task_id,
        "first"
    );
}

#[tokio::test]
async fn unknown_and_malformed_tools_are_counted_before_the_run_stops() {
    let (_root, storage) = storage();
    let hook = BudgetHook(storage.context.clone());
    for reason in [
        serde_json::json!({"reason":"unknown_tool"}),
        serde_json::json!({"reason":"malformed_arguments","error":"invalid JSON"}),
    ] {
        let event: InvalidToolCallContext = serde_json::from_value(serde_json::json!({
            "tool_name":"invented", "tool_call_id":null,"args":"{}", "available_tools":["directory"],"allowed_tools":["directory"],"tool_choice":null,"chat_history":[],"is_streaming":true,"reason":reason
        })).unwrap();
        hook.reject_invalid_tool(&event).await;
    }
    let recovered = storage.context.read().await.unwrap();
    let d = &recovered.diagnostics[0];
    assert_eq!(d.tool_calls, 2);
    assert_eq!(d.messages.last().unwrap().parts.len(), 2);
    assert_eq!(d.requests, 0);
}

#[tokio::test]
async fn prepare_rejects_incompatible_graph_or_source_without_dispatch() {
    for bad_graph in [true, false] {
        let (_root, storage) = storage();
        storage
            .context
            .state
            .update(&storage.context.draft, None, |r| {
                let d = record_mut(r, "session")?;
                if bad_graph {
                    d.graph_version = 2;
                } else {
                    d.hashes.clear();
                }
                Ok(())
            })
            .unwrap();
        let node = GraphNode {
            id: "prepare",
            context: storage.context.clone(),
        };
        assert!(node.run(Context::new()).await.is_err());
        assert_eq!(
            storage.context.read().await.unwrap().diagnostics[0].requests,
            0
        );
    }
}

#[tokio::test]
async fn cancellation_waits_for_dispatched_local_workers_before_terminal_publication() {
    let (_root, storage) = storage();
    let ctx = storage.context;
    let permit = ctx.workers.clone().acquire_owned().await.unwrap();
    ctx.token.cancel();
    let running = tokio::spawn(execute(ctx.clone()));
    tokio::task::yield_now().await;
    assert!(!running.is_finished());
    assert_eq!(
        ctx.read().await.unwrap().diagnostics[0].status,
        DiagnosticStatus::Running
    );
    drop(permit);
    running.await.unwrap();
    let record = ctx.read().await.unwrap();
    assert_eq!(record.diagnostics[0].status, DiagnosticStatus::Cancelled);
    assert_eq!(record.diagnostics[0].requests, 0);
}

#[tokio::test]
async fn graph_checkpoints_reject_stale_or_foreign_sessions() {
    let (_root, storage) = storage();
    let session =
        Session::new_from_task("session".into(), "prepare").with_graph_id("chapter-splitting-v1");
    storage.save(session.clone()).await.unwrap();
    assert_eq!(storage.get("session").await.unwrap().unwrap().version, 1);
    assert!(storage.save(session).await.is_err());
    assert!(storage.get("foreign").await.is_err());
    let mut current = storage.get("session").await.unwrap().unwrap();
    current.current_task_id = "review".into();
    storage.save(current).await.unwrap();
    assert_eq!(
        storage
            .get("session")
            .await
            .unwrap()
            .unwrap()
            .current_task_id,
        "review"
    );
    storage.context.token.cancel();
    assert!(
        storage
            .save(storage.get("session").await.unwrap().unwrap())
            .await
            .is_err()
    );
}
