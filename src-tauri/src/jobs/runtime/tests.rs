use super::*;
use crate::{
    ai::{CreateSession, StartRun, Trigger},
    llm::test_support::{Fixture, configured},
    project::{store, test_support::fixture},
};
use sea_orm::PaginatorTrait;
use std::sync::atomic::{AtomicUsize, Ordering};

fn worker(
    runtime: Arc<Runtime>,
    queue: SqliteStorage<RunJob>,
) -> tokio::task::JoinHandle<Result<(), WorkerError>> {
    let worker = WorkerBuilder::new("fixture-worker")
        .backend(queue.poll_with_interval(Duration::from_millis(250)))
        .concurrency(2)
        .parallelize(|future| tokio::spawn(future))
        .data(runtime)
        .build(|job: RunJob, runtime: Data<Arc<Runtime>>| async move {
            if let Err(error) = runtime.handle(job).await {
                eprintln!("fixture handler failed: {error}");
            }
        });
    tokio::spawn(worker.run())
}

fn response(text: &str) -> Vec<u8> {
    let first = serde_json::json!({"id":"test","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":text},"finish_reason":null}]});
    let end = serde_json::json!({"id":"test","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]});
    format!("data: {first}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes()
}
async fn queued(db: &DatabaseConnection, config: Configuration) -> String {
    let session = ai::create_session(
        db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            task_kind: "chapter_splitting".into(),
            chapter_id: None,
            title: "分章".into(),
        },
    )
    .await
    .unwrap();
    ai::start_run(
        db,
        StartRun {
            workspace_context: None,
            session_id: session.id,
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: config,
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger: Trigger::Message {
                message: "检查目录".into(),
            },
        },
        None,
    )
    .await
    .unwrap()
    .id
}
async fn wait_terminal(db: &DatabaseConnection, id: &str) -> ai_run::Model {
    let terminal = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let row = ai_run::Entity::find_by_id(id)
                .one(db)
                .await
                .unwrap()
                .unwrap();
            if !matches!(row.status.as_str(), "queued" | "running" | "cancelling") {
                return row;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    match terminal {
        Ok(row) => row,
        Err(_) => panic!(
            "run {id} did not terminate: {:?}",
            ai_run::Entity::find_by_id(id)
                .one(db)
                .await
                .unwrap()
                .map(|r| (r.status, r.error))
        ),
    }
}

// A committed terminal state can be observed before post-commit notification and
// the handler's RAII guard return. Assert eventual release without a fixed sleep.
async fn wait_idle(runtime: &Runtime) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while !runtime.admitted.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .expect("terminal handlers must release admission");
}

#[tokio::test]
async fn sqlite_worker_dispatches_saved_intent_and_duplicate_delivery_never_calls_model_twice() {
    let calls = Arc::new(AtomicUsize::new(0));
    let wire_bytes = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let observed_bytes = wire_bytes.clone();
    let server = Fixture::raw(move |index, _, body| {
        observed.fetch_add(1, Ordering::SeqCst);
        observed_bytes.fetch_add(serde_json::to_vec(body).unwrap().len(), Ordering::SeqCst);
        let reply = if index == 0 {
            let first = serde_json::json!({"id":"test","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"candidate-call","type":"function","function":{"name":"finish_splitting","arguments":serde_json::to_string(&serde_json::json!({"plan":{"kind":"rules","rules":crate::novel_import::heading_rules()}})).unwrap()}}]},"finish_reason":null}]});
            let end = serde_json::json!({"id":"test","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]});
            format!("data: {first}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes()
        } else {
            response("完成检查")
        };
        (200, "text/event-stream", reply)
    });
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_llm_root, llm, selection, revision) = configured(&server.endpoint);
    let id = queued(
        &db,
        Configuration {
            reasoning: None,
            selection,
            revision,
        },
    )
    .await;
    assert_eq!(ai::active_tasks(&db).await.unwrap(), 1);
    super::super::setup(&db).await.unwrap();
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    let mut queue = SqliteStorage::new(db.get_sqlite_connection_pool());
    // Simulate commit-before-enqueue crash: dispatcher discovers the saved row.
    runtime.dispatch(&mut queue).await.unwrap();
    // Simulate a persisted queue delivery whose dispatch response/stamp was
    // lost. Reconciliation sends it again without losing the original intent.
    use sea_orm::sea_query::Expr;
    ai_run::Entity::update_many()
        .col_expr(ai_run::Column::DispatchAfter, Expr::value(0))
        .col_expr(ai_run::Column::DispatchedAt, Expr::value(None::<i64>))
        .filter(ai_run::Column::Id.eq(&id))
        .exec(&db)
        .await
        .unwrap();
    runtime.dispatch(&mut queue).await.unwrap();
    let task = worker(runtime.clone(), queue.clone());
    assert_eq!(wait_terminal(&db, &id).await.status, "waiting_for_input");
    wait_idle(&runtime).await;
    runtime.handle(RunJob { run_id: id.clone() }).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        crate::database::entity::split_proposal::Entity::find()
            .count(&db)
            .await
            .unwrap(),
        1
    );
    assert!(runtime.admitted.lock().unwrap().is_empty());
    assert_eq!(ai::active_tasks(&db).await.unwrap(), 0);
    let run = ai_run::Entity::find_by_id(&id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let budget: ai::budget::Ledger = serde_json::from_value(run.budget).unwrap();
    assert_eq!(budget.total().unwrap().requests, 1);
    assert_eq!(budget.total().unwrap().tool_calls, 1);
    // Wire accounting replaced the generic reservation rather than adding it.
    assert_eq!(
        budget.total().unwrap().input_bytes as usize,
        wire_bytes.load(Ordering::SeqCst)
    );
    assert_eq!(
        run.checkpoint.as_ref().unwrap()["session"]["current_task_id"],
        "review"
    );
    let next = ai::start_run(
        &db,
        StartRun {
            workspace_context: None,
            session_id: run.session_id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: serde_json::from_value(run.configuration).unwrap(),
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger: Trigger::Continue {
                run_id: id.clone(),
                message: "继续检查".into(),
            },
        },
        None,
    )
    .await
    .unwrap();
    assert_ne!(next.id, id);
    runtime
        .handle(RunJob {
            run_id: next.id.clone(),
        })
        .await
        .unwrap();
    assert_eq!(
        wait_terminal(&db, &next.id).await.status,
        "waiting_for_input"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert!(runtime.admitted.lock().unwrap().is_empty());
    let page = ai::history_page(&db, &run.session_id, None, 20)
        .await
        .unwrap();
    assert_eq!(page.session.budget.requests, 2);
    assert_eq!(page.messages.len(), 4);
    assert_eq!(
        crate::database::entity::split_proposal::Entity::find()
            .count(&db)
            .await
            .unwrap(),
        1
    );
    task.abort();
    let _ = task.await;
}

#[tokio::test]
async fn admission_keeps_busy_connection_from_consuming_second_global_slot() {
    let (root, db, _) = fixture().await;
    let (_llm_root, llm, _, _) = configured("http://127.0.0.1:1");
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db,
        root.path().into(),
        llm,
        None,
    );
    assert!(runtime.admit("one", "a").unwrap().is_some());
    assert!(runtime.admit("two", "a").unwrap().is_none());
    assert!(runtime.admit("three", "b").unwrap().is_some());
    assert!(runtime.admit("four", "c").unwrap().is_none());
    runtime.cancel("one");
    assert!(runtime.admit("one", "a").unwrap().unwrap().is_cancelled());
    runtime.release("one");
    assert!(runtime.admit("four", "c").unwrap().is_some());
}

#[tokio::test]
async fn independent_connections_overlap_while_same_connection_waits_and_failure_is_isolated() {
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let entered = Arc::new(AtomicUsize::new(0));
    let make_server = |fail_first| {
        let active = active.clone();
        let peak = peak.clone();
        let entered = entered.clone();
        Fixture::raw(move |index, _, _| {
            let count = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(count, Ordering::SeqCst);
            entered.fetch_add(1, Ordering::SeqCst);
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while entered.load(Ordering::SeqCst) < 2 && std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(2));
            }
            // Keep both requests in flight long enough to observe their overlap.
            std::thread::sleep(Duration::from_millis(50));
            active.fetch_sub(1, Ordering::SeqCst);
            if fail_first && index == 0 {
                (500, "application/json", b"{}".to_vec())
            } else {
                (200, "text/event-stream", response("检查完成"))
            }
        })
    };
    let server_a = make_server(true);
    let server_b = make_server(false);
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_llm_root, llm, a, revision_a) = configured(&server_a.endpoint);
    let (b, revision_b) = crate::llm::test_support::add_connection(&llm, &server_b.endpoint);
    let a1 = queued(
        &db,
        Configuration {
            reasoning: None,
            selection: a.clone(),
            revision: revision_a,
        },
    )
    .await;
    let a2 = queued(
        &db,
        Configuration {
            reasoning: None,
            selection: a,
            revision: revision_a,
        },
    )
    .await;
    let b1 = queued(
        &db,
        Configuration {
            reasoning: None,
            selection: b,
            revision: revision_b,
        },
    )
    .await;
    super::super::setup(&db).await.unwrap();
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    let mut queue = SqliteStorage::new(db.get_sqlite_connection_pool());
    runtime.dispatch(&mut queue).await.unwrap();
    assert_eq!(runtime.admitted.lock().unwrap().len(), 2);
    let task = worker(runtime.clone(), queue.clone());
    assert_eq!(wait_terminal(&db, &a1).await.status, "failed");
    assert_eq!(wait_terminal(&db, &b1).await.status, "waiting_for_input");
    wait_idle(&runtime).await;
    assert_eq!(peak.load(Ordering::SeqCst), 2);
    assert_eq!(entered.load(Ordering::SeqCst), 2);
    assert_eq!(
        ai_run::Entity::find_by_id(&a2)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .status,
        "queued"
    );
    runtime.dispatch(&mut queue).await.unwrap();
    assert_eq!(wait_terminal(&db, &a2).await.status, "waiting_for_input");
    wait_idle(&runtime).await;
    assert_eq!(entered.load(Ordering::SeqCst), 3);
    assert!(runtime.admitted.lock().unwrap().is_empty());
    task.abort();
    let _ = task.await;
}

#[tokio::test]
async fn running_cancel_notifies_token_and_late_network_success_cannot_reverse_terminal() {
    let entered = Arc::new(AtomicUsize::new(0));
    let observed = entered.clone();
    let release = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let gate = release.clone();
    let server = Fixture::raw(move |_, _, _| {
        observed.fetch_add(1, Ordering::SeqCst);
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while !gate.load(Ordering::SeqCst) && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(2));
        }
        (200, "text/event-stream", response("迟到结果"))
    });
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_llm_root, llm, selection, revision) = configured(&server.endpoint);
    let id = queued(
        &db,
        Configuration {
            reasoning: None,
            selection,
            revision,
        },
    )
    .await;
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    let runner = runtime.clone();
    let run_id = id.clone();
    let task = tokio::spawn(async move { runner.handle(RunJob { run_id }).await });
    tokio::time::timeout(Duration::from_secs(3), async {
        while entered.load(Ordering::SeqCst) == 0 {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        ai::runs::cancel(&db, &id).await.unwrap().status,
        RunStatus::Cancelling
    );
    runtime.cancel(&id);
    task.await.unwrap().unwrap();
    assert_eq!(wait_terminal(&db, &id).await.status, "cancelled");
    release.store(true, Ordering::SeqCst);
    runtime.handle(RunJob { run_id: id.clone() }).await.unwrap();
    assert_eq!(entered.load(Ordering::SeqCst), 1);
    assert_eq!(
        ai_run::Entity::find_by_id(id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .status,
        "cancelled"
    );
    assert!(runtime.admitted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn stopping_waits_for_blocking_tool_and_fences_its_late_publication() {
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_llm_root, llm, selection, revision) = configured("http://127.0.0.1:1");
    let id = queued(
        &db,
        Configuration {
            reasoning: None,
            selection,
            revision,
        },
    )
    .await;
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    let lease = ai::runs::claim(&db, &id, &runtime.owner.id)
        .await
        .unwrap()
        .unwrap();
    let workers = Arc::new(Semaphore::new(1));
    let held = workers.clone().acquire_owned().await.unwrap();
    ai::runs::cancel(&db, &id).await.unwrap();
    let runner = runtime.clone();
    let old_lease = lease.clone();
    let worker_db = db.clone();
    let (release, wait) = std::sync::mpsc::channel();
    let scan = tauri::async_runtime::spawn_blocking(move || {
        let _permit = held;
        wait.recv_timeout(Duration::from_secs(3)).unwrap();
        tauri::async_runtime::block_on(async move {
            let tx = worker_db.begin().await.unwrap();
            let result = ai::tools::begin(
                &tx,
                &old_lease,
                "late-assistant",
                "late-tool",
                "finish_splitting",
                serde_json::json!({"plan":{"kind":"rules","rules":[]}}),
            )
            .await;
            tx.rollback().await.unwrap();
            result
        })
    });
    let token = CancellationToken::new();
    let task = tokio::spawn(async move {
        runner
            .settle(&lease, &token, &workers, Err(RunFailure::Cancelled))
            .await
    });
    tokio::task::yield_now().await;
    assert!(!task.is_finished());
    assert_eq!(
        ai_run::Entity::find_by_id(&id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .status,
        "cancelling"
    );
    release.send(()).unwrap();
    assert_eq!(scan.await.unwrap(), Err(AiError::Conflict));
    task.await.unwrap().unwrap();
    assert_eq!(wait_terminal(&db, &id).await.status, "cancelled");
}

#[tokio::test]
async fn queued_cancel_and_config_failures_do_not_retry_and_old_quotas_allow_work() {
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let server = Fixture::raw(move |_, _, _| {
        observed.fetch_add(1, Ordering::SeqCst);
        (200, "text/event-stream", response("不应请求"))
    });
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_llm_root, llm, selection, revision) = configured(&server.endpoint);
    let config = Configuration {
        reasoning: None,
        selection,
        revision,
    };
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    let cancelled = queued(&db, config.clone()).await;
    runtime
        .admit(&cancelled, &config.selection.connection_id)
        .unwrap();
    assert_eq!(
        ai::runs::cancel(&db, &cancelled).await.unwrap().status,
        RunStatus::Cancelled
    );
    runtime.cancel(&cancelled);
    runtime
        .handle(RunJob {
            run_id: cancelled.clone(),
        })
        .await
        .unwrap();
    super::super::setup(&db).await.unwrap();
    let mut queue = SqliteStorage::new(db.get_sqlite_connection_pool());
    runtime.dispatch(&mut queue).await.unwrap();
    assert!(runtime.admitted.lock().unwrap().is_empty());
    let changed = queued(
        &db,
        Configuration {
            reasoning: None,
            revision: config.revision + 1,
            ..config.clone()
        },
    )
    .await;
    runtime
        .handle(RunJob {
            run_id: changed.clone(),
        })
        .await
        .unwrap();
    let row = wait_terminal(&db, &changed).await;
    assert_eq!(row.status, "failed");
    assert_eq!(row.error.as_deref(), Some("configuration_changed"));
    let exhausted = queued(&db, config).await;
    let row = ai_run::Entity::find_by_id(&exhausted)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let mut ledger = row.budget;
    ledger["total"]["requests"] = serde_json::json!(8);
    ledger["turnRequests"] = serde_json::json!(8);
    use sea_orm::sea_query::Expr;
    let tx = db.begin().await.unwrap();
    crate::database::entity::ai_session::Entity::update_many()
        .col_expr(
            crate::database::entity::ai_session::Column::Budget,
            Expr::value(ledger["total"].clone()),
        )
        .filter(crate::database::entity::ai_session::Column::Id.eq(&row.session_id))
        .exec(&tx)
        .await
        .unwrap();
    ai_run::Entity::update_many()
        .col_expr(ai_run::Column::Budget, Expr::value(ledger))
        .filter(ai_run::Column::Id.eq(&exhausted))
        .exec(&tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    runtime
        .handle(RunJob {
            run_id: exhausted.clone(),
        })
        .await
        .unwrap();
    let row = wait_terminal(&db, &exhausted).await;
    assert_eq!(row.status, "waiting_for_input");
    assert!(row.error.is_none());
    for id in [cancelled, changed, exhausted] {
        runtime.handle(RunJob { run_id: id }).await.unwrap();
    }
    runtime.dispatch(&mut queue).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(runtime.admitted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn old_worker_late_writes_and_orphan_redelivery_are_fenced_before_explicit_continue() {
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let release = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let gate = release.clone();
    let server = Fixture::raw(move |index, _, _| {
        observed.fetch_add(1, Ordering::SeqCst);
        if index == 0 {
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            while !gate.load(Ordering::SeqCst) && std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        (200, "text/event-stream", response("明确继续后完成"))
    });
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_llm_root, llm, selection, revision) = configured(&server.endpoint);
    let config = Configuration {
        reasoning: None,
        selection,
        revision,
    };
    let id = queued(&db, config.clone()).await;
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    super::super::setup(&db).await.unwrap();
    let mut queue = SqliteStorage::new(db.get_sqlite_connection_pool());
    runtime.dispatch(&mut queue).await.unwrap();
    let task = worker(runtime.clone(), queue.clone());
    tokio::time::timeout(Duration::from_secs(3), async {
        while calls.load(Ordering::SeqCst) == 0 {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .unwrap();
    // Equivalent to a new owner fencing a previous process. Keep the old
    // executor alive deliberately to prove its late writes cannot win.
    ai::runs::interrupt_previous(&db, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap();
    assert_eq!(wait_terminal(&db, &id).await.status, "interrupted");
    release.store(true, Ordering::SeqCst);
    wait_idle(&runtime).await;
    assert_eq!(
        ai_run::Entity::find_by_id(&id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .status,
        "interrupted"
    );
    queue
        .push_task(
            TaskBuilder::new(RunJob { run_id: id.clone() })
                .max_attempts(1)
                .build(),
        )
        .await
        .unwrap();
    let old = ai_run::Entity::find_by_id(&id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    let next = ai::start_run(
        &db,
        StartRun {
            workspace_context: None,
            session_id: old.session_id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: config,
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger: Trigger::Continue {
                run_id: id.clone(),
                message: "明确继续".into(),
            },
        },
        None,
    )
    .await
    .unwrap();
    runtime.dispatch(&mut queue).await.unwrap();
    assert_eq!(
        wait_terminal(&db, &next.id).await.status,
        "waiting_for_input"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let page = ai::history_page(&db, &old.session_id, None, 20)
        .await
        .unwrap();
    assert_eq!(page.session.budget.requests, 2);
    assert!(
        page.messages
            .iter()
            .any(|m| m.run_id.as_deref() == Some(&id) && m.status == "interrupted")
    );
    assert_eq!(
        crate::database::entity::split_proposal::Entity::find()
            .count(&db)
            .await
            .unwrap(),
        0
    );
    task.abort();
    let _ = task.await;
}

#[tokio::test]
async fn chapter_analysis_dispatches_through_sqlite_worker_once_without_a_subscriber() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = Fixture::new(move |index, _, body| {
        seen.fetch_add(1, Ordering::SeqCst);
        (200, crate::chapter_analysis::fixture_response(body, index))
    });
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_config, llm, selection, revision) = configured(&server.endpoint);
    let session = ai::create_session(
        &db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            chapter_id: Some("chapter".into()),
            task_kind: "chapter_analysis".into(),
            title: "分析".into(),
        },
    )
    .await
    .unwrap();
    let run = ai::start_analysis_run(
        &db,
        StartRun {
            workspace_context: None,
            session_id: session.id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: Configuration {
                reasoning: None,
                selection,
                revision,
            },
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger: Trigger::Message {
                message: "分析本章".into(),
            },
        },
    )
    .await
    .unwrap();
    super::super::setup(&db).await.unwrap();
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    let mut queue = SqliteStorage::new(db.get_sqlite_connection_pool());
    runtime.dispatch(&mut queue).await.unwrap();
    let worker = worker(runtime.clone(), queue);
    assert_eq!(
        wait_terminal(&db, &run.id).await.status,
        "waiting_for_input"
    );
    wait_idle(&runtime).await;
    runtime
        .handle(RunJob {
            run_id: run.id.clone(),
        })
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(
        crate::database::entity::analysis_state::Entity::find()
            .count(&db)
            .await
            .unwrap(),
        1
    );
    let history = ai::history_page(&db, &session.id, None, 100).await.unwrap();
    assert!(history.messages.iter().any(|m| {
        m.parts
            .parts()
            .iter()
            .any(|p| matches!(p, ai::messages::MessagePart::Result { .. }))
    }));
    assert_eq!(ai::active_tasks(&db).await.unwrap(), 0);
    worker.abort();
}

#[tokio::test]
async fn project_assistant_routes_analysis_tool_then_publishes_once_in_same_session() {
    use serde_json::json;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = Fixture::raw(move |index, _, body| {
        seen.fetch_add(1, Ordering::SeqCst);
        if index == 0 {
            assert!(
                body["tools"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|t| t["function"]["name"] == "analyze_chapter")
            );
            let first = json!({"id":"test","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"analysis-call","type":"function","function":{"name":"analyze_chapter","arguments":"{}"}}]},"finish_reason":null}]});
            let end = json!({"id":"test","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]});
            return (
                200,
                "text/event-stream",
                format!("data: {first}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_bytes(),
            );
        }
        let messages = body["messages"].to_string();
        assert!(!messages.contains("请求已受理，等待完整分析结果。"));
        assert!(!messages.contains("请分析当前章的角色与说话人归属。"));
        assert!(!messages.contains("analysis-call"));
        let mut reply = crate::chapter_analysis::fixture_response(body, index);
        // Independent analysis/review providers may reuse the same call identity.
        reply["choices"][0]["message"]["tool_calls"][0]["id"] = json!("same-native-id");
        (200, "application/json", serde_json::to_vec(&reply).unwrap())
    });
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_config, llm, selection, revision) = configured(&server.endpoint);
    let session = ai::create_session(
        &db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            chapter_id: None,
            task_kind: "project_assistant".into(),
            title: "工程助手".into(),
        },
    )
    .await
    .unwrap();
    let request = StartRun {
        session_id: session.id.clone(),
        request_id: uuid::Uuid::new_v4().to_string(),
        configuration: Configuration {
            reasoning: None,
            selection,
            revision,
        },
        confirm_rebind: false,
        expected_project_revision: 1,
        trigger: Trigger::Message {
            message: "请分析当前章的角色与说话人归属。".into(),
        },
        workspace_context: Some(ai::WorkspaceContext {
            action: ai::WorkspaceAction::Auto,
            chapter_id: Some("chapter".into()),
        }),
    };
    let run = ai::start_run(&db, request, None).await.unwrap();
    super::super::setup(&db).await.unwrap();
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    let mut queue = SqliteStorage::new(db.get_sqlite_connection_pool());
    runtime.dispatch(&mut queue).await.unwrap();
    let worker = worker(runtime.clone(), queue);
    let terminal = wait_terminal(&db, &run.id).await;
    assert_eq!(terminal.status, "waiting_for_input", "{:?}", terminal.error);
    wait_idle(&runtime).await;
    runtime
        .handle(RunJob {
            run_id: run.id.clone(),
        })
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    assert_eq!(
        crate::database::entity::analysis_state::Entity::find()
            .count(&db)
            .await
            .unwrap(),
        1
    );
    let history = ai::history_page(&db, &session.id, None, 100).await.unwrap();
    assert_eq!(
        history
            .messages
            .iter()
            .filter(|m| m.role == "assistant")
            .count(),
        1,
        "tool routing and analysis must share the stream response identity"
    );
    assert_eq!(
        history
            .run
            .as_ref()
            .unwrap()
            .workspace_context
            .as_ref()
            .unwrap()
            .chapter_id
            .as_deref(),
        Some("chapter")
    );
    assert!(
        history
            .messages
            .iter()
            .flat_map(|m| m.parts.parts())
            .any(|p| matches!(p, ai::messages::MessagePart::Result { .. }))
    );
    assert!(history.messages.iter().flat_map(|m|m.parts.parts()).any(|p|matches!(p,ai::messages::MessagePart::Tool{name,state:ai::messages::ToolState::Completed,..} if name=="analyze_chapter")));
    assert_eq!(ai::active_tasks(&db).await.unwrap(), 0);
    worker.abort();
}

mod casting;
mod splitting;

#[tokio::test]
async fn invalid_reasoning_override_settles_the_run_and_releases_admission_without_network() {
    let (root, db, project) = fixture().await;
    store::save(&db, root.path(), &project, None).await.unwrap();
    let (_config_root, llm, selection, revision) = configured("http://127.0.0.1:1");
    let id = queued(
        &db,
        Configuration {
            selection,
            revision,
            reasoning: Some(crate::llm::ReasoningSetting::Max),
        },
    )
    .await;
    let runtime = Runtime::new(
        super::super::acquire_owner(root.path()).unwrap(),
        db.clone(),
        root.path().into(),
        llm,
        None,
    );
    runtime.handle(RunJob { run_id: id.clone() }).await.unwrap();
    let run = ai_run::Entity::find_by_id(id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "failed");
    assert_eq!(run.error.as_deref(), Some("configuration_unavailable"));
    assert_eq!(ai::active_tasks(&db).await.unwrap(), 0);
    assert!(runtime.admitted.lock().unwrap().is_empty());
}
