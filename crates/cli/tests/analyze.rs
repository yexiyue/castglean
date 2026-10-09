//! Process-level analysis contracts using a local fake GLM HTTP service.
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    process::Command,
    thread,
    time::Duration,
};

fn command_base(root: &Path) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_castglean"));
    cmd.current_dir(root)
        .env_remove("MODEL_BACKEND")
        .env_remove("LOCAL_MODEL")
        .env_remove("LOCAL_API_BASE_URL")
        .env_remove("MINIMAX_MODEL")
        .env_remove("MINIMAX_API_BASE_URL")
        .env_remove("MINIMAX_API_KEY")
        .env_remove("MODEL")
        .env_remove("API_BASE_URL")
        .env_remove("BIGMODEL_API_KEY")
        .env_remove("REASONING_EFFORT")
        .env_remove("OUTPUT_MODE");
    cmd
}
fn command(root: &Path) -> Command {
    let mut cmd = command_base(root);
    cmd.args([
        "analyze",
        "--book",
        "test",
        "--chapter",
        "ch",
        "--source",
        "input.txt",
        "--output",
        "result",
    ]);
    cmd
}
fn mock(mode: &'static str) -> (String, thread::JoinHandle<Value>) {
    let (endpoint, handle) = mock_sequence(vec![mode]);
    (
        endpoint,
        thread::spawn(move || handle.join().unwrap().remove(0)),
    )
}
fn mock_sequence(modes: Vec<&'static str>) -> (String, thread::JoinHandle<Vec<Value>>) {
    mock_sequence_notified(modes, None)
}
fn mock_sequence_notified(
    modes: Vec<&'static str>,
    notify: Option<std::sync::mpsc::Sender<&'static str>>,
) -> (String, thread::JoinHandle<Vec<Value>>) {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v4/", server.local_addr().unwrap());
    server.set_nonblocking(true).unwrap();
    let handle = thread::spawn(move || {
        modes.into_iter().map(|mode| {
        let started = std::time::Instant::now();
        let (mut socket, _) = loop {
            match server.accept() {
                Ok(connection) => break connection,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(started.elapsed() < Duration::from_secs(10), "expected model request");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("{error}"),
            }
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut bytes = Vec::new();
        let payload = loop {
            let mut buffer = [0; 8192];
            let length = socket.read(&mut buffer).unwrap();
            assert!(length > 0);
            bytes.extend_from_slice(&buffer[..length]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let n: usize = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length: "))
                    .unwrap()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + n {
                    break serde_json::from_slice::<Value>(&bytes[end + 4..end + 4 + n]).unwrap();
                }
            }
        };
        if let Some(notify) = &notify { notify.send(mode).unwrap(); }
        let input: Value =
            serde_json::from_str(payload["messages"][1]["content"].as_str().unwrap()).unwrap();
        let segments: Vec<_> = input["segments"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["target"] == true)
            .map(|s| json!({"segment_id":s["id"],"kind":"narration","attribution":null}))
            .collect();
        let content = if mode == "quote" || mode == "missing-quote" {
            let id = &input["segments"][0]["id"];
            let mut c = json!({"characters":[{"temp_id":"a","display_name":"张三","aliases":[],"evidence_segment_ids":[id]}], "segments":segments});
            if mode == "quote" {
                c["characters"][0]["evidence_quotes"] = json!([{"segment_id":id,"quote":"张三说"}]);
            }
            c.to_string()
        } else if mode == "identity" {
            let fresh=input["characters"].as_array().unwrap().is_empty();
            let characters=if fresh {json!([{"temp_id":"a","display_name":"张三","aliases":[],"evidence_segment_ids":[input["segments"][0]["id"]]}])} else {json!([])};
            let reference=if fresh {json!({"scope":"new","id":"a"})} else {json!({"scope":"existing","id":input["characters"][0]["id"]})};
            let annotated:Vec<_>=input["segments"].as_array().unwrap().iter().filter(|s|s["target"]==true).map(|s|{
                if s["text"].as_str().unwrap().starts_with('“') {json!({"segment_id":s["id"],"kind":"speech","attribution":{"status":"resolved","character":reference,"evidence_segment_ids":[input["segments"][0]["id"]]}})} else {json!({"segment_id":s["id"],"kind":"narration","attribution":null})}
            }).collect();
            json!({"characters":characters,"segments":annotated}).to_string()
        } else if mode == "invalid" {
            "private-novel-invalid".to_owned()
        } else {
            json!({"characters":[],"segments":segments}).to_string()
        };
        let tool = payload.get("tools").is_some();
        let message = if tool {
            json!({"role":"assistant","tool_calls":[{"id":"call-1","type":"function","function":{"name":"submit_analysis","arguments":content}}]})
        } else {
            json!({"role":"assistant","content":content})
        };
        let body = json!({"model":"glm-4.6","choices":[{"message":message,"finish_reason":if tool {"tool_calls"} else {"stop"}}],"usage":{"prompt_tokens":10,"completion_tokens":20}}).to_string();
        if mode == "timeout" {
            thread::sleep(Duration::from_millis(1300));
        }
        let _ = write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        payload
    }).collect()
    });
    (endpoint, handle)
}
fn setup() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("input.txt"), "张三说：\r\n“走吧。”🙂").unwrap();
    root
}
fn envfile(root: &Path, endpoint: &str) {
    fs::write(
        root.join(".env"),
        format!("MODEL=bigmodel::glm-4.6\nAPI_BASE_URL={endpoint}\nBIGMODEL_API_KEY=test-key\n"),
    )
    .unwrap();
}

