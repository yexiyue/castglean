//! Local HTTP protocol fixture shared by transport and real agent-loop tests.
use std::sync::{
    Arc, Mutex,
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
    let unlimited_time = input["unlimitedTime"] == true;
    let reasoning = input["reasoningEffort"]
        .as_str()
        .unwrap_or(if input["low"] == true {
            "low"
        } else {
            "default"
        });
    let requested_reasoning = match experiment_reasoning(reasoning) {
        Ok(value) => value,
        Err(code) => return json!({"ok":false,"error":code}),
    };
    let (model, facts) = if input["unlimitedTokens"] == true || unlimited_time {
        match experiment_completion_model(&lease, unlimited_time) {
            Ok((model, facts)) => (model, Some(facts)),
            Err(code) => return json!({"ok":false,"error":code}),
        }
    } else {
        (
            super::configured_model(&lease, Some(Arc::new(|_| Ok(())))).unwrap(),
            None,
        )
    };
    let mut request = CompletionRequest::new(input["user"].as_str().unwrap())
        .preamble(input["system"].as_str().unwrap())
        .output_schema(schemars::Schema::try_from(input["schema"].clone()).unwrap());
    request.options.reasoning = requested_reasoning;
    let started = std::time::Instant::now();
    let response = if unlimited_time {
        model.call(request).await.map_err(super::providers::failure)
    } else {
        super::complete(&model, request).await
    };
    let wire_facts = facts
        .as_ref()
        .map(|facts| facts.lock().unwrap_or_else(|e| e.into_inner()).clone());
    match response {
        Ok(response) => json!({"ok":true,"elapsedMs":started.elapsed().as_millis(),
            "text":response.text(),"usage":response.usage,"model":lease.model.model_id,
            "finishReason":response.finish_reason().map(|r|format!("{r:?}")),"maxOutputTokens":null,"wallMs":if unlimited_time {None}else{Some(600000)},"reasoningEffort":reasoning,"wireFacts":wire_facts}),
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

/// Full-fidelity test-only completion relay. No credential, endpoint or provider override
/// is accepted from the job: only a selection in the native non-secret config.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompletionJob {
    op: String,
    config_path: std::path::PathBuf,
    selection: super::ModelSelection,
    configuration_hash: String,
    #[serde(default)]
    unlimited_tokens: bool,
    #[serde(default)]
    unlimited_time: bool,
    #[serde(default = "default_experiment_reasoning")]
    reasoning_effort: String,
    request: rig_core::completion::CompletionRequest,
}

fn default_experiment_reasoning() -> String {
    "low".into()
}
fn experiment_reasoning(
    value: &str,
) -> Result<Option<rig_core::completion::Reasoning>, &'static str> {
    use rig_core::completion::{Effort, Reasoning};
    match value {
        "low" => Ok(Some(Reasoning::Effort(Effort::Low))),
        "default" => Ok(None),
        _ => Err("invalid_reasoning_profile"),
    }
}

fn completion_token_policy_valid(
    unlimited: bool,
    requested: Option<u64>,
    configured: Option<u32>,
) -> bool {
    if unlimited {
        requested.is_none()
    } else {
        requested.is_some_and(|n| n > 0 && n <= 4096 && n <= u64::from(configured.unwrap_or(4096)))
    }
}

fn experiment_completion_model(
    lease: &super::config::ConnectionLease,
    unlimited_time: bool,
) -> Result<
    (
        rig_core::DynModel<rig_core::operation::Completion>,
        Arc<Mutex<serde_json::Value>>,
    ),
    &'static str,
