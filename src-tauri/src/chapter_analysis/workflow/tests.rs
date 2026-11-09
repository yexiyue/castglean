use super::*;

#[test]
fn unknown_capacity_keeps_full_context_and_owned_groups_cover_exactly_once() {
    let text = "甲：“我说的‘称号’仍是台词。”\r\n旁白。".repeat(100);
    let binding = SourceBinding {
        project_id: "p".into(),
        chapter_id: "c".into(),
        source_id: "s".into(),
        sha256: crate::project::hash(text.as_bytes()),
        start: 0,
        end: text.len() as u32,
    };
    let pieces = precut::partition(&text, &binding).unwrap();
    let plans = groups(&pieces, None).unwrap();
    assert_eq!(plans.len(), 2);
    assert_eq!(plans[0].0.start, 0);
    assert_eq!(plans[0].0.end, plans[1].0.start);
    assert_eq!(plans[1].0.end, pieces.len());
    assert!(
        plans
            .iter()
            .all(|(_, visible)| *visible == (0..pieces.len()))
    );
}

use crate::{
    ai::{self, Configuration, CreateSession, RunStatus, StartRun, Trigger, runs},
    database::entity::analysis_window,
    llm::ModelSelection,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::sync::Semaphore;

async fn fixture() -> (tempfile::TempDir, DatabaseConnection, String) {
    let (root, db, project) = crate::project::test_support::fixture().await;
    crate::project::store::save(&db, root.path(), &project, None)
        .await
        .unwrap();
    let session = ai::create_session(
        &db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            chapter_id: Some("chapter".into()),
            task_kind: "chapter_analysis".into(),
            title: "紧凑流程受控 HTTP 测试".into(),
        },
    )
    .await
    .unwrap();
    (root, db, session.id)
}

