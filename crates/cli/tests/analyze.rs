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

fn command(root: &Path) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_castglean"));
    cmd.current_dir(root)
        .env_remove("MODEL")
        .env_remove("API_BASE_URL")
        .env_remove("BIGMODEL_API_KEY")
        .env_remove("REASONING_EFFORT")
        .env_remove("OUTPUT_MODE")
        .args([
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
        let input: Value =
            serde_json::from_str(payload["messages"][1]["content"].as_str().unwrap()).unwrap();
        let segments: Vec<_> = input["segments"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["target"] == true)
            .map(|s| json!({"segment_id":s["id"],"kind":"narration","attribution":null}))
            .collect();
        let content = if mode == "invalid" {
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
    assert_eq!(stats["prompt_version"], 2);
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