> {
    use rig_core::providers::{
        anthropic::AnthropicConfig, gemini::GeminiConfig, openai::OpenAIConfig,
    };
    let transport = CompletionHttp::with_time_policy(&lease.connection.endpoint, unlimited_time)?;
    let facts = transport.facts.clone();
    let key = lease.key().map_err(|_| "native_credential")?;
    let endpoint = &lease.connection.endpoint;
    let id = &lease.model.model_id;
    let model = match lease.connection.protocol {
        super::types::LlmProtocol::Openai => OpenAIConfig::new(key)
            .with_base_url(endpoint)
            .connect(transport)
            .chat(id)
            .erase(),
        super::types::LlmProtocol::Anthropic => AnthropicConfig::new(key)
            .with_base_url(endpoint)
            .connect(transport)
            .completion(id)
            .erase(),
        super::types::LlmProtocol::Gemini => GeminiConfig::new(key)
            .with_base_url(endpoint)
            .connect(transport)
            .completion(id)
            .erase(),
    };
    Ok((model, facts))
}

fn completion_overrides(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(fields) => fields.iter().any(|(key, value)| {
            let key = key.replace(['_', '-'], "").to_ascii_lowercase();
            matches!(
                key.as_str(),
                "apikey"
                    | "authorization"
                    | "credential"
                    | "credentials"
                    | "credentialref"
                    | "endpoint"
                    | "baseurl"
                    | "headers"
                    | "configpath"
                    | "model"
                    | "maxtokens"
                    | "maxcompletiontokens"
                    | "maxoutputtokens"
                    | "reasoning"
                    | "reasoningeffort"
                    | "thinking"
                    | "thinkingconfig"
            ) || completion_overrides(value)
        }),
        serde_json::Value::Array(items) => items.iter().any(completion_overrides),
        _ => false,
    }
}

pub(crate) async fn experiment_completion(input: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    let result = async {
        let job: CompletionJob =
            serde_json::from_value(input.clone()).map_err(|_| "invalid_completion_job")?;
        if job.op != "completion"
            || !job.config_path.is_absolute()
            || job
                .request
                .additional_params
                .as_ref()
                .is_some_and(completion_overrides)
            || completion_overrides(
                &serde_json::to_value(&job.request.provider_options)
                    .map_err(|_| "invalid_provider_options")?,
            )
        {
            return Err("completion_override_rejected");
        }
        let requested_reasoning=experiment_reasoning(&job.reasoning_effort)?;
        let state = Arc::new(
            super::LlmState::open(
                job.config_path,
                Arc::new(super::credentials::SystemCredentials),
            )
            .map_err(|_| "native_configuration")?,
        );
        let lease = state
            .acquire_for_run(&job.selection)
            .map_err(|_| "native_selection")?;
        let configuration = crate::ai::Configuration {
            selection: job.selection,
            revision: lease.connection.revision,
        };
        let configuration_hash = crate::project::hash(
            &serde_json::to_vec(&json!({
                "configuration":configuration,
                "capacity":[lease.model.context_window,lease.model.max_output_tokens],
                "model":lease.model.model_id,"reasoning":job.reasoning_effort
            }))
            .map_err(|_| "native_hash")?,
        );
        if configuration_hash != job.configuration_hash
            || job
                .request
                .model
                .as_deref()
                .is_some_and(|id| id != lease.model.model_id)
            || job.request.options.reasoning != requested_reasoning
            || !completion_token_policy_valid(
                job.unlimited_tokens,
                job.request.max_tokens,
                lease.model.max_output_tokens,
            )
        {
            return Err("completion_binding_or_limits");
        }
        // Explicitly disable reqwest's default protocol-NACK retries for this new op.
        let (model,facts) = experiment_completion_model(&lease,job.unlimited_time)?;
        let response = if job.unlimited_time { model.call(job.request).await.map_err(|_|"completion_provider_failed")? } else {
            tokio::time::timeout(std::time::Duration::from_secs(600), model.call(job.request))
                .await
                .map_err(|_| "completion_timeout")?
                .map_err(|_| "completion_provider_failed")?
        };
        if response.error.is_some() || response.aborted.is_some() {
            return Err("completion_response_failed");
        }
        Ok(json!({"ok":true,"model":lease.model.model_id,
            "configurationHash":configuration_hash,"wireFacts":facts.lock().unwrap_or_else(|e|e.into_inner()).clone(),"response":response}))
    }
    .await;
    result.unwrap_or_else(|code| json!({"ok":false,"error":code}))
}

