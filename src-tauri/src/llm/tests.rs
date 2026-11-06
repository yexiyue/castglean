use super::{config::LlmState, credentials::Credentials, types::*};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Default)]
struct Vault {
    values: Mutex<HashMap<String, String>>,
    locked: AtomicBool,
}
impl Credentials for Vault {
    fn get(&self, r: &str) -> Result<String, LlmError> {
        if self.locked.load(Ordering::SeqCst) {
            return Err(LlmError::CredentialUnavailable);
        }
        self.values
            .lock()
            .unwrap()
            .get(r)
            .cloned()
            .ok_or(LlmError::CredentialUnavailable)
    }
    fn set(&self, r: &str, secret: &str) -> Result<(), LlmError> {
        if self.locked.load(Ordering::SeqCst) {
            return Err(LlmError::CredentialUnavailable);
        }
        self.values
            .lock()
            .unwrap()
            .insert(r.to_owned(), secret.to_owned());
        Ok(())
    }
    fn delete(&self, r: &str) -> Result<(), LlmError> {
        if self.locked.load(Ordering::SeqCst) {
            return Err(LlmError::CredentialUnavailable);
        }
        self.values.lock().unwrap().remove(r);
        Ok(())
    }
}
fn change() -> ConnectionChange {
    ConnectionChange {
        id: None,
        expected_revision: None,
        name: "Test".into(),
        protocol: LlmProtocol::Openai,
        endpoint: "https://example.com/v1".into(),
        models: vec![LlmModel {
            id: "model".into(),
            model_id: "same".into(),
            name: "Model".into(),
        }],
        credential: CredentialChange::Replace("private-test-key".into()),
    }
}

#[test]
fn secret_is_not_in_configuration_or_snapshot_and_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm.json");
    let vault = Arc::new(Vault::default());
    let state = Arc::new(LlmState::open(path.clone(), vault.clone()).unwrap());
    let snapshot = state.update(change()).unwrap();
    assert!(
        !std::fs::read_to_string(&path)
            .unwrap()
            .contains("private-test-key")
    );
    assert!(
        !serde_json::to_string(&snapshot)
            .unwrap()
            .contains("private-test-key")
    );
    let restored = Arc::new(LlmState::open(path, vault).unwrap());
    assert_eq!(
        restored
            .acquire(&ModelSelection {
                connection_id: snapshot.connections[0].id.clone(),
                model_id: "model".into()
            })
            .unwrap()
            .key()
            .unwrap(),
        "private-test-key"
    );
}

#[test]
fn lease_blocks_configuration_changes_but_not_default_changes() {
    let dir = tempfile::tempdir().unwrap();
    let state =
        Arc::new(LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap());
    let snapshot = state.update(change()).unwrap();
    let c = &snapshot.connections[0];
    let selection = ModelSelection {
        connection_id: c.id.clone(),
        model_id: "model".into(),
    };
    let lease = state.acquire(&selection).unwrap();
    assert!(state.set_default(Some(selection)).is_ok());
    assert!(matches!(
        state.delete(&c.id, c.revision),
        Err(LlmError::Busy)
    ));
    let mut update = change();
    update.id = Some(c.id.clone());
    update.expected_revision = Some(c.revision);
    assert!(matches!(state.update(update), Err(LlmError::Busy)));
    drop(lease);
    assert_eq!(state.active(), 0);
    assert!(
        state
            .delete(&c.id, c.revision)
            .unwrap()
            .connections
            .is_empty()
    );
}