async fn start(db: &DatabaseConnection, session: &str) -> (Lease, input::Input) {
    let run = ai::start_analysis_run(
        db,
        StartRun {
            workspace_context: None,
            session_id: session.into(),
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: Configuration {
                selection: ModelSelection {
                    connection_id: "connection".into(),
                    model_id: "model".into(),
                },
                revision: 1,
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
    let mut frozen = input::read(db, &run.id).await.unwrap();
    frozen.protocol = 1;
    frozen.prompt_version = Some(compact::PROMPT_VERSION.into());
    crate::database::entity::analysis_input::Entity::update(
        crate::database::entity::analysis_input::ActiveModel {
            id: sea_orm::Set(run.id.clone()),
            content: sea_orm::Set(serde_json::to_value(&frozen).unwrap()),
            ..Default::default()
        },
    )
    .exec(db)
    .await
    .unwrap();
    assert_eq!((frozen.format_version, frozen.protocol), (2, 1));
    let lease = runs::claim(db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    (lease, frozen)
}

#[tokio::test]
async fn frozen_prompt_mismatch_stops_before_any_model_request() {
    use crate::database::entity::analysis_input;
    let (root, db, session) = fixture().await;
    let (lease, mut input) = start(&db, &session).await;
    assert_eq!(
        input.prompt_version.as_deref(),
        Some(compact::PROMPT_VERSION)
    );
    input.prompt_version = Some("older-prompt".into());
    analysis_input::Entity::update(analysis_input::ActiveModel {
        id: sea_orm::Set(lease.run_id().into()),
        content: sea_orm::Set(serde_json::to_value(input).unwrap()),
        ..Default::default()
    })
    .exec(&db)
    .await
    .unwrap();
    let result = execute_configured(
        &db,
        root.path(),
        &lease,
        model("http://127.0.0.1:1"),
        (None, None),
        &CancellationToken::new(),
        limits(),
    )
    .await;
    assert_eq!(result, Err(RunFailure::StaleProject));
    assert!(rows(&db, lease.run_id()).await.is_empty());
}

fn model(endpoint: &str) -> DynModel<Completion> {
    let (_config, state, selection, _) = crate::llm::test_support::configured(endpoint);
    let connection = state.acquire_for_run(&selection).unwrap();
    crate::llm::configured_model(&connection, None).unwrap()
}

fn limits() -> RequestLimits {
    RequestLimits::new(Arc::new(Semaphore::new(4)), "test-model".into())
}

fn payload(body: &Value) -> Value {
    assert!(body.get("response_format").is_some());
    let content = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|m| m["role"] == "user")
        .unwrap()["content"]
        .as_str()
        .unwrap();
    serde_json::from_str(content).unwrap()
}

fn title(payload: &Value) -> &str {
    payload["outputSchema"]["title"].as_str().unwrap()
}

fn answer(payload: &Value) -> Value {
    match title(payload) {
        "Roles" => json!({"characters":[]}),
        "Analysis" => {
            let owned = payload["owned"].as_array().unwrap();
            json!({"segments":[{
                "from":owned.first().unwrap(),"to":owned.last().unwrap(),
                "kind":"narration","who":["narrator"],"evidence":[owned[0]],
                "reason":"公开合成文本按叙述呈现，本组保持旁白归属以供人工核查"
            }]})
        }
        "Review" => json!({"issues":[],"summary":"已检查本章覆盖与归属，仍待人工审阅"}),
        other => panic!("unexpected compact schema: {other}"),
    }
}

fn review_with_issue(payload: &Value) -> Value {
    json!({"issues":[{
        "targetIds":[payload["targets"][0]["id"]],"category":"kind",
        "reason":"本章开头是章标题，可由人工核对是否保留当前旁白标注",
        "suggestedKind":"thought","suggestedWho":["unknown"],"certainty":"uncertain"
    }],"summary":"发现一处需人工核对的类型建议，未修改标注"})
}

fn completion(value: Value) -> Value {
    json!({"id":"controlled-fixture","object":"chat.completion","model":"test",
        "choices":[{"index":0,"message":{"role":"assistant","content":value.to_string()},"finish_reason":"stop"}],
        "usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}})
}

async fn rows(db: &DatabaseConnection, origin: &str) -> Vec<analysis_window::Model> {
    analysis_window::Entity::find()
        .filter(analysis_window::Column::InputId.eq(origin))
        .order_by_asc(analysis_window::Column::Ordinal)
        .all(db)
        .await
        .unwrap()
}

async fn assert_unpublished(db: &DatabaseConnection, root: &Path, session: &str) {
    assert!(
        query::snapshot(db, root, "project", "chapter")
            .await
            .unwrap()
            .version_id
            .is_none()
    );
    let history = ai::history_page(db, session, None, 100).await.unwrap();
    assert!(!history.messages.iter().any(|message| {
        message
            .parts
            .parts()
            .iter()
            .any(|part| matches!(part, crate::ai::messages::MessagePart::Result { .. }))
    }));
}

#[tokio::test]
async fn compact_http_roles_two_groups_read_only_review_and_atomic_publication() {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let observed = requests.clone();
    let server = crate::llm::test_support::Fixture::new(move |_, _, body| {
        let p = payload(body);
        let response = answer(&p);
        observed.lock().unwrap().push(p);
        (200, completion(response))
    });
    let (root, db, session) = fixture().await;
    let (lease, frozen) = start(&db, &session).await;
    let text = query::read_text(root.path(), &frozen.dependencies.source).unwrap();
    let pieces = precut::partition(&text, &frozen.dependencies.source).unwrap();
    tokio::time::timeout(
        Duration::from_secs(15),
        super::execute_configured(
            &db,
            root.path(),
            &lease,
            model(&server.endpoint),
            (None, None),
            &CancellationToken::new(),
            limits(),
        ),
    )
    .await
    .unwrap()
    .unwrap();

    let snapshot = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    assert_eq!(snapshot.revision, 1);
    let version = query::version(&db, "project", snapshot.version_id.as_deref().unwrap())
        .await
        .unwrap();
    assert_eq!(version.run_id.as_deref(), Some(lease.run_id()));
    assert_eq!(version.segments.len(), 2);
    assert_eq!(snapshot.unreviewed_count, 2);
    assert!(
        version
            .segments
            .iter()
            .all(|s| s.kind == SegmentKind::Narration
                && s.attribution == Attribution::Narrator
                && s.review == ReviewStatus::Unreviewed)
    );
    validation::validate(&version, &text, &[]).unwrap();
    assert_eq!(
        query::read_text(root.path(), &frozen.dependencies.source).unwrap(),
        text
    );
    assert_eq!(
        journal::review(&db, lease.run_id()).await.unwrap().unwrap()["issues"],
        json!([])
    );
    let diagnostics = journal::diagnostics(&db, lease.run_id()).await.unwrap();
    let spans = diagnostics["spans"].as_array().unwrap();
    assert_eq!(spans.iter().filter(|s| s["isRequest"] == true).count(), 4);
    assert!(spans.iter().all(|s| {
        s["startedAt"]
            .as_u64()
            .is_some_and(|millis| millis > 1_000_000_000_000)
    }));
    for stage in ["prepare", "identity", "validation", "review", "publish"] {
        assert_eq!(
            spans
                .iter()
                .filter(|s| s["stage"] == stage && s["status"] == "completed")
                .count(),
            1,
            "{stage}"
        );
    }
    assert_eq!(
        spans
            .iter()
            .filter(|s| s["stage"] == "analysis" && s["status"] == "completed")
            .count(),
        2
    );
    assert!(
        spans
            .iter()
            .filter(|s| s["isRequest"] == true)
            .all(|s| s["usage"]["inputTokens"] == 10 && s["model"] == "test-model")
    );
    {
        let calls = requests.lock().unwrap();
        assert_eq!(
            calls.iter().map(title).collect::<Vec<_>>(),
            ["Roles", "Analysis", "Analysis", "Review"]
        );
        let all_ids = pieces.iter().map(|p| json!(p.id)).collect::<Vec<_>>();
        let mut owned_sorted = calls[1..3]
            .iter()
            .flat_map(|p| p["owned"].as_array().unwrap().clone())
            .collect::<Vec<_>>();
        // HTTP arrival order of the two independent groups is deliberately unspecified.
        let mut expected_sorted = all_ids;
        owned_sorted.sort_by_key(Value::to_string);
        expected_sorted.sort_by_key(Value::to_string);
        assert_eq!(owned_sorted, expected_sorted);
        assert!(
            calls[1..3]
                .iter()
                .all(
                    |p| p["contextPieces"].as_array().unwrap().len() == pieces.len()
                        && p["targets"].as_array().unwrap().len()
                            == p["owned"].as_array().unwrap().len()
                )
        );
        assert_eq!(calls[3]["annotations"].as_array().unwrap().len(), 2);
    }
    let run = crate::database::entity::ai_run::Entity::find_by_id(lease.run_id())
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "waiting_for_input");
    let history = ai::history_page(&db, &session, None, 100).await.unwrap();
    assert_eq!(
        history
            .messages
            .iter()
            .flat_map(|message| message.parts.parts())
            .filter(|part| matches!(part, crate::ai::messages::MessagePart::Result { .. }))
            .count(),
        1
    );
}

#[tokio::test]
async fn valid_http_review_issue_is_queryable_but_never_applied_or_confirmed() {
    let server = crate::llm::test_support::Fixture::new(|_, _, body| {
        let p = payload(body);
        (
            200,
            completion(if title(&p) == "Review" {
                review_with_issue(&p)
            } else {
                answer(&p)
            }),
        )
    });
    let (root, db, session) = fixture().await;
    let (lease, _) = start(&db, &session).await;
    tokio::time::timeout(
        Duration::from_secs(15),
        super::execute_configured(
            &db,
            root.path(),
            &lease,
            model(&server.endpoint),
            (None, None),
            &CancellationToken::new(),
            limits(),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    let review = journal::review(&db, lease.run_id()).await.unwrap().unwrap();
    assert_eq!(review["issues"][0]["targetIds"], json!(["s0"]));
    assert_eq!(review["issues"][0]["suggestedKind"], "thought");
    assert_eq!(review["issues"][0]["suggestedWho"], json!(["unknown"]));
    assert_eq!(
        journal::diagnostics(&db, lease.run_id()).await.unwrap()["review"]["issues"],
        1
    );
    let snapshot = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    let version = query::version(&db, "project", snapshot.version_id.as_deref().unwrap())
        .await
        .unwrap();
    assert!(
        version
            .segments
            .iter()
            .all(|s| s.kind == SegmentKind::Narration
                && s.attribution == Attribution::Narrator
                && s.review == ReviewStatus::Unreviewed)
    );
    assert_eq!(snapshot.unreviewed_count as usize, version.segments.len());
    assert!(version.protections.is_empty());
}

#[tokio::test]
async fn invalid_http_review_retains_analysis_and_explicit_resume_only_resends_review() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let observed = calls.clone();
    let reviews = Arc::new(AtomicUsize::new(0));
    let attempts = reviews.clone();
    let server = crate::llm::test_support::Fixture::new(move |_, _, body| {
        let p = payload(body);
        observed.lock().unwrap().push(title(&p).to_owned());
        let mut response = answer(&p);
        if title(&p) == "Review" && attempts.fetch_add(1, Ordering::SeqCst) == 0 {
            response = review_with_issue(&p);
            response["issues"][0]["targetIds"] = json!(["s999999"]);
        }
        (200, completion(response))
    });
    let (root, db, session) = fixture().await;
    let (lease, frozen) = start(&db, &session).await;
    let model = model(&server.endpoint);
    let error = tokio::time::timeout(
        Duration::from_secs(15),
        super::execute_configured(
            &db,
            root.path(),
            &lease,
            model.clone(),
            (None, None),
            &CancellationToken::new(),
            limits(),
        ),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert_eq!(error, RunFailure::InvalidResponse);
    assert_unpublished(&db, root.path(), &session).await;
    assert!(
        journal::review(&db, lease.run_id())
            .await
            .unwrap()
            .is_none()
    );
    let saved = rows(&db, lease.run_id()).await;
    let finished = saved
        .iter()
        .filter(|r| r.ordinal == -2 || r.ordinal >= 0)
        .collect::<Vec<_>>();
    assert_eq!(finished.len(), 3);
    assert!(
        finished
            .iter()
            .all(|r| r.status == "completed" && !r.content["result"].is_null())
    );
    let failed = saved.iter().find(|r| r.ordinal == -1).unwrap();
    assert_eq!(failed.status, "failed");
    assert_eq!(failed.content["spans"][0]["error"], "invalid_response");
    assert_eq!(failed.content["spans"][0]["usage"]["inputTokens"], 10);
    assert!(failed.content["result"].is_null());
    let diagnostics = journal::diagnostics(&db, lease.run_id()).await.unwrap();
    assert!(
        diagnostics["spans"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["stage"] == "review"
                && s["status"] == "failed"
                && s["error"] == "invalid_response")
    );
    runs::finish(&db, &lease, RunStatus::Failed, Some(error))
        .await
        .unwrap();
    let resumed = ai::start_analysis_run(
        &db,
        StartRun {
            workspace_context: None,
            session_id: session.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: frozen.configuration,
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger: Trigger::Retry {
                run_id: lease.run_id().into(),
            },
        },
    )
    .await
    .unwrap();
    let next_input = input::read(&db, &resumed.id).await.unwrap();
    assert_eq!(next_input.resume_input_id.as_deref(), Some(lease.run_id()));
    let next = runs::claim(&db, &resumed.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    tokio::time::timeout(
        Duration::from_secs(15),
        super::execute_configured(
            &db,
            root.path(),
            &next,
            model,
            (None, None),
            &CancellationToken::new(),
            limits(),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        ["Roles", "Analysis", "Analysis", "Review", "Review"]
    );
    let after = rows(&db, lease.run_id()).await;
    for previous in finished {
        let reused = after.iter().find(|r| r.id == previous.id).unwrap();
        assert_eq!(
            reused.content, previous.content,
            "completed identity/analysis journal must be reused byte-for-byte"
        );
    }
    let review = after.iter().find(|r| r.ordinal == -1).unwrap();
    let spans = review.content["spans"].as_array().unwrap();
    assert_eq!(spans.len(), 2);
    assert_eq!(spans[0]["status"], "failed");
    assert_eq!(spans[1]["status"], "completed");
    assert_eq!(spans[1]["attempt"], 2);
    assert_eq!(spans[1]["runId"], next.run_id());
    assert!(journal::review(&db, next.run_id()).await.unwrap().is_some());
    let snapshot = query::snapshot(&db, root.path(), "project", "chapter")
        .await
        .unwrap();
    let version = query::version(&db, "project", snapshot.version_id.as_deref().unwrap())
        .await
        .unwrap();
    let original_segment_ids = saved
        .iter()
        .filter(|r| r.ordinal >= 0)
        .flat_map(|r| {
            r.content["result"]["segments"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s["id"].clone())
        })
        .collect::<Vec<_>>();
    assert_eq!(
        version
            .segments
            .iter()
            .map(|s| json!(s.id))
            .collect::<Vec<_>>(),
        original_segment_ids
    );
}

#[tokio::test]
async fn cancelling_while_waiting_for_global_or_connection_permits_sends_nothing() {
    for block_connection in [false, true] {
        let count = Arc::new(AtomicUsize::new(0));
        let observed = count.clone();
        let server = crate::llm::test_support::Fixture::new(move |_, _, body| {
            observed.fetch_add(1, Ordering::SeqCst);
            (200, completion(answer(&payload(body))))
        });
        let (root, db, session) = fixture().await;
        let (lease, _) = start(&db, &session).await;
        let limits = limits();
        let global = limits.global.clone();
        let gate = if block_connection {
            limits.connection.clone()
        } else {
            global.clone()
        };
        let held = gate
            .clone()
            .acquire_many_owned(if block_connection { 2 } else { 4 })
            .await
            .unwrap();
        let token = CancellationToken::new();
        let cancel = token.clone();
        let control = async {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let ready = rows(&db, lease.run_id())
                        .await
                        .iter()
                        .any(|r| r.ordinal == -2 && r.status == "pending");
                    // For the connection case, consumption of a global permit proves
                    // the request has progressed to the blocked connection gate.
                    if ready && (!block_connection || global.available_permits() == 3) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                // Allow the global-gate case to poll its blocked acquire future.
                tokio::task::yield_now().await;
                cancel.cancel();
            })
            .await
            .expect("workflow must reach the blocked request gate");
        };
        let execution = super::execute_configured(
            &db,
            root.path(),
            &lease,
            model(&server.endpoint),
            (None, None),
            &token,
            limits,
        );
        let (result, ()) = tokio::time::timeout(Duration::from_secs(10), async {
            tokio::join!(execution, control)
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), RunFailure::Cancelled);
        drop(held);
        assert_eq!(global.available_permits(), 4);
        assert_eq!(
            gate.available_permits(),
            if block_connection { 2 } else { 4 }
        );
        assert_eq!(count.load(Ordering::SeqCst), 0);
        assert_unpublished(&db, root.path(), &session).await;
        let saved = rows(&db, lease.run_id()).await;
        let identity = saved.iter().find(|r| r.ordinal == -2).unwrap();
        assert_eq!(identity.status, "pending");
        assert_eq!(identity.content["spans"], json!([]));
        assert!(identity.content["result"].is_null());
        assert!(
            journal::diagnostics(&db, lease.run_id()).await.unwrap()["spans"]
                .as_array()
                .unwrap()
                .iter()
                .all(|s| s["isRequest"] == false && s["stage"] != "publish")
        );
    }
}

#[tokio::test]
async fn invalid_identity_response_keeps_failed_span_and_same_run_never_replays_http() {
    let count = Arc::new(AtomicUsize::new(0));
    let observed = count.clone();
    let server = crate::llm::test_support::Fixture::new(move |_, _, body| {
        assert_eq!(title(&payload(body)), "Roles");
        observed.fetch_add(1, Ordering::SeqCst);
        (
            200,
            completion(json!({"characters":[{
                "key":"new:0","name":"伪造候选","evidence":["s999999"],"reason":"此引用在本章不存在"
            }]})),
        )
    });
    let (root, db, session) = fixture().await;
    let (lease, _) = start(&db, &session).await;
    let model = model(&server.endpoint);
    let token = CancellationToken::new();
    assert_eq!(
        tokio::time::timeout(
            Duration::from_secs(10),
            super::execute_configured(
                &db,
                root.path(),
                &lease,
                model.clone(),
                (None, None),
                &token,
                limits(),
            )
        )
        .await
        .unwrap()
        .unwrap_err(),
        RunFailure::InvalidResponse
    );
    assert_eq!(
        tokio::time::timeout(
            Duration::from_secs(10),
            super::execute_configured(
                &db,
                root.path(),
                &lease,
                model,
                (None, None),
                &token,
                limits(),
            )
        )
        .await
        .unwrap()
        .unwrap_err(),
        RunFailure::Interrupted
    );
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert_unpublished(&db, root.path(), &session).await;
    let diagnostics = journal::diagnostics(&db, lease.run_id()).await.unwrap();
    let spans = diagnostics["spans"].as_array().unwrap();
    let identity = spans.iter().find(|s| s["stage"] == "identity").unwrap();
    assert_eq!(identity["status"], "failed");
    assert_eq!(identity["error"], "invalid_response");
    assert_eq!(identity["attempt"], 1);
    assert_eq!(identity["isRequest"], true);
    assert_eq!(identity["model"], "test-model");
    assert_eq!(identity["runId"], lease.run_id());
    assert_eq!(identity["parentSpanId"], format!("run:{}", lease.run_id()));
    for field in [
        "spanId",
        "configurationHash",
        "promptVersion",
        "promptHash",
        "protocolVersion",
        "sourceHash",
    ] {
        assert!(!identity[field].as_str().unwrap().is_empty(), "{field}");
    }
    assert!(
        !spans
            .iter()
            .any(|s| s["stage"] == "analysis" || s["stage"] == "review" || s["stage"] == "publish")
    );
}

/// A bounded TCP fixture with independent response workers. The two annotation
/// requests rendezvous before either response is sent, proving actual overlap.
struct ConcurrentServer {
    endpoint: String,
    stop: Arc<std::sync::atomic::AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
    requests: Arc<Mutex<Vec<Value>>>,
    peak: Arc<AtomicUsize>,
}

impl ConcurrentServer {
    fn new() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let peak = Arc::new(AtomicUsize::new(0));
        let flag = stop.clone();
        let seen = requests.clone();
        let maximum = peak.clone();
        let active = Arc::new(AtomicUsize::new(0));
        let rendezvous = Arc::new((Mutex::new(0usize), std::sync::Condvar::new()));
        let worker = std::thread::spawn(move || {
            let mut workers = Vec::new();
            // A correct execution sends four requests. Even regressions cannot
            // create an unbounded accept loop or an unbounded number of threads.
            while !flag.load(Ordering::SeqCst) && workers.len() < 8 {
                let stream = match listener.accept() {
                    Ok((stream, _)) => stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(_) => break,
                };
                let seen = seen.clone();
                let maximum = maximum.clone();
                let active = active.clone();
                let rendezvous = rendezvous.clone();
                workers.push(std::thread::spawn(move || {
                    use std::io::Write;
                    stream.set_nonblocking(false).unwrap();
                    stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                    stream.set_write_timeout(Some(Duration::from_secs(3))).unwrap();
                    let mut stream = stream;
                    let body = read_http_body(&mut stream);
                    let p = payload(&body);
                    let analysis = title(&p) == "Analysis";
                    seen.lock().unwrap().push(p.clone());
                    if analysis {
                        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                        maximum.fetch_max(current, Ordering::SeqCst);
                        let (arrivals, ready) = &*rendezvous;
                        let mut arrivals = arrivals.lock().unwrap();
                        *arrivals += 1;
                        ready.notify_all();
                        let (arrivals, _) = ready.wait_timeout_while(
                            arrivals, Duration::from_secs(3), |arrivals| *arrivals < 2,
                        ).unwrap();
                        assert_eq!(*arrivals, 2, "both analysis requests must arrive before either response");
                    }
                    let response = serde_json::to_vec(&completion(answer(&p))).unwrap();
                    let header = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", response.len());
                    let result = stream.write_all(header.as_bytes()).and_then(|()| stream.write_all(&response));
                    if analysis { active.fetch_sub(1, Ordering::SeqCst); }
                    result.unwrap();
                    let _ = stream.shutdown(std::net::Shutdown::Write);
                }));
            }
            for worker in workers {
                // Propagate worker assertions through the listener thread.
                worker.join().unwrap();
            }
        });
        Self {
            endpoint,
            stop,
            worker: Some(worker),
            requests,
            peak,
        }
    }
}

impl Drop for ConcurrentServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let result = worker.join();
            if !std::thread::panicking() {
                result.unwrap();
            }
        }
    }
}

fn read_http_body(stream: &mut std::net::TcpStream) -> Value {
    use std::io::Read;
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let n = stream.read(&mut buffer).unwrap();
        assert_ne!(n, 0, "complete HTTP request required");
        bytes.extend_from_slice(&buffer[..n]);
        assert!(bytes.len() <= 256 * 1024, "bounded public fixture request");
        let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") else {
            continue;
        };
        let length = String::from_utf8_lossy(&bytes[..pos])
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(|v| v.trim().parse::<usize>().unwrap())
            })
            .expect("content-length");
        let start = pos + 4;
        if bytes.len() >= start + length {
            return serde_json::from_slice(&bytes[start..start + length]).unwrap();
        }
    }
}

#[tokio::test]
async fn two_annotation_http_requests_are_in_flight_together_with_peak_two() {
    let server = ConcurrentServer::new();
    let (root, db, session) = fixture().await;
    let (lease, _) = start(&db, &session).await;
    tokio::time::timeout(
        Duration::from_secs(15),
        super::execute_configured(
            &db,
            root.path(),
            &lease,
            model(&server.endpoint),
            (None, None),
            &CancellationToken::new(),
            limits(),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(server.peak.load(Ordering::SeqCst), 2);
    {
        let calls = server.requests.lock().unwrap();
        assert_eq!(calls.len(), 4);
        assert_eq!(
            calls.iter().map(title).collect::<Vec<_>>(),
            ["Roles", "Analysis", "Analysis", "Review"]
        );
    }
    assert!(
        query::snapshot(&db, root.path(), "project", "chapter")
            .await
            .unwrap()
            .version_id
            .is_some()
    );
}