#[test]
fn completion_unlimited_policy_omits_output_override_only_when_explicit() {
    assert!(completion_token_policy_valid(true, None, Some(2048)));
    assert!(!completion_token_policy_valid(false, None, None));
    assert!(!completion_token_policy_valid(true, Some(4096), None));
    assert!(completion_token_policy_valid(false, Some(4096), None));
    assert!(!completion_token_policy_valid(false, Some(4097), None));
    assert!(!completion_token_policy_valid(
        false,
        Some(4096),
        Some(2048)
    ));
}

#[test]
fn completion_job_rejects_credential_and_limit_overrides() {
    use serde_json::json;
    for value in [
        json!({"api_key":"private"}),
        json!({"headers":{"Authorization":"private"}}),
        json!({"max_tokens":9000}),
        json!({"reasoning_effort":"high"}),
        json!({"baseURL":"http://invalid"}),
    ] {
        assert!(completion_overrides(&value));
    }
    assert!(!completion_overrides(&json!({"frequency_penalty":0.2})));
}

/// Test-only transport: no redirect/retry, one send, bounded request and response.
fn request_facts(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    let messages = value["messages"].as_array();
    json!({"reasoningEffort":value["reasoning_effort"].as_str(),
        "maxTokens":value["max_tokens"].as_u64(),"maxCompletionTokens":value["max_completion_tokens"].as_u64(),
        "thinkingType":value["thinking"]["type"].as_str(),"stream":value["stream"].as_bool(),
        "toolsCount":value["tools"].as_array().map(Vec::len),"messagesCount":messages.map(Vec::len),
        "historyReasoningMessages":messages.map(|m|m.iter().filter(|m|m["reasoning_content"].as_str().is_some_and(|s|!s.is_empty())).count())})
}
fn response_facts(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    let message = &value["choices"][0]["message"];
    json!({"reasoningContentPresent":message.get("reasoning_content").is_some(),
        "reasoningContentChars":message["reasoning_content"].as_str().map(|s|s.chars().count()),
        "reasoningTokens":value["usage"]["completion_tokens_details"]["reasoning_tokens"].as_u64(),
        "finishReason":value["choices"][0]["finish_reason"].as_str(),
        "toolCallsCount":message["tool_calls"].as_array().map(Vec::len)})
}

#[test]
fn experiment_wire_facts_do_not_capture_source_credentials_or_reasoning_text() {
    use serde_json::json;
    let request = request_facts(
        &json!({"reasoning_effort":"low","messages":[{"content":"private source","reasoning_content":"private reasoning"}],"api_key":"private key","tools":[]}),
    );
    let response = response_facts(
        &json!({"choices":[{"message":{"content":"private answer","reasoning_content":"private reasoning"},"finish_reason":"tool_calls"}],"usage":{"completion_tokens_details":{"reasoning_tokens":3}}}),
    );
    assert_eq!(request["reasoningEffort"], "low");
    assert_eq!(request["historyReasoningMessages"], 1);
    assert_eq!(response["reasoningTokens"], 3);
    assert!(!format!("{request}{response}").contains("private"));
    assert_eq!(experiment_reasoning("default").unwrap(), None);
    assert!(experiment_reasoning("disabled").is_err());
}