fn run_plan(root: &Path, endpoint: &str) {
    use castglean_core::*;
    let plan = RunPlan {
        format_version: 1,
        base: BookState::new(BookId::new("test").unwrap())
            .unwrap()
            .document(),
        chapters: [
            ("one", "张三说：“别忘私密正文。”"),
            ("two", "张三说：“继续私密正文。”"),
        ]
        .into_iter()
        .map(|(id, text)| {
            RunChapter::new(ChapterId::new(id).unwrap(), SourceSnapshot::import(text))
        })
        .collect(),
        config: RunConfig::new(
            RunModel {
                backend: "glm".into(),
                model: "bigmodel::glm-4.6".into(),
                endpoint: endpoint.into(),
                reasoning_effort: "low".into(),
                output_mode: "json".into(),
            },
            AnalysisOptions::default(),
            concat!("castglean-cli/", env!("CARGO_PKG_VERSION"), "/run-2").into(),
        ),
    };
    fs::write(
        root.join("plan.json"),
        serde_json::to_vec_pretty(&plan).unwrap(),
    )
    .unwrap();
}

#[test]
fn killed_process_releases_lock_and_resume_skips_first_chapter() {
    let root = setup();
    let (send, receive) = std::sync::mpsc::channel();
    let (endpoint, handle) =
        mock_sequence_notified(vec!["identity", "timeout", "identity"], Some(send));
    envfile(root.path(), &endpoint);
    run_plan(root.path(), &endpoint);
    let mut child = command_base(root.path())
        .args([
            "run",
            "--plan",
            "plan.json",
            "--run-dir",
            "journal",
            "--backend",
            "glm",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    assert_eq!(
        receive.recv_timeout(Duration::from_secs(15)).unwrap(),
        "identity"
    );
    assert_eq!(
        receive.recv_timeout(Duration::from_secs(15)).unwrap(),
        "timeout"
    );
    let first_path = root.path().join("journal/commits/00000001/commit.json");
    let first = fs::read(&first_path).unwrap();
    let busy = command_base(root.path())
        .args(["run-inspect", "--run-dir", "journal"])
        .output()
        .unwrap();
    assert!(!busy.status.success());
    assert!(String::from_utf8_lossy(&busy.stderr).contains("run is busy"));
    child.kill().unwrap();
    child.wait().unwrap();
    assert!(!root.path().join("journal/commits/00000002").exists());
    let resumed = command_base(root.path())
        .args(["resume", "--run-dir", "journal", "--backend", "glm"])
        .output()
        .unwrap();
    assert!(
        resumed.status.success(),
        "{}",
        String::from_utf8_lossy(&resumed.stderr)
    );
    assert_eq!(
        receive.recv_timeout(Duration::from_secs(10)).unwrap(),
        "identity"
    );
    let requests = handle.join().unwrap();
    assert_eq!(requests.len(), 3);
    let repeated = command_base(root.path())
        .args(["resume", "--run-dir", "journal", "--backend", "glm"])
        .output()
        .unwrap();
    assert!(repeated.status.success());
    assert_eq!(fs::read(first_path).unwrap(), first);
    let inspect = command_base(root.path())
        .args([
            "run-inspect",
            "--run-dir",
            "journal",
            "--output",
            "exported",
        ])
        .output()
        .unwrap();
    assert!(inspect.status.success());
    let progress: Value = serde_json::from_slice(&inspect.stdout).unwrap();
    assert_eq!(progress["completed"], 2);
    assert_eq!(progress["revision"], 3);
    assert_eq!(progress["uncommitted_usage"], Value::Null);
    let book: Value =
        serde_json::from_slice(&fs::read(root.path().join("exported/book.json")).unwrap()).unwrap();
    assert_eq!(book["registry"]["characters"].as_array().unwrap().len(), 1);
    let validated = command_base(root.path())
        .args(["validate", "--book-file", "exported/book.json"])
        .output()
        .unwrap();
    assert!(validated.status.success());
    for output in [&resumed, &repeated, &inspect] {
        assert!(!String::from_utf8_lossy(&output.stdout).contains("私密正文"));
        assert!(!String::from_utf8_lossy(&output.stderr).contains("test-key"));
    }
    assert!(
        !String::from_utf8_lossy(&fs::read(root.path().join("journal/manifest.json")).unwrap())
            .contains("test-key")
    );
    let drift = command_base(root.path())
        .env("MODEL", "bigmodel::other")
        .args(["resume", "--run-dir", "journal", "--backend", "glm"])
        .output()
        .unwrap();
    assert!(!drift.status.success());
    assert!(String::from_utf8_lossy(&drift.stderr).contains("configuration mismatch"));
}

#[test]
fn run_failure_has_no_commit_and_inspect_needs_no_provider() {
    let root = setup();
    let (endpoint, handle) = mock_sequence(vec!["invalid", "invalid"]);
    envfile(root.path(), &endpoint);
    run_plan(root.path(), &endpoint);
    let result = command_base(root.path())
        .args([
            "run",
            "--plan",
            "plan.json",
            "--run-dir",
            "journal",
            "--backend",
            "glm",
        ])
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert_eq!(handle.join().unwrap().len(), 2);
    assert!(!root.path().join("journal/commits/00000001").exists());
    fs::remove_file(root.path().join(".env")).unwrap();
    let inspected = command_base(root.path())
        .args(["run-inspect", "--run-dir", "journal"])
        .output()
        .unwrap();
    assert!(inspected.status.success());
    let progress: Value = serde_json::from_slice(&inspected.stdout).unwrap();
    assert_eq!(progress["completed"], 0);
    let zero = command_base(root.path())
        .args(["resume", "--run-dir", "journal", "--max-chapters", "0"])
        .output()
        .unwrap();
    assert!(!zero.status.success());
}

#[test]
fn quotation_mode_records_proofs_repairs_and_never_publishes_invalid_quotes() {
    for (modes, success) in [
        (vec!["missing-quote", "quote"], true),
        (vec!["missing-quote", "missing-quote"], false),
    ] {
        let root = setup();
        let (endpoint, handle) = mock_sequence(modes);
        envfile(root.path(), &endpoint);
        let output = command(root.path())
            .args(["--evidence-mode", "verified-quotes"])
            .output()
            .unwrap();
        let requests = handle.join().unwrap();
        assert_eq!(output.status.success(), success);
        let feedback: Value =
            serde_json::from_str(requests[1]["messages"][1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(feedback["repair"]["issue"]["code"], "missing_quotation");
        assert!(
            requests[0]["messages"][0]["content"]
                .as_str()
                .unwrap()
                .contains("本次启用原文引文校验")
        );
        if success {
            let stats: Value = serde_json::from_slice(
                &fs::read(root.path().join("result/analysis.stats.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(stats["prompt_version"], 10);
            assert_eq!(stats["options"]["evidence_mode"], "verified_quotes");
            assert_eq!(stats["repair_requests"], 1);
            let characters: Value = serde_json::from_slice(
                &fs::read(root.path().join("result/characters.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(
                characters["characters"][0]["extensions"]["castglean.quotation_evidence"]["quotes"]
                    [0]["start"],
                0
            );
        } else {
            assert!(!root.path().join("result").exists());
        }
    }
}

#[test]
fn local_selection_priority_defaults_and_publication() {
    for (file_backend, process_backend, flag) in [
        ("local", None, None),
        ("glm", Some("local"), None),
        ("private-invalid", Some("private-invalid"), Some("local")),
    ] {
        let root = setup();
        let (endpoint, handle) = mock("valid");
        fs::write(root.path().join(".env"), format!(
            "MODEL_BACKEND={file_backend}\nLOCAL_API_BASE_URL=http://127.0.0.1:1/v1\nLOCAL_MODEL=file-model\nMODEL=invalid-glm\nOUTPUT_MODE=invalid-glm\nREASONING_EFFORT=invalid-glm\n"
        )).unwrap();
        let mut cmd = command(root.path());
        cmd.env("LOCAL_API_BASE_URL", endpoint)
            .env("LOCAL_MODEL", "process-model");
        if let Some(v) = process_backend {
            cmd.env("MODEL_BACKEND", v);
        }
        if let Some(v) = flag {
            cmd.args(["--backend", v]);
        }
        let result = cmd.output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let payload = handle.join().unwrap();
        assert_eq!(payload["model"], "process-model");
        assert_eq!(payload["reasoning_effort"], "off");
        assert_eq!(payload["response_format"]["type"], "json_schema");
        let stats: Value = serde_json::from_slice(
            &fs::read(root.path().join("result/analysis.stats.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(stats["backend"], "local");
        assert_eq!(stats["output_mode"], "schema");
        assert_eq!(stats["options"]["window_segments"], 8);
        assert_eq!(stats["options"]["max_output_tokens"], 2048);
        assert_eq!(
            fs::read_to_string(root.path().join("result/chapter.txt")).unwrap(),
            "张三说：\n“走吧。”🙂"
        );
    }
}

#[test]
fn local_invalid_candidates_and_unsupported_options_never_publish() {
    let root = setup();
    let (endpoint, handle) = mock_sequence(vec!["invalid", "invalid"]);
    fs::write(
        root.path().join(".env"),
        format!("MODEL_BACKEND=local\nLOCAL_API_BASE_URL={endpoint}\n"),
    )
    .unwrap();
    let result = command(root.path()).output().unwrap();
    assert!(!result.status.success());
    assert!(!root.path().join("result").exists());
    assert!(!String::from_utf8_lossy(&result.stderr).contains("private-novel-invalid"));
    assert_eq!(handle.join().unwrap().len(), 2);
    for args in [["--output-mode", "json"], ["--reasoning-effort", "low"]] {
        let result = command(root.path()).args(args).output().unwrap();
        assert!(!result.status.success());
        assert!(!root.path().join("result").exists());
    }
}

#[test]
fn minimax_selection_isolated_configuration_and_statistics() {
    for (file_backend, process_backend, flag) in [
        ("minimax", None, None),
        ("local", Some("minimax"), None),
        ("invalid", Some("invalid"), Some("minimax")),
    ] {
        let root = setup();
        let (endpoint, handle) = mock("valid");
        fs::write(root.path().join(".env"),format!("MODEL_BACKEND={file_backend}\nMINIMAX_MODEL=file-model\nMINIMAX_API_KEY=file-key\nMODEL=invalid\nOUTPUT_MODE=invalid\nREASONING_EFFORT=invalid\n")).unwrap();
        let mut cmd = command(root.path());
        cmd.env("MINIMAX_API_BASE_URL", endpoint)
            .env("MINIMAX_MODEL", "MiniMax-M2.5")
            .env("MINIMAX_API_KEY", "process-key");
        if let Some(v) = process_backend {
            cmd.env("MODEL_BACKEND", v);
        }
        if let Some(v) = flag {
            cmd.args(["--backend", v]);
        }
        let result = cmd.output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let payload = handle.join().unwrap();
        assert_eq!(payload["model"], "MiniMax-M2.5");
        assert_eq!(payload["reasoning_split"], true);
        assert!(payload.get("response_format").is_none());
        let stats: Value = serde_json::from_slice(
            &fs::read(root.path().join("result/analysis.stats.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(stats["backend"], "minimax");
        assert_eq!(stats["output_mode"], "text");
        assert_eq!(stats["reasoning_effort"], "provider_default");
        assert_eq!(stats["options"]["max_output_tokens"], 8192);
        assert!(!stats.to_string().contains("process-key"));
    }
}

#[test]
fn minimax_failure_and_missing_credentials_never_publish() {
    let root = setup();
    fs::write(
        root.path().join(".env"),
        "MODEL_BACKEND=minimax\nBIGMODEL_API_KEY=glm-key\n",
    )
    .unwrap();
    let result = command(root.path()).output().unwrap();
    assert!(!result.status.success());
    assert!(!root.path().join("result").exists());
    let (endpoint, handle) = mock_sequence(vec!["invalid", "invalid"]);
    let result = command(root.path())
        .env("MINIMAX_API_BASE_URL", endpoint)
        .env("MINIMAX_API_KEY", "test-key")
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(!root.path().join("result").exists());
    assert!(!String::from_utf8_lossy(&result.stderr).contains("private-novel"));
    assert_eq!(handle.join().unwrap().len(), 2);
    for args in [["--output-mode", "schema"], ["--reasoning-effort", "low"]] {
        assert!(
            !command(root.path())
                .env("MINIMAX_API_KEY", "test-key")
                .args(args)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
}
#[test]
fn successful_analysis_publishes_validatable_snapshot_and_stats() {
    let root = setup();
    let before = fs::read(root.path().join("input.txt")).unwrap();
    let (endpoint, handle) = mock("valid");
    envfile(root.path(), &endpoint);
    let result = command(root.path()).output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(handle.join().unwrap()["reasoning_effort"], "low");
    assert_eq!(fs::read(root.path().join("input.txt")).unwrap(), before);
    assert_eq!(
        fs::read_to_string(root.path().join("result/chapter.txt")).unwrap(),
        "张三说：\n“走吧。”🙂"
    );
    let result = Command::new(env!("CARGO_BIN_EXE_castglean"))
        .current_dir(root.path())
        .args([
            "validate",
            "--characters",
            "result/characters.json",
            "--annotations",
            "result/chapter.annotations.json",
            "--source",
            "result/chapter.txt",
        ])
        .output()
        .unwrap();
    assert!(result.status.success());
    let stats: Value =
        serde_json::from_slice(&fs::read(root.path().join("result/analysis.stats.json")).unwrap())
            .unwrap();
    assert_eq!(stats["requests"], 1);
    assert_eq!(stats["usage"][0]["input"], 10);
    assert_eq!(stats["usage"][0]["reasoning"], Value::Null);
    assert_eq!(stats["reasoning_effort"], "low");
    assert_eq!(stats["output_mode"], "json");
    assert!(stats["response_bytes"][0].as_u64().unwrap() > 0);
    assert!(
        !fs::read_to_string(root.path().join("result/characters.json"))
            .unwrap()
            .contains("test-key")
    );
}
#[test]
fn process_environment_overrides_file_and_explicit_path_is_supported() {
    let root = setup();
    let (endpoint, handle) = mock("valid");
    fs::write(
        root.path().join("custom.env"),
        "MODEL=invalid-model\nAPI_BASE_URL=file:///bad\nBIGMODEL_API_KEY=file-key\n",
    )
    .unwrap();
    let result = command(root.path())
        .args(["--env-file", "custom.env"])
        .env("MODEL", "bigmodel::glm-4.7")
        .env("API_BASE_URL", endpoint)
        .env("BIGMODEL_API_KEY", "process-key")
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(handle.join().unwrap()["model"], "glm-4.7");
}
#[test]
fn output_mode_priority_and_invalid_values() {
    for (process, flag, expected) in [
        (None, None, "schema"),
        (Some("tool"), None, "tool"),
        (Some("private-invalid"), Some("json"), "json"),
    ] {
        let root = setup();
        let (endpoint, handle) = mock("valid");
        envfile(root.path(), &endpoint);
        writeln!(
            fs::OpenOptions::new()
                .append(true)
                .open(root.path().join(".env"))
                .unwrap(),
            "OUTPUT_MODE=schema"
        )
        .unwrap();
        let mut cmd = command(root.path());
        if let Some(value) = process {
            cmd.env("OUTPUT_MODE", value);
        }
        if let Some(value) = flag {
            cmd.args(["--output-mode", value]);
        }
        let result = cmd.output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let payload = handle.join().unwrap();
        if expected == "tool" {
            assert!(payload.get("tools").is_some());
        } else {
            assert_eq!(
                payload["response_format"]["type"],
                if expected == "json" {
                    "json_object"
                } else {
                    "json_schema"
                }
            );
        }
        let stats: Value = serde_json::from_slice(
            &fs::read(root.path().join("result/analysis.stats.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(stats["output_mode"], expected);
    }
    let root = setup();
    envfile(root.path(), "http://127.0.0.1:1/");
    let result = command(root.path())
        .env("OUTPUT_MODE", "private-invalid")
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(!root.path().join("result").exists());
    assert!(!String::from_utf8_lossy(&result.stderr).contains("private-invalid"));
}
#[test]
fn reasoning_priority_and_invalid_values() {
    for (process, flag, expected) in [
        (None, None, "high"),
        (Some("max"), None, "max"),
        (Some("invalid"), Some("low"), "low"),
    ] {
        let root = setup();
        let (endpoint, handle) = mock("valid");
        envfile(root.path(), &endpoint);
        writeln!(
            fs::OpenOptions::new()
                .append(true)
                .open(root.path().join(".env"))
                .unwrap(),
            "REASONING_EFFORT=high"
        )
        .unwrap();
        let mut cmd = command(root.path());
        if let Some(value) = process {
            cmd.env("REASONING_EFFORT", value);
        }
        if let Some(value) = flag {
            cmd.args(["--reasoning-effort", value]);
        }
        let result = cmd.output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert_eq!(handle.join().unwrap()["reasoning_effort"], expected);
        let stats: Value = serde_json::from_slice(
            &fs::read(root.path().join("result/analysis.stats.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(stats["reasoning_effort"], expected);
    }
    let root = setup();
    envfile(root.path(), "http://127.0.0.1:1/");
    let result = command(root.path())
        .env("REASONING_EFFORT", "private-invalid")
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(!root.path().join("result").exists());
    assert!(!String::from_utf8_lossy(&result.stderr).contains("private-invalid"));
}
#[test]
fn failed_or_timed_out_analysis_never_publishes() {
    for mode in ["invalid", "timeout"] {
        let root = setup();
        let (endpoint, handle) = mock(mode);
        envfile(root.path(), &endpoint);
        let result = command(root.path())
            .args(["--timeout-secs", "1", "--max-repairs-per-window", "0"])
            .output()
            .unwrap();
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
        assert!(!root.path().join("result").exists());
        assert!(!String::from_utf8_lossy(&result.stderr).contains("private-novel-invalid"));
        handle.join().unwrap();
    }
}
#[test]
fn existing_output_and_missing_or_invalid_config_do_not_write() {
    for mode in ["existing", "missing", "bad-env", "explicit-missing"] {
        let root = setup();
        if mode == "existing" {
            fs::create_dir(root.path().join("result")).unwrap();
            fs::write(root.path().join("result/keep"), "keep").unwrap();
        }
        if mode == "bad-env" {
            fs::write(root.path().join(".env"), "BIGMODEL_API_KEY='private-key\n").unwrap();
        }
        let mut cmd = command(root.path());
        if mode == "explicit-missing" {
            cmd.args(["--env-file", "missing.env"]);
        }
        let result = cmd.output().unwrap();
        assert!(!result.status.success());
        assert!(!String::from_utf8_lossy(&result.stderr).contains("private-key"));
        if mode == "existing" {
            assert_eq!(
                fs::read_to_string(root.path().join("result/keep")).unwrap(),
                "keep"
            );
        } else {
            assert!(!root.path().join("result").exists());
        }
    }
}
#[test]
fn offline_validate_ignores_broken_env_file() {
    let root = setup();
    fs::write(root.path().join(".env"), "KEY='broken").unwrap();
    let samples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/minimal");
    let result = Command::new(env!("CARGO_BIN_EXE_castglean"))
        .current_dir(root.path())
        .arg("validate")
        .arg("--characters")
        .arg(samples.join("characters.json"))
        .arg("--annotations")
        .arg(samples.join("chapter.annotations.json"))
        .arg("--source")
        .arg(samples.join("chapter.txt"))
        .output()
        .unwrap();
    assert!(result.status.success());
}

#[test]
fn repaired_analysis_publishes_both_call_stats_and_explicit_limits() {
    let root = setup();
    let (endpoint, handle) = mock_sequence(vec!["invalid", "valid"]);
    envfile(root.path(), &endpoint);
    let result = command(root.path())
        .args([
            "--max-repairs-per-window",
            "2",
            "--chapter-timeout-secs",
            "30",
        ])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let calls = handle.join().unwrap();
    assert_eq!(calls.len(), 2);
    let feedback: Value =
        serde_json::from_str(calls[1]["messages"][1]["content"].as_str().unwrap()).unwrap();
    assert_eq!(feedback["repair"]["issue"]["code"], "invalid_json");
    assert!(feedback["characters"].as_array().unwrap().is_empty());
    let stats: Value =
        serde_json::from_slice(&fs::read(root.path().join("result/analysis.stats.json")).unwrap())
            .unwrap();
    assert_eq!(stats["requests"], 2);
    assert_eq!(stats["usage"].as_array().unwrap().len(), 2);
    assert_eq!(stats["repair_requests"], 1);
    assert_eq!(stats["repaired_windows"], 1);
    assert_eq!(stats["options"]["max_repairs_per_window"], 2);
    assert_eq!(stats["options"]["chapter_timeout"]["secs"], 30);
    assert_eq!(stats["prompt_version"], 9);
}

#[test]
fn exhausted_repairs_and_chapter_timeout_never_publish() {
    for timeout in [false, true] {
        let root = setup();
        let (endpoint, handle) = mock_sequence(if timeout {
            vec!["timeout"]
        } else {
            vec!["invalid", "invalid"]
        });
        envfile(root.path(), &endpoint);
        let mut cmd = command(root.path());
        if timeout {
            cmd.args(["--chapter-timeout-secs", "1", "--timeout-secs", "10"]);
        }
        let result = cmd.output().unwrap();
        assert!(!result.status.success());
        let error = String::from_utf8_lossy(&result.stderr);
        assert!(
            error.contains(if timeout {
                "chapter analysis timed out"
            } else {
                "repair exhausted"
            }),
            "{error}"
        );
        assert!(!error.contains("private-novel"));
        assert!(!root.path().join("result").exists());
        handle.join().unwrap();
    }
}

#[test]
fn zero_chapter_timeout_is_rejected_before_any_call_or_output() {
    let root = setup();
    envfile(root.path(), "http://127.0.0.1:1/");
    let result = command(root.path())
        .args(["--chapter-timeout-secs", "0"])
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("invalid analysis limits"));
    assert!(!root.path().join("result").exists());
}

#[test]
fn whole_book_append_correct_inspect_and_reanalysis_publish_complete_snapshots() {
    let root = setup();
    let (endpoint, server) = mock_sequence(vec!["identity", "identity", "identity"]);
    envfile(root.path(), &endpoint);
    assert!(command(root.path()).output().unwrap().status.success());
    let first: Value =
        serde_json::from_slice(&fs::read(root.path().join("result/book.json")).unwrap()).unwrap();
    let second = command_base(root.path())
        .args([
            "analyze",
            "--book",
            "test",
            "--chapter",
            "two",
            "--source",
            "input.txt",
            "--output",
            "second",
            "--book-file",
            "result/book.json",
            "--expected-revision",
            "1",
        ])
        .output()
        .unwrap();
    assert!(
        second.status.success(),
        "{}",
        String::from_utf8_lossy(&second.stderr)
    );
    let book: Value =
        serde_json::from_slice(&fs::read(root.path().join("second/book.json")).unwrap()).unwrap();
    assert_eq!(book["chapters"].as_array().unwrap().len(), 2);
    assert_eq!(book["registry"]["revision"], 2);
    assert_eq!(book["registry"]["characters"].as_array().unwrap().len(), 1);
    assert_eq!(
        book["registry"]["characters"][0]["id"],
        first["registry"]["characters"][0]["id"]
    );
    let c = &book["chapters"][1]["annotations"];
    let batch = json!({"book_id":"test","expected_revision":2,"corrections":[{"kind":"attribution","chapter_id":"two","source_sha256":c["source"]["sha256"],"segment_id":c["segments"][1]["id"],"expression_kind":"speech","attribution":{"status":"unknown","evidence_segment_ids":[],"review_status":"unreviewed"}}]});
    fs::write(root.path().join("corrections.json"), batch.to_string()).unwrap();
    assert!(
        command_base(root.path())
            .args([
                "correct",
                "--book-file",
                "second/book.json",
                "--corrections",
                "corrections.json",
                "--output",
                "corrected"
            ])
            .output()
            .unwrap()
            .status
            .success()
    );
    assert!(
        command_base(root.path())
            .args(["validate", "--book-file", "corrected/book.json"])
            .output()
            .unwrap()
            .status
            .success()
    );
    let inspected = command_base(root.path())
        .args([
            "inspect",
            "--book-file",
            "corrected/book.json",
            "--label",
            "张三",
            "--through",
            "ch",
        ])
        .output()
        .unwrap();
    assert!(inspected.status.success());
    let view: Value = serde_json::from_slice(&inspected.stdout).unwrap();
    assert_eq!(view["candidates"].as_array().unwrap().len(), 1);
    assert!(view["chapters"][0].get("text").is_none());
    let reanalyzed = command_base(root.path())
        .args([
            "analyze",
            "--book",
            "test",
            "--chapter",
            "two",
            "--source",
            "input.txt",
            "--output",
            "reanalyzed",
            "--book-file",
            "corrected/book.json",
            "--expected-revision",
            "3",
            "--reanalyze-last",
        ])
        .output()
        .unwrap();
    assert!(
        reanalyzed.status.success(),
        "{}",
        String::from_utf8_lossy(&reanalyzed.stderr)
    );
    let updated: Value =
        serde_json::from_slice(&fs::read(root.path().join("reanalyzed/book.json")).unwrap())
            .unwrap();
    assert_eq!(
        updated["chapters"][1]["annotations"]["segments"][1]["attribution"]["status"],
        "unknown"
    );
    assert_eq!(updated["registry"]["revision"], 4);
    let before = fs::read(root.path().join("corrected/book.json")).unwrap();
    assert!(
        !command_base(root.path())
            .args([
                "correct",
                "--book-file",
                "second/book.json",
                "--corrections",
                "corrections.json",
                "--output",
                "corrected"
            ])
            .output()
            .unwrap()
            .status
            .success()
    );
    assert_eq!(
        fs::read(root.path().join("corrected/book.json")).unwrap(),
        before
    );
    let payloads = server.join().unwrap();
    let input: Value =
        serde_json::from_str(payloads[1]["messages"][1]["content"].as_str().unwrap()).unwrap();
    assert_eq!(input["characters"][0]["id"], "c0");
}
#[test]
fn book_failures_stale_revisions_and_invalid_corrections_never_publish() {
    let root = setup();
    let (endpoint, server) = mock_sequence(vec!["identity", "invalid", "invalid"]);
    envfile(root.path(), &endpoint);
    assert!(command(root.path()).output().unwrap().status.success());
    let before = fs::read(root.path().join("result/book.json")).unwrap();
    let stale = command_base(root.path())
        .args([
            "analyze",
            "--book",
            "test",
            "--chapter",
            "two",
            "--source",
            "input.txt",
            "--output",
            "stale",
            "--book-file",
            "result/book.json",
            "--expected-revision",
            "99",
        ])
        .output()
        .unwrap();
    assert!(!stale.status.success());
    assert!(String::from_utf8_lossy(&stale.stderr).contains("revision conflict"));
    assert!(!root.path().join("stale").exists());
    let failed = command_base(root.path())
        .args([
            "analyze",
            "--book",
            "test",
            "--chapter",
            "two",
            "--source",
            "input.txt",
            "--output",
            "failed",
            "--book-file",
            "result/book.json",
            "--expected-revision",
            "1",
        ])
        .output()
        .unwrap();
    assert!(!failed.status.success());
    assert!(!root.path().join("failed").exists());
    assert_eq!(
        fs::read(root.path().join("result/book.json")).unwrap(),
        before
    );
    fs::write(root.path().join("bad.json"),json!({"book_id":"test","expected_revision":1,"corrections":[{"kind":"aliases","character_id":"missing","aliases":[],"evidence":[]}]}).to_string()).unwrap();
    assert!(
        !command_base(root.path())
            .args([
                "correct",
                "--book-file",
                "result/book.json",
                "--corrections",
                "bad.json",
                "--output",
                "bad-output"
            ])
            .output()
            .unwrap()
            .status
            .success()
    );
    assert!(!root.path().join("bad-output").exists());
    server.join().unwrap();
}

#[test]
fn safe_failure_report_preserves_error_usage_and_never_overwrites() {
    let root = setup();
    let (endpoint, handle) = mock_sequence(vec!["invalid", "invalid"]);
    envfile(root.path(), &endpoint);
    let output = command(root.path())
        .args(["--failure-report", "failure.json"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    handle.join().unwrap();
    let bytes = fs::read(root.path().join("failure.json")).unwrap();
    let d: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(d["format_version"], 1);
    assert_eq!(d["category"], "invalid_json");
    assert_eq!(d["stats"]["requests"], 2);
    assert_eq!(d["stats"]["repair_requests"], 1);
    assert_eq!(d["stats"]["usage"][0]["input"], 10);
    assert!(d["stats"]["usage"][0]["reasoning"].is_null());
    assert!(!String::from_utf8_lossy(&bytes).contains("private-novel-invalid"));
    assert!(!String::from_utf8_lossy(&bytes).contains("test-key"));
    assert!(!root.path().join("result").exists());
    let output = command(root.path())
        .args(["--failure-report", "failure.json"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(fs::read(root.path().join("failure.json")).unwrap(), bytes);
}
#[test]
fn failure_report_io_error_preserves_analysis_error_and_success_writes_no_report() {
    let root = setup();
    let (endpoint, handle) = mock("valid");
    envfile(root.path(), &endpoint);
    assert!(
        command(root.path())
            .args(["--failure-report", "success.json"])
            .output()
            .unwrap()
            .status
            .success()
    );
    handle.join().unwrap();
    assert!(!root.path().join("success.json").exists());
    let root = setup();
    let (endpoint, handle) = mock_sequence(vec!["invalid", "invalid"]);
    envfile(root.path(), &endpoint);
    let output = command(root.path())
        .args(["--failure-report", "absent/failure.json"])
        .output()
        .unwrap();
    handle.join().unwrap();
    assert!(!output.status.success());
    let text = String::from_utf8(output.stderr).unwrap();
    assert!(text.contains("Failure report could not be written"));
    assert!(text.contains("invalid JSON syntax"));
}

#[test]
fn run_and_resume_both_report_uncommitted_failure_statistics() {
    let root = setup();
    let (endpoint, handle) = mock_sequence(vec!["invalid", "invalid", "invalid", "invalid"]);
    envfile(root.path(), &endpoint);
    run_plan(root.path(), &endpoint);
    for (command, report) in [
        ("run", "run.failure.json"),
        ("resume", "resume.failure.json"),
    ] {
        let mut cmd = command_base(root.path());
        cmd.args([command, "--run-dir", "journal", "--failure-report", report]);
        if command == "run" {
            cmd.args(["--plan", "plan.json"]);
        }
        assert!(!cmd.output().unwrap().status.success());
        let d: Value =
            serde_json::from_slice(&fs::read(root.path().join(report)).unwrap()).unwrap();
        assert_eq!(d["stats"]["requests"], 2);
        assert_eq!(d["category"], "invalid_json");
        assert!(!root.path().join("journal/commits/00000001").exists());
    }
    handle.join().unwrap();
}