#[test]
fn locked_vault_does_not_replace_old_connection_or_fall_back_to_no_key() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Arc::new(Vault::default());
    let state = Arc::new(LlmState::open(dir.path().join("llm.json"), vault.clone()).unwrap());
    let snapshot = state.update(change()).unwrap();
    let c = &snapshot.connections[0];
    vault.locked.store(true, Ordering::SeqCst);
    let mut update = change();
    update.id = Some(c.id.clone());
    update.expected_revision = Some(c.revision);
    update.endpoint = "https://another.example/v1".into();
    assert!(matches!(
        state.update(update),
        Err(LlmError::CredentialUnavailable)
    ));
    assert_eq!(
        state.snapshot().unwrap().connections[0].endpoint,
        c.endpoint
    );
    assert_eq!(
        state
            .acquire(&ModelSelection {
                connection_id: c.id.clone(),
                model_id: "model".into()
            })
            .unwrap()
            .key(),
        Err(LlmError::CredentialUnavailable)
    );
    vault.locked.store(false, Ordering::SeqCst);
    state.cleanup().unwrap();
    assert!(!state.snapshot().unwrap().cleanup_required);
}

#[test]
fn stale_writer_and_invalid_models_cannot_overwrite_saved_configuration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm.json");
    let vault = Arc::new(Vault::default());
    let a = LlmState::open(path.clone(), vault.clone()).unwrap();
    let b = LlmState::open(path.clone(), vault).unwrap();
    a.update(change()).unwrap();
    let before = std::fs::read(&path).unwrap();
    assert!(matches!(b.update(change()), Err(LlmError::Conflict)));
    let mut invalid = change();
    invalid.models.push(invalid.models[0].clone());
    assert!(matches!(
        a.update(invalid),
        Err(LlmError::InvalidConfiguration)
    ));
    assert_eq!(std::fs::read(path).unwrap(), before);
}

#[test]
fn revision_invalidates_old_probe_and_connections_separate_same_model() {
    let dir = tempfile::tempdir().unwrap();
    let state = LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap();
    let c = state.update(change()).unwrap().connections.remove(0);
    let selection = ModelSelection {
        connection_id: c.id.clone(),
        model_id: "model".into(),
    };
    state
        .record_probe(
            &selection,
            ProbeResult {
                model_id: "model".into(),
                kind: ProbeKind::Connection,
                revision: c.revision,
                tested_at: crate::timestamp::unix_seconds(),
                failure: None,
            },
        )
        .unwrap();
    let mut update = change();
    update.id = Some(c.id.clone());
    update.expected_revision = Some(c.revision);
    update.credential = CredentialChange::Keep;
    update.endpoint = "https://other.example/v1".into();
    let updated = state.update(update).unwrap();
    assert_ne!(
        updated.connections[0].revision,
        updated.connections[0].probes[0].revision
    );
    assert_eq!(state.update(change()).unwrap().connections.len(), 2);
}

struct Fixture {
    endpoint: String,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Fixture {
    fn new(
        reply: impl Fn(usize, &str, &serde_json::Value) -> (u16, serde_json::Value) + Send + 'static,
    ) -> Self {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let worker = std::thread::spawn(move || {
            let mut index = 0;
            while !flag.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(v) => v,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                        continue;
                    }
                    Err(_) => break,
                };
                // Accepted sockets can inherit the listener's nonblocking mode on BSD.
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 8192];
                let mut header_end = None;
                let mut length = 0;
                loop {
                    let n = match stream.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => n,
                    };
                    bytes.extend_from_slice(&buffer[..n]);
                    if header_end.is_none()
                        && let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n")
                    {
                        header_end = Some(pos + 4);
                        length = String::from_utf8_lossy(&bytes[..pos])
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                    }
                    if header_end.is_some_and(|pos| bytes.len() >= pos + length) {
                        break;
                    }
                    if bytes.len() > 256 * 1024 {
                        break;
                    }
                }
                let Some(pos) = header_end else {
                    continue;
                };
                let head = String::from_utf8_lossy(&bytes[..pos]).into_owned();
                let body = serde_json::from_slice(&bytes[pos..]).unwrap_or(serde_json::Value::Null);
                let (status, reply) = reply(index, &head, &body);
                index += 1;
                let body = serde_json::to_vec(&reply).unwrap();
                let header = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(header.as_bytes()).unwrap();
                stream.write_all(&body).unwrap();
                // Finish the response before closing the read half. Closing with
                // unread request bytes can reset the socket and lose the reply.
                let _ = stream.shutdown(std::net::Shutdown::Write);
                let mut remaining = [0; 1024];
                while matches!(stream.read(&mut remaining), Ok(n) if n > 0) {}
            }
        });
        Self {
            endpoint,
            stop,
            worker: Some(worker),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            worker.join().unwrap();
        }
    }
}