#[derive(Clone)]
struct CompletionHttp {
    client: rig_reqwest::ReqwestClient,
    sent: Arc<AtomicBool>,
    facts: Arc<Mutex<serde_json::Value>>,
}
impl CompletionHttp {
    fn with_time_policy(endpoint: &str, unlimited_time: bool) -> Result<Self, &'static str> {
        use rig_reqwest::reqwest;
        let endpoint = url::Url::parse(endpoint).map_err(|_| "native_endpoint")?;
        let mut builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never());
        if !unlimited_time {
            builder = builder
                .connect_timeout(std::time::Duration::from_secs(15))
                .timeout(std::time::Duration::from_secs(600));
        }
        let loopback = match endpoint.host() {
            Some(url::Host::Domain("localhost")) => true,
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            _ => false,
        };
        if loopback {
            builder = builder.no_proxy();
        }
        Ok(Self {
            client: rig_reqwest::ReqwestClient::from(builder.build().map_err(|_| "native_http")?),
            sent: Arc::new(AtomicBool::new(false)),
            facts: Arc::new(Mutex::new(
                serde_json::json!({"request":null,"response":null}),
            )),
        })
    }
}
fn completion_http_error() -> rig_core::http_client::Error {
    rig_core::http_client::Error::instance(std::io::Error::other("completion_transport_rejected"))
}
impl rig_core::http_client::HttpClientExt for CompletionHttp {
    fn send<T, U>(
        &self,
        req: rig_core::http_client::Request<T>,
    ) -> impl Future<
        Output = rig_core::http_client::Result<
            rig_core::http_client::Response<rig_core::http_client::LazyBody<U>>,
        >,
    > + Send
    + 'static
    where
        T: Into<rig_core::http_client::Bytes> + Send,
        U: From<rig_core::http_client::Bytes> + Send + 'static,
    {
        use futures_util::StreamExt;
        let this = self.clone();
        let req = req.map(Into::<rig_core::http_client::Bytes>::into);
        async move {
            let response = this.send_streaming(req).await?;
            let (parts, mut stream) = response.into_parts();
            let body: rig_core::http_client::LazyBody<U> = Box::pin(async move {
                let mut bytes = Vec::new();
                while let Some(chunk) = stream.next().await {
                    bytes.extend_from_slice(&chunk?);
                }
                if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    this.facts.lock().unwrap_or_else(|e| e.into_inner())["response"] =
                        response_facts(&value);
                }
                Ok(U::from(rig_core::http_client::Bytes::from(bytes)))
            });
            Ok(rig_core::http_client::Response::from_parts(parts, body))
        }
    }
    fn send_multipart<U>(
        &self,
        _: rig_core::http_client::Request<rig_core::http_client::MultipartForm>,
    ) -> impl Future<
        Output = rig_core::http_client::Result<
            rig_core::http_client::Response<rig_core::http_client::LazyBody<U>>,
        >,
    > + Send
    + 'static
    where
        U: From<rig_core::http_client::Bytes> + Send + 'static,
    {
        std::future::ready(Err(completion_http_error()))
    }
    fn send_streaming<T>(
        &self,
        req: rig_core::http_client::Request<T>,
    ) -> impl Future<
        Output = rig_core::http_client::Result<rig_core::http_client::StreamingResponse>,
    > + Send
    where
        T: Into<rig_core::http_client::Bytes> + Send,
    {
        use futures_util::StreamExt;
        let this = self.clone();
        let req = req.map(Into::<rig_core::http_client::Bytes>::into);
        async move {
            if req.body().len() > 64 * 1024 * 1024 || this.sent.swap(true, Ordering::SeqCst) {
                return Err(completion_http_error());
            }
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(req.body()) {
                this.facts.lock().unwrap_or_else(|e| e.into_inner())["request"] =
                    request_facts(&value);
            }
            let response = this
                .client
                .send_streaming(req)
                .await
                .map_err(|_| completion_http_error())?;
            let (parts, stream) = response.into_parts();
            let stream = stream.scan(0usize, |size, chunk| {
                let chunk = match chunk {
                    Ok(bytes) => {
                        *size = size.saturating_add(bytes.len());
                        if *size > 64 * 1024 * 1024 {
                            Err(completion_http_error())
                        } else {
                            Ok(bytes)
                        }
                    }
                    Err(error) => Err(error),
                };
                std::future::ready(Some(chunk))
            });
            let stream: rig_core::http_client::BoxedStream = Box::pin(stream);
            Ok(rig_core::http_client::Response::from_parts(parts, stream))
        }
    }
}
