use super::*;
use crate::{
    backend::Backend,
    contract::{Case, Source},
    driver::{Options, run_backend},
    journal::{Journal, State},
};
fn fixture(control: Value) -> (Arc<NativeBoundary>, Case, Options, PathBuf) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/native-tests")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&root).unwrap();
    let config_path = root.join("config.json");
    fs::write(&config_path,serde_json::to_vec(&json!({"version":1,"connections":[{"credentialRef":"NEVER-PUBLISH-THIS-REF","connection":{"id":"connection-a","revision":1,"protocol":"openai-compatible","endpoint":"https://invalid.example/fixture","models":[{"id":"model-a","modelId":"controlled-native","contextWindow":null,"maxOutputTokens":null}]}}],"controlledFixture":control})).unwrap()).unwrap();
    let native = NativeBoundary::open(
        NativeConfig {
            bridge_binary: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("fixtures/native_helper.py"),
            config_path,
            selection: Selection {
                connection_id: "connection-a".into(),
                model_id: "model-a".into(),
            },
            controlled_helper: true,
            bridge_identity: None,
        },
        &root.join("jobs"),
    )
    .unwrap();
    let text = "风起。雨落。天明。";
    let case = Case {
        version: 1,
        case_id: "native-fixture".into(),
        evaluation_task: "analysis".into(),
        source: Source {
            text: text.into(),
            sha256: hash(text.as_bytes()),
        },
        characters: vec![],
        review_input: None,
    };
    let options = Options {
        deadline: Duration::from_secs(4),
        cancel_after: None,
        cancellation: None,
        barrier: false,
        code_revision: "native-test-code".into(),
        dataset_hash: "native-test-data".into(),
        dataset_version: "native-test-1".into(),
        interrupt_after: None,
    };
    (native, case, options, root.join("checkpoint.json"))
}
fn run(
    n: Arc<NativeBoundary>,
    case: &Case,
    options: &Options,
    path: &Path,
) -> crate::driver::Report {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    run_backend(
        case,
        &Backend::Native(n),
        options,
        path,
        runtime.handle().clone(),
    )
    .unwrap()
}
#[test]
fn native_helper_uses_actual_ecs_effect_path_and_preserves_snake_case_usage() {
    let (native, case, options, path) = fixture(json!({}));
    let spec = native.spec().unwrap();
    assert_eq!(spec.id, "controlled-native");
    assert_eq!(spec.context_window, None);
    assert!(!spec.tools && !spec.structured_output);
    assert!(spec.pricing.is_none());
    let report = run(Arc::clone(&native), &case, &options, &path);
    assert_eq!(report.status, "completed", "{:?}", report.diagnostics);
    assert_eq!(report.request_count, 4);
    assert_eq!(report.mode, "mock");
    assert_eq!(report.execution_mode, "controlled_native_helper");
    assert!(!report.kernel_effect_ids.is_empty());
    for span in report.trace.iter().filter(|s| s.is_request) {
        assert_eq!(span.usage.input_tokens, Some(11));
        assert_eq!(span.usage.cached_input_tokens, Some(3));
        assert_eq!(span.usage.reasoning_tokens, Some(2));
        let meta = span.metadata.as_ref().unwrap();
        assert_eq!(meta.model, "controlled-native");
        assert!(!meta.capabilities_verified);
        assert_eq!(meta.boundary_mode, "controlled_native_helper");
    }
    assert!(
        !serde_json::to_string(&report)
            .unwrap()
            .contains("NEVER-PUBLISH")
    );
    assert!(
        !fs::read_dir(&native.jobs)
            .unwrap()
            .any(|e| e.unwrap().path().is_dir())
    );
    native.drain().unwrap();
}
#[test]
fn model_configuration_hash_matches_frozen_canonical_contract() {
    let (native, _, _, _) = fixture(json!({}));
    let canonical = r#"{"capacity":[null,null],"configuration":{"revision":1,"selection":{"connectionId":"connection-a","modelId":"model-a"}},"model":"controlled-native","reasoning":"low"}"#;
    assert_eq!(
        native.binding.configuration_hash,
        hash(canonical.as_bytes())
    );
}
#[test]
fn cancellation_reaps_children_marks_unknown_and_resume_sends_nothing() {
    let (native, case, mut options, path) = fixture(json!({"delayMs":3000}));
    let signal = Arc::new(std::sync::atomic::AtomicBool::new(false));
    options.cancellation = Some(Arc::clone(&signal));
    let jobs = native.jobs.clone();
    let trigger = std::thread::spawn(move || {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            if fs::read_dir(&jobs)
                .unwrap()
                .filter_map(|e| e.ok())
                .any(|e| e.path().extension().is_some_and(|e| e == "json"))
            {
                signal.store(true, Ordering::SeqCst);
                return true;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        signal.store(true, Ordering::SeqCst);
        false
    });
    let report = run(Arc::clone(&native), &case, &options, &path);
    assert!(
        trigger.join().unwrap(),
        "waited for actual child admission before cancellation"
    );
    assert_eq!(report.status, "cancelled");
    assert_eq!(report.request_count, 3);
    native.drain().unwrap();
    let journal: Journal = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert!(journal.slots[..3].iter().all(|s| s.state == State::Unknown));
    let markers: Vec<_> = fs::read_dir(&native.jobs)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|e| e == "json"))
        .collect();
    assert!(
        !markers.is_empty(),
        "actually launched child processes must be tested"
    );
    for marker in &markers {
        let value: Value = serde_json::from_slice(&fs::read(marker.path()).unwrap()).unwrap();
        let alive = std::process::Command::new("kill")
            .args(["-0", &value["pid"].to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success();
        assert!(!alive, "child was not reaped");
    }
    options.cancel_after = None;
    options.cancellation = None;
    let resumed = run(Arc::clone(&native), &case, &options, &path);
    assert_eq!(resumed.status, "interrupted");
    assert_eq!(resumed.request_count, 0);
}
#[test]
fn per_request_timeout_is_unknown_and_has_no_automatic_retry() {
    let (mut native, case, options, path) = fixture(json!({"delayMs":3000}));
    Arc::get_mut(&mut native).unwrap().request_timeout = Duration::from_millis(120);
    let report = run(Arc::clone(&native), &case, &options, &path);
    assert_eq!(report.status, "failed");
    assert_eq!(report.failure_kind.as_deref(), Some("timeout"));
    assert_eq!(report.request_count, 3);
    assert!(report.trace.iter().any(|s| s.status == "timeout"));
    native.drain().unwrap();
    let journal: Journal = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert!(journal.slots[..3].iter().all(|s| s.state == State::Unknown));
}
#[test]
fn provider_failure_exit_malformed_response_and_model_mismatch_are_safe() {
    for failure in ["provider", "exit", "malformed", "model"] {
        let (native, case, options, path) = fixture(json!({"failure":failure}));
        let report = run(Arc::clone(&native), &case, &options, &path);
        assert_ne!(report.status, "completed");
        assert_eq!(report.request_count, 3);
        assert!(report.segments.is_empty());
        assert!(!serde_json::to_string(&report).unwrap().contains("PRIVATE"));
        native.drain().unwrap();
    }
}
#[test]
fn unreported_native_usage_is_unknown() {
    let (native, case, options, path) = fixture(json!({"unknownUsage":true}));
    let report = run(native, &case, &options, &path);
    assert_eq!(report.status, "completed");
    assert!(report.trace.iter().all(|s| s.usage.input_tokens.is_none()));
}
#[test]
fn model_config_drift_is_refused_before_any_new_helper() {
    let (native, case, options, path) = fixture(json!({}));
    let mut document: Value =
        serde_json::from_slice(&fs::read(&native.config.config_path).unwrap()).unwrap();
    document["connections"][0]["connection"]["revision"] = json!(2);
    fs::write(
        &native.config.config_path,
        serde_json::to_vec(&document).unwrap(),
    )
    .unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    assert!(
        run_backend(
            &case,
            &Backend::Native(Arc::clone(&native)),
            &options,
            &path,
            runtime.handle().clone()
        )
        .is_err()
    );
    assert_eq!(native.active.load(Ordering::SeqCst), 0);
}
#[test]
fn mock_live_and_changed_helper_identity_cannot_share_a_checkpoint() {
    let (native, case, options, path) = fixture(json!({}));
    run(Arc::clone(&native), &case, &options, &path);
    let other = NativeBoundary::open(
        NativeConfig {
            controlled_helper: false,
            ..native.config.clone()
        },
        &native.jobs,
    )
    .unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    assert!(
        run_backend(
            &case,
            &Backend::Native(other),
            &options,
            &path,
            runtime.handle().clone()
        )
        .is_err()
    );
}