fn provider_reply(protocol: LlmProtocol, text: &str) -> serde_json::Value {
    use serde_json::json;
    match protocol {
        LlmProtocol::Openai => {
            json!({"id":"test","object":"chat.completion","model":"same","choices":[{"index":0,"message":{"role":"assistant","content":text},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}})
        }
        LlmProtocol::Anthropic => {
            json!({"id":"test","type":"message","role":"assistant","model":"same","content":[{"type":"text","text":text}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}})
        }
        LlmProtocol::Gemini => {
            json!({"candidates":[{"content":{"role":"model","parts":[{"text":text}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}})
        }
    }
}

#[tokio::test]
async fn all_protocols_use_their_native_paths_and_validate_structured_output() {
    for protocol in [
        LlmProtocol::Openai,
        LlmProtocol::Anthropic,
        LlmProtocol::Gemini,
    ] {
        let fixture = Fixture::new(move |index, head, _body| {
            assert!(match protocol {
                LlmProtocol::Openai => head.contains("/v1/chat/completions"),
                LlmProtocol::Anthropic => head.contains("/v1/messages"),
                LlmProtocol::Gemini => head.contains("generateContent"),
            });
            (
                200,
                provider_reply(protocol, if index == 0 { "OK" } else { "{\"ok\":true}" }),
            )
        });
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(
            LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap(),
        );
        let mut c = change();
        c.protocol = protocol;
        c.endpoint = if protocol == LlmProtocol::Openai {
            format!("{}/v1", fixture.endpoint)
        } else {
            fixture.endpoint.clone()
        };
        let saved = state.update(c).unwrap();
        let lease = state
            .acquire(&ModelSelection {
                connection_id: saved.connections[0].id.clone(),
                model_id: "model".into(),
            })
            .unwrap();
        super::providers::probe(&lease, ProbeKind::Connection)
            .await
            .unwrap_or_else(|error| panic!("{protocol:?} text probe: {error:?}"));
        super::providers::probe(&lease, ProbeKind::Structured)
            .await
            .unwrap_or_else(|error| panic!("{protocol:?} structured probe: {error:?}"));
    }
}

#[tokio::test]
async fn authentication_errors_do_not_include_service_body_or_key() {
    let fixture = Fixture::new(|_, _, _| {
        (
            401,
            serde_json::json!({"error":"private-test-key private novel text"}),
        )
    });
    let dir = tempfile::tempdir().unwrap();
    let state =
        Arc::new(LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap());
    let mut c = change();
    c.endpoint = fixture.endpoint.clone();
    let saved = state.update(c).unwrap();
    let lease = state
        .acquire(&ModelSelection {
            connection_id: saved.connections[0].id.clone(),
            model_id: "model".into(),
        })
        .unwrap();
    assert_eq!(
        super::providers::probe(&lease, ProbeKind::Connection).await,
        Err(LlmError::Authentication)
    );
}

#[tokio::test]
async fn all_protocols_complete_a_real_local_tool_roundtrip() {
    use serde_json::json;
    for protocol in [
        LlmProtocol::Openai,
        LlmProtocol::Anthropic,
        LlmProtocol::Gemini,
    ] {
        let fixture = Fixture::new(move |index, _, body| {
            if index == 0 {
                let value = match protocol {
                    LlmProtocol::Openai => {
                        json!({"id":"test","object":"chat.completion","model":"same","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call-1","type":"function","function":{"name":"connection_probe","arguments":"{}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}})
                    }
                    LlmProtocol::Anthropic => {
                        json!({"id":"test","type":"message","role":"assistant","model":"same","content":[{"type":"tool_use","id":"call-1","name":"connection_probe","input":{}}],"stop_reason":"tool_use","usage":{"input_tokens":1,"output_tokens":1}})
                    }
                    LlmProtocol::Gemini => {
                        json!({"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"id":"call-1","name":"connection_probe","args":{}}}]},"finishReason":"STOP"}]})
                    }
                };
                (200, value)
            } else {
                assert_eq!(index, 1, "probe must not retry implicitly");
                let serialized = body.to_string();
                static TOKEN: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
                    regex::Regex::new(
                        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                    )
                    .unwrap()
                });
                let token = TOKEN.find(&serialized).unwrap().as_str().to_owned();
                (200, provider_reply(protocol, &token))
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(
            LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap(),
        );
        let mut c = change();
        c.protocol = protocol;
        c.endpoint = if protocol == LlmProtocol::Openai {
            format!("{}/v1", fixture.endpoint)
        } else {
            fixture.endpoint.clone()
        };
        let saved = state.update(c).unwrap();
        let lease = state
            .acquire(&ModelSelection {
                connection_id: saved.connections[0].id.clone(),
                model_id: "model".into(),
            })
            .unwrap();
        super::providers::probe(&lease, ProbeKind::Tools)
            .await
            .unwrap_or_else(|error| panic!("{protocol:?}: {error:?}"));
    }
}

#[tokio::test]
async fn a_text_claim_is_not_tool_support_and_oversized_response_is_rejected() {
    let fixture =
        Fixture::new(|_, _, _| (200, provider_reply(LlmProtocol::Openai, "I support tools")));
    let dir = tempfile::tempdir().unwrap();
    let state =
        Arc::new(LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap());
    let mut c = change();
    c.endpoint = fixture.endpoint.clone();
    let saved = state.update(c).unwrap();
    let lease = state
        .acquire(&ModelSelection {
            connection_id: saved.connections[0].id.clone(),
            model_id: "model".into(),
        })
        .unwrap();
    assert_eq!(
        super::providers::probe(&lease, ProbeKind::Tools).await,
        Err(LlmError::CapabilityUnavailable)
    );
    let large = Fixture::new(|_, _, _| {
        (
            200,
            provider_reply(LlmProtocol::Openai, &"x".repeat(256 * 1024)),
        )
    });
    drop(lease);
    let mut c = change();
    c.endpoint = large.endpoint.clone();
    let saved = state.update(c).unwrap();
    let connection = saved
        .connections
        .iter()
        .find(|c| c.endpoint == large.endpoint)
        .unwrap();
    let lease = state
        .acquire(&ModelSelection {
            connection_id: connection.id.clone(),
            model_id: "model".into(),
        })
        .unwrap();
    assert!(
        super::providers::probe(&lease, ProbeKind::Connection)
            .await
            .is_err()
    );
}

/// Explicit opt-in; secrets come from the process environment and are never printed.
#[tokio::test]
#[ignore = "requires an explicitly configured external model"]
async fn configured_service_probes() {
    let endpoint = std::env::var("CASTGLEAN_TEST_LLM_ENDPOINT").expect("endpoint");
    let model = std::env::var("CASTGLEAN_TEST_LLM_MODEL").expect("model");
    let key = std::env::var("CASTGLEAN_TEST_LLM_KEY").expect("key");
    let dir = tempfile::tempdir().unwrap();
    let state =
        Arc::new(LlmState::open(dir.path().join("llm.json"), Arc::new(Vault::default())).unwrap());
    let mut c = change();
    c.endpoint = endpoint;
    c.models[0].model_id = model;
    c.credential = CredentialChange::Replace(key);
    let saved = state.update(c).unwrap();
    let lease = state
        .acquire(&ModelSelection {
            connection_id: saved.connections[0].id.clone(),
            model_id: "model".into(),
        })
        .unwrap();
    for kind in [
        ProbeKind::Connection,
        ProbeKind::Tools,
        ProbeKind::Structured,
    ] {
        let result = super::providers::probe(&lease, kind).await;
        eprintln!("{kind:?}: {result:?}");
        assert!(result.is_ok());
    }
}
