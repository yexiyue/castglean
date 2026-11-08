//! Local HTTP protocol fixture shared by transport and real agent-loop tests.
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub(crate) fn configured(
    endpoint: &str,
) -> (
    tempfile::TempDir,
    Arc<super::LlmState>,
    super::ModelSelection,
    u32,
) {
    use super::types::*;
    struct EmptyVault;
    impl super::credentials::Credentials for EmptyVault {
        fn get(&self, _: &str) -> Result<String, LlmError> {
            Err(LlmError::CredentialUnavailable)
        }
        fn set(&self, _: &str, _: &str) -> Result<(), LlmError> {
            Err(LlmError::CredentialUnavailable)
        }
        fn delete(&self, _: &str) -> Result<(), LlmError> {
            Ok(())
        }
    }
    let root = tempfile::tempdir().unwrap();
    let state = Arc::new(
        super::LlmState::open(root.path().join("llm.json"), Arc::new(EmptyVault)).unwrap(),
    );
    let (selection, revision) = add_connection(&state, endpoint);
    (root, state, selection, revision)
}

pub(crate) fn add_connection(
    state: &Arc<super::LlmState>,
    endpoint: &str,
) -> (super::ModelSelection, u32) {
    use super::types::*;
    let connection = state
        .update(ConnectionChange {
            id: None,
            expected_revision: None,
            name: "Local fixture".into(),
            protocol: LlmProtocol::Openai,
            endpoint: format!("{endpoint}/v1"),
            models: vec![LlmModel {
                context_window: None,
                max_output_tokens: None,
                id: "model".into(),
                model_id: "test".into(),
                name: "Test".into(),
            }],
            credential: CredentialChange::Keep,
        })
        .unwrap()
        .connections
        .into_iter()
        .find(|c| c.endpoint == format!("{endpoint}/v1"))
        .unwrap();
    let selection = ModelSelection {
        connection_id: connection.id,
        model_id: "model".into(),
    };
    (selection, connection.revision)
}

pub(crate) struct Fixture {
    pub(crate) endpoint: String,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Fixture {
    pub(crate) fn new(
        reply: impl Fn(usize, &str, &serde_json::Value) -> (u16, serde_json::Value) + Send + 'static,
    ) -> Self {
        Self::raw(move |index, head, body| {
            let (status, value) = reply(index, head, body);
            (
                status,
                "application/json",
                serde_json::to_vec(&value).unwrap(),
            )
        })
    }
    pub(crate) fn raw(
        reply: impl Fn(usize, &str, &serde_json::Value) -> (u16, &'static str, Vec<u8>) + Send + 'static,
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
                let (status, content_type, body) = reply(index, &head, &body);
                index += 1;
                let header = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                if stream
                    .write_all(header.as_bytes())
                    .and_then(|()| stream.write_all(&body))
                    .is_err()
                {
                    continue; // A cancelled client may close before this delayed fixture replies.
                }
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

/// Opt-in public-text acceptance, using an anonymous endpoint explicitly supplied by the caller.
pub(crate) fn configured_with_model(
    endpoint: &str,
    model_id: &str,
) -> (
    tempfile::TempDir,
    Arc<super::LlmState>,
    super::ModelSelection,
    u32,
) {
    use super::types::*;
    let (root, state, selection, revision) = configured(endpoint);
    let snapshot = state
        .update(ConnectionChange {
            id: Some(selection.connection_id.clone()),
            expected_revision: Some(revision),
            name: "Public text acceptance".into(),
            endpoint: format!("{endpoint}/v1"),
            protocol: LlmProtocol::Openai,
            models: vec![LlmModel {
                id: selection.model_id.clone(),
                model_id: model_id.into(),
                name: "Selected acceptance model".into(),
                context_window: None,
                max_output_tokens: None,
            }],
            credential: CredentialChange::Keep,
        })
        .unwrap();
    let revision = snapshot
        .connections
        .iter()
        .find(|c| c.id == selection.connection_id)
        .unwrap()
        .revision;
    (root, state, selection, revision)
}

/// Explicit opt-in experiment: read configuration and native credential without mutating either.
pub(crate) struct ExperimentBinding {
    pub model: rig_core::DynModel<rig_core::operation::Completion>,
    pub model_id: String,
    pub configuration: crate::ai::Configuration,
    pub capacity: (Option<u32>, Option<u32>),
    _connection: super::config::ConnectionLease,
}

pub(crate) fn experiment_binding(input: &serde_json::Value) -> ExperimentBinding {
    let state = Arc::new(
        super::LlmState::open(
            std::path::PathBuf::from(input["configPath"].as_str().unwrap()),
            Arc::new(super::credentials::SystemCredentials),
        )
        .unwrap(),
    );
    let selection = serde_json::from_value(input["selection"].clone()).unwrap();
    let lease = state.acquire_for_run(&selection).unwrap();
    let model = super::configured_model(&lease, Some(Arc::new(|_| Ok(())))).unwrap();
    ExperimentBinding {
        model,
        model_id: lease.model.model_id.clone(),
        configuration: crate::ai::Configuration {
            selection,
            revision: lease.connection.revision,
        },
        capacity: (lease.model.context_window, lease.model.max_output_tokens),
        _connection: lease,
    }
}

pub(crate) async fn experiment_call(input: &serde_json::Value) -> serde_json::Value {
    use rig_core::completion::CompletionRequest;
    use serde_json::json;
    let state = Arc::new(
        super::LlmState::open(
            std::path::PathBuf::from(input["configPath"].as_str().unwrap()),
            Arc::new(super::credentials::SystemCredentials),
        )
        .unwrap(),
    );
    let selection = serde_json::from_value(input["selection"].clone()).unwrap();
    let lease = state.acquire_for_run(&selection).unwrap();
    // A run accounting hook selects the 600s background HTTP transport, even in experiments.
    let model = super::configured_model(&lease, Some(Arc::new(|_| Ok(())))).unwrap();
    let mut request = CompletionRequest::new(input["user"].as_str().unwrap())
        .preamble(input["system"].as_str().unwrap())
        .output_schema(schemars::Schema::try_from(input["schema"].clone()).unwrap());
    if input["low"] == true {
        request = request.additional_params(json!({"reasoning_effort":"low"}));
    }
    let started = std::time::Instant::now();
    match super::complete(&model, request).await {
        Ok(response) => json!({"ok":true,"elapsedMs":started.elapsed().as_millis(),
            "text":response.text(),"usage":response.usage,"model":lease.model.model_id}),
        Err(error) => {
            json!({"ok":false,"elapsedMs":started.elapsed().as_millis(),"error":error.to_string()})
        }
    }
}

// Deliberately task-local: only explicitly opted-in acceptance/experiments capture bodies.
tokio::task_local! { pub(crate) static PUBLIC_ACCEPTANCE: bool; }
pub(crate) fn public_diagnostic(stage: &str, value: &[u8]) {
    if PUBLIC_ACCEPTANCE
        .try_with(|enabled| *enabled)
        .unwrap_or(false)
    {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/workbench-acceptance/public-model");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(format!("{stage}.txt")), value).unwrap();
    }
}
