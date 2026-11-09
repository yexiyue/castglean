//! Shared credential-free model. Only the native test helper opens the credential vault.
use anyhow::{Result, ensure};
use rig_core::{
    DynModel,
    catalog::{ModelFacts, ModelSpec, ReasoningSupport},
    completion::{
        Accepts, CompletionRequest, CompletionResponse, Effort, Reasoning, ReplayTarget, Usage,
    },
    driver::{Exchange, Model, Opened, Opening, Transport},
    error::{EncodeError, ProviderError},
    message::Api,
    operation::Completion,
    providers::registry::ProviderId,
    test_utils::{MockDecoder, MockDocument, MockFrame},
    wire::{Descriptor, Mode, Wire},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    process::Command,
    sync::{Notify, Semaphore, oneshot},
};

const TEST_NAME: &str = "chapter_analysis::experiment::protocol_experiment_bridge";
const TIMEOUT: Duration = Duration::from_secs(600);
const MAX_REQUESTS: usize = 16;
const MAX_TOKENS: u64 = 64_000;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeConfig {
    bridge_binary: PathBuf,
    config_path: PathBuf,
    selection: Selection,
    #[serde(default)]
    controlled_helper: bool,
    #[serde(default)]
    unlimited_tokens: bool,
    #[serde(default)]
    unlimited_time: bool,
    #[serde(default)]
    reasoning_effort: ReasoningEffort,
    #[serde(default)]
    bridge_identity: Option<Identity>,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(super) enum ReasoningEffort {
    #[default]
    Low,
    #[serde(rename = "default", alias = "provider-default")]
    ProviderDefault,
}
impl ReasoningEffort {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::ProviderDefault => "default",
        }
    }
    fn request_reasoning(self) -> Option<Reasoning> {
        match self {
            Self::Low => Some(Reasoning::Effort(Effort::Low)),
            Self::ProviderDefault => None,
        }
    }
}
impl NativeConfig {
    fn request_timeout(&self) -> Option<Duration> {
        (!self.unlimited_time).then_some(TIMEOUT)
    }
}
#[derive(Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection {
    connection_id: String,
    model_id: String,
}
#[derive(Clone, Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Identity {
    sha256: String,
    bytes: u64,
    modified_ns: u64,
    inode: u64,
    device: u64,
}
#[derive(Clone, Debug, PartialEq)]
struct Binding {
    model: String,
    revision: u64,
    capacity: (Option<u32>, Option<u32>),
    configuration_hash: String,
    route_hash: String,
    provider: &'static str,
    api: &'static str,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn file_identity(path: &Path) -> Result<Identity> {
    let mut file = fs::File::open(path)?;
    let metadata = file.metadata()?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    #[cfg(unix)]
    let (inode, device) = {
        use std::os::unix::fs::MetadataExt;
        (metadata.ino(), metadata.dev())
    };
    #[cfg(not(unix))]
    let (inode, device) = (0, 0);
    Ok(Identity {
        sha256: format!("{:x}", digest.finalize()),
        bytes: metadata.len(),
        modified_ns: metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
            .try_into()?,
        inode,
        device,
    })
}
fn capacity(v: &Value) -> Result<Option<u32>> {
    if v.is_null() {
        return Ok(None);
    }
    let n = v
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| *n > 0);
    ensure!(n.is_some(), "native_invalid_capacity");
    Ok(n)
}
fn binding(config: &NativeConfig) -> Result<Binding> {
    // This file contains connection parameters/references, never the vault secret.
    let document: Value = serde_json::from_slice(&fs::read(&config.config_path)?)?;
    ensure!(document["version"] == 1, "native_config_version");
    let connection = document["connections"]
        .as_array()
        .and_then(|cs| {
            cs.iter()
                .map(|c| &c["connection"])
                .find(|c| c["id"].as_str() == Some(&config.selection.connection_id))
        })
        .ok_or_else(|| anyhow::anyhow!("native_connection_missing"))?;
    let model = connection["models"]
        .as_array()
        .and_then(|ms| {
            ms.iter()
                .find(|m| m["id"].as_str() == Some(&config.selection.model_id))
        })
        .ok_or_else(|| anyhow::anyhow!("native_model_missing"))?;
    let model_id = model["modelId"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("native_model_identity"))?
        .to_owned();
    let revision = connection["revision"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("native_revision"))?;
    let capacity = (
        capacity(&model["contextWindow"])?,
        capacity(&model["maxOutputTokens"])?,
    );
    let (provider, api) = match connection["protocol"].as_str() {
        Some("openai") => ("openai", "openai.chat"),
        Some("anthropic") => ("anthropic", "anthropic.messages"),
        Some("gemini") => ("gemini", "gemini.generate_content"),
        _ => anyhow::bail!("native_protocol"),
    };
    let configuration_hash = hash(&serde_json::to_vec(&json!({
        "configuration":{"selection":config.selection,"revision":revision},
        "capacity":[capacity.0,capacity.1],"model":model_id,"reasoning":config.reasoning_effort.as_str()
    }))?);
    Ok(Binding {
        model: model_id,
        revision,
        capacity,
        configuration_hash,
        route_hash: hash(&serde_json::to_vec(
            &json!({"protocol":connection["protocol"],"endpoint":connection["endpoint"]}),
        )?),
        provider,
        api,
    })
}

#[derive(Default)]
struct State {
    requests: usize,
    known_tokens: u64,
    usage: Usage,
    active: usize,
    failed: bool,
    traces: Vec<Value>,
    hashes: (Option<String>, Option<String>),
    discover: bool,
}
struct Native {
    config: NativeConfig,
    binding: Binding,
    identity: Identity,
    jobs: PathBuf,
    route: String,
    run_id: String,
    source_hash: String,
    state: Mutex<State>,
    serial: Arc<Semaphore>,
    idle: Notify,
}

pub(super) struct Boundary {
    pub model: DynModel<Completion>,
    pub spec: Arc<ModelSpec>,
    pub configuration_hash: String,
    pub model_id: String,
    native: Arc<Native>,
}
impl Boundary {
    pub fn unlimited_tokens(&self) -> bool {
        self.native.config.unlimited_tokens
    }
    pub fn unlimited_time(&self) -> bool {
        self.native.config.unlimited_time
    }
    pub fn wall_timeout(&self) -> Option<Duration> {
        (!self.unlimited_time()).then_some(Duration::from_secs(300))
    }
    pub fn budgets(&self) -> Value {
        super::budgets(
            self.unlimited_tokens(),
            self.unlimited_time(),
            self.native.config.reasoning_effort,
        )
    }
    pub fn effective_hash(&self, discover: bool) -> Result<String> {
        effective_hash(&self.configuration_hash, &self.native.config, discover)
    }
    pub fn controlled(&self) -> bool {
        self.native.config.controlled_helper
    }
    pub fn traces(&self) -> Vec<Value> {
        self.native
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .traces
            .clone()
    }
    pub fn usage(&self) -> Usage {
        self.native
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .usage
    }
    /// Set once before admission. The parent owns canonical prompt/tool definitions.
    pub fn set_hashes(&self, prompt_hash: &str, tools_hash: &str, discover: bool) -> Result<()> {
        ensure!(
            [prompt_hash, tools_hash]
                .iter()
                .all(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())),
            "native_metadata_hash"
        );
        let mut state = self
            .native
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("native_state"))?;
        ensure!(state.requests == 0, "native_metadata_frozen");
        state.hashes = (Some(prompt_hash.into()), Some(tools_hash.into()));
        state.discover = discover;
        Ok(())
    }
    /// Wait for detached supervisors to finish kill+wait after caller cancellation.
    pub async fn drain(&self) -> Result<()> {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let changed = self.native.idle.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if self
                    .native
                    .state
                    .lock()
                    .map_err(|_| anyhow::anyhow!("native_state"))?
                    .active
                    == 0
                {
                    return Ok(());
                }
                changed.await;
            }
        })
        .await
        .map_err(|_| anyhow::anyhow!("native_helpers_not_reaped"))?
    }
}
pub(super) fn build(
    config_path: &Path,
    jobs: &Path,
    route: &str,
    run_id: &str,
    source_hash: &str,
) -> Result<Boundary> {
    let config: NativeConfig = serde_json::from_slice(&fs::read(config_path)?)?;
    ensure!(
        config.bridge_binary.is_absolute() && config.config_path.is_absolute(),
        "native_absolute_paths_required"
    );
    let bound = binding(&config)?;
    let identity = file_identity(&config.bridge_binary)?;
    if let Some(frozen) = &config.bridge_identity {
        ensure!(frozen == &identity, "native_helper_changed");
    }
    // Plan C explicitly requires tool calling. The selected native service is
    // smoke-tested before scoring; do not inherit another catalog model's facts.
    let mut spec = ModelSpec::new(ProviderId::declare(bound.provider)?, &bound.model)
        .with_tools(true)
        .with_reasoning(ReasoningSupport::Unknown { default: None });
    spec.context_window = bound.capacity.0;
    spec.max_output_tokens =
        (!config.unlimited_tokens).then(|| bound.capacity.1.unwrap_or(4096).min(4096));
    let spec = Arc::new(spec);
    fs::create_dir_all(jobs)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(jobs, fs::Permissions::from_mode(0o700))?;
    }
    let prompt_hash = hash(super::prompt(config.unlimited_time).as_bytes());
    let native = Arc::new(Native {
        config,
        binding: bound.clone(),
        identity,
        jobs: fs::canonicalize(jobs)?,
        route: route.into(),
        run_id: run_id.into(),
        source_hash: source_hash.into(),
        state: Mutex::new(State {
            hashes: (
                Some(prompt_hash),
                Some(hash(&serde_json::to_vec(&super::tools::definitions())?)),
            ),
            ..State::default()
        }),
        serial: Arc::new(Semaphore::new(1)),
        idle: Notify::new(),
    });
    let wire = BridgeWire {
        facts: ModelFacts::new(spec.clone()),
        binding: bound.clone(),
    };
    Ok(Boundary {
        model: Model::new(wire, BridgeTransport(native.clone())).erase(),
        spec,
        configuration_hash: bound.configuration_hash,
        model_id: bound.model,
        native,
    })
}

// This relay preserves native history on the selected API. The real provider wire in the
// helper performs provider-specific encoding, capability checks and tool id normalization.
#[derive(Clone, Debug)]
struct BridgeWire {
    facts: ModelFacts,
    binding: Binding,
}
impl ReplayTarget for BridgeWire {
    fn api(&self) -> Api {
        Api::from_static(self.binding.api)
    }
    fn provider(&self) -> &str {
        self.binding.provider
    }
    fn model(&self) -> &str {
        &self.binding.model
    }
    fn accepts(&self, _: &str) -> Accepts {
        Accepts::ALL
    }
    fn states_finish_reason(&self) -> bool {
        false
    }
    fn facts(&self) -> Option<&ModelFacts> {
        Some(&self.facts)
    }
    fn declares_tools(&self, _: &CompletionRequest) -> bool {
        // This is a transport relay, not the final provider encoder: preserve tool
        // history even when the caller omits current tool definitions.
        true
    }
    fn takes_documents(&self) -> bool {
        true
    }
    fn map_options(
        &self,
        _: &CompletionRequest,
        f: rig_core::completion::options::OptionFields<'_>,
    ) -> rig_core::completion::options::OptionMap {
        use rig_core::completion::options::{Mapping, OptionMap};
        let keep = |_| Mapping::Send(json!({}));
        OptionMap {
            reasoning: Mapping::of(f.reasoning, keep),
            cache: Mapping::of(f.cache, |_| Mapping::Send(json!({}))),
            service_tier: Mapping::of(f.service_tier, |_| Mapping::Send(json!({}))),
            verbosity: Mapping::of(f.verbosity, |_| Mapping::Send(json!({}))),
            parallel_tool_calls: Mapping::of(f.parallel_tool_calls, |_| Mapping::Send(json!({}))),
            top_p: Mapping::of(f.top_p, |_| Mapping::Send(json!({}))),
            seed: Mapping::of(f.seed, |_| Mapping::Send(json!({}))),
            stop: Mapping::of_stop(f.stop, |_| Mapping::Send(json!({}))),
            cache_key: Mapping::of(f.cache_key, |_| Mapping::Send(json!({}))),
        }
    }
}
impl Wire for BridgeWire {
    type Op = Completion;
    type Payload = CompletionRequest;
    type Frame = MockFrame;
    type Event = MockFrame;
    type Decoder<'id> = MockDecoder<'id>;
    type Reassembler = MockDocument;
    fn describe(&self) -> Descriptor<'_> {
        Descriptor::new(self.binding.provider)
            .model(Some(self.binding.model.as_str()))
            .facts(&self.facts)
            .replay(self)
    }
    fn encode(
        &self,
        request: CompletionRequest,
        _: Mode,
    ) -> std::result::Result<CompletionRequest, EncodeError> {
        Ok(request)
    }
    fn decoder<'id>(&self) -> Self::Decoder<'id> {
        MockDecoder::default()
    }
}
#[derive(Clone)]
struct BridgeTransport(Arc<Native>);
struct CancelOnDrop(Option<oneshot::Sender<()>>);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if let Some(sender) = self.0.take() {
            let _ = sender.send(());
        }
    }
}
impl Transport<BridgeWire> for BridgeTransport {
    fn send(&self, request: CompletionRequest, _exchange: Exchange) -> Opening<MockFrame> {
        let native = self.0.clone();
        Opening::new(async move {
            let (cancel, signal) = oneshot::channel();
            let mut cancel = CancelOnDrop(Some(cancel));
            // Task survives drop of this opening solely to reap the child and record its span.
            native.state.lock().map_err(|_| safe_error())?.active += 1;
            let task = tokio::spawn(async move {
                let _active = Active(native.clone());
                native.call(request, signal).await
            });
            let response = task
                .await
                .map_err(|_| safe_error())?
                .map_err(|_| safe_error())?;
            cancel.0.take();
            let request_id = response.provider_request_id.clone();
            let raw = response.raw.clone();
            Ok(
                Opened::new(futures::stream::iter([Ok(MockFrame::Response(Box::new(
                    response,
                )))]))
                .with_request_id(request_id)
                .with_document(raw),
            )
        })
    }
}
fn safe_error() -> ProviderError {
    ProviderError::Provider("native_completion_failed".into())
}

struct Active(Arc<Native>);
impl Drop for Active {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.active = state.active.saturating_sub(1);
        }
        self.0.idle.notify_waiters();
    }
}
fn effective_hash(
    native_configuration: &str,
    config: &NativeConfig,
    discover: bool,
) -> Result<String> {
    Ok(hash(&serde_json::to_vec(&json!({
        "nativeConfiguration":native_configuration,
        "budgets":super::budgets(config.unlimited_tokens, config.unlimited_time, config.reasoning_effort),
        "identityScope":super::identity_scope(discover)
    }))?))
}
fn audit_model_event(event: &Value) {
    let Some(path) = std::env::var_os("CASTGLEAN_TOOL_AUDIT") else {
        return;
    };
    let result = (|| -> Result<()> {
        let mut options = fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path)?;
        serde_json::to_writer(&mut file, event)?;
        file.write_all(b"\n")?;
        Ok(())
    })();
    if result.is_err() {
        eprintln!("experiment_audit_write_failed");
    }
}
impl Native {
    fn verify(&self) -> Result<()> {
        ensure!(
            binding(&self.config)? == self.binding,
            "native_binding_changed"
        );
        ensure!(
            file_identity(&self.config.bridge_binary)? == self.identity,
            "native_helper_changed"
        );
        Ok(())
    }
    async fn call(
        self: Arc<Self>,
        mut request: CompletionRequest,
        mut cancelled: oneshot::Receiver<()>,
    ) -> Result<CompletionResponse> {
        let _permit = tokio::select! {
            permit = self.serial.acquire() => permit?,
            _ = &mut cancelled => anyhow::bail!("native_cancelled_before_admission"),
        };
        let started = Instant::now();
        let index = {
            let mut s = self
                .state
                .lock()
                .map_err(|_| anyhow::anyhow!("native_state"))?;
            ensure!(
                !s.failed
                    && s.requests < MAX_REQUESTS
                    && (self.config.unlimited_tokens || s.known_tokens < MAX_TOKENS),
                "native_budget_or_terminal_failure"
            );
            s.requests += 1;
            s.requests
        };
        let mut span_started = None;
        let result = async {
            self.verify()?;
            ensure!(request.model.as_deref().is_none_or(|m| m == self.binding.model), "native_model_override");
            request.model = Some(self.binding.model.clone());
            ensure!(request.max_tokens != Some(0), "native_invalid_max_tokens");
            request.max_tokens = if self.config.unlimited_tokens {
                None
            } else {
                Some(request.max_tokens.unwrap_or(4096).min(4096)
                    .min(u64::from(self.binding.capacity.1.unwrap_or(4096))))
            };
            request.options.reasoning = self.config.reasoning_effort.request_reasoning();
            let mut offered_tools = request.tools.clone();
            offered_tools.sort_by(|a,b| a.name.as_str().cmp(b.name.as_str()));
            let offered_tools_hash = hash(&serde_json::to_vec(&offered_tools)?);
            let offered_tool_count = offered_tools.len();
            let actual_system_hash = request.system_instructions().map(|s|hash(s.as_bytes()));
            // The helper independently checks these limits and rejects credential/route fields.
            let job = json!({"op":"completion", "configPath":self.config.config_path, "selection":self.config.selection,
                "configurationHash":self.binding.configuration_hash, "unlimitedTokens":self.config.unlimited_tokens, "unlimitedTime":self.config.unlimited_time, "reasoningEffort":self.config.reasoning_effort.as_str(), "request":request});
            let directory = tempfile::Builder::new().prefix("completion-").tempdir_in(&self.jobs)?;
            let path = directory.path().join("job.json");
            let mut options = fs::OpenOptions::new(); options.create_new(true).write(true);
            #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
            let mut file = options.open(&path)?; file.write_all(&serde_json::to_vec(&job)?)?; file.sync_all()?; drop(file);
            if cancelled.try_recv().is_ok() { anyhow::bail!("native_cancelled_before_spawn"); }
            span_started = Some(Instant::now());
            {
                let mut state = self.state.lock().map_err(|_| anyhow::anyhow!("native_state"))?;
                let (prompt_hash, tools_hash) = state.hashes.clone();
                let effective_hash = effective_hash(&self.binding.configuration_hash, &self.config, state.discover)?;
                let identity_scope = super::identity_scope(state.discover);
                state.traces.push(json!({"span":"model.request","spanId":format!("{}:model:{index}",self.run_id),
                    "startedAt":super::tools::timestamp(),"route":self.route,"runId":self.run_id,"sourceHash":self.source_hash,
                    "budgets":super::budgets(self.config.unlimited_tokens, self.config.unlimited_time, self.config.reasoning_effort),"identityScope":identity_scope,
                    "reasoningEffort":self.config.reasoning_effort.as_str(),"wireFacts":null,"maxOutputTokens":request.max_tokens,"finishReason":null,
                    "configurationHash":effective_hash,"baseConfigurationHash":self.binding.configuration_hash,
                    "model":self.binding.model,"helperBinaryHash":self.identity.sha256,"promptHash":prompt_hash,
                    "toolsHash":tools_hash,"offeredToolsHash":offered_tools_hash,"offeredToolCount":offered_tool_count,"actualSystemHash":actual_system_hash,"requestIndex":index,"elapsedMs":null,"status":"started",
                    "usage":{"input_tokens":null,"output_tokens":null,"cached_input_tokens":null,"reasoning_tokens":null},
                    "controlledHelper":self.config.controlled_helper}));
                if let Some(event) = state.traces.last() { audit_model_event(event); }
            }
            let mut child = Command::new(&self.config.bridge_binary)
                .args(["--exact", TEST_NAME, "--ignored", "--nocapture"])
                .env("CASTGLEAN_EXPERIMENT_JOB", &path)
                .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
                .kill_on_drop(true).spawn().map_err(|_| anyhow::anyhow!("native_spawn_failed"))?;
            let termination = tokio::select! {
                status = super::with_timeout(self.config.request_timeout().map(|limit| limit.saturating_sub(started.elapsed())), child.wait()) => status.ok(),
                _ = &mut cancelled => None,
            };
            let status = match termination {
                Some(Ok(status)) => status,
                _ => { let _ = child.kill().await; let _ = child.wait().await; anyhow::bail!("native_cancelled_or_timeout_unknown"); }
            };
            ensure!(status.success(), "native_helper_exit_unknown");
            let output_path = path.with_extension("result.json");
            ensure!(fs::metadata(&output_path)?.len() <= 64 * 1024 * 1024, "native_result_too_large");
            let output: Value = serde_json::from_slice(&fs::read(output_path)?)?;
            if let Some(trace) = self.state.lock().map_err(|_| anyhow::anyhow!("native_state"))?
                .traces.iter_mut().find(|t| t["requestIndex"] == index) {
                trace["wireFacts"] = output["wireFacts"].clone();
            }
            ensure!(output["ok"] == true, "native_provider_failed");
            ensure!(output["configurationHash"] == self.binding.configuration_hash && output["model"] == self.binding.model, "native_response_binding");
            let response: CompletionResponse = serde_json::from_value(output["response"].clone())?;
            self.verify()?;
            ensure!(response.error.is_none() && response.aborted.is_none(), "native_response_failed");
            Ok(response)
        }.await;
        let mut s = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("native_state"))?;
        let usage = result
            .as_ref()
            .ok()
            .map(|r: &CompletionResponse| r.usage)
            .unwrap_or_default();
        let known = usage.total_tokens.unwrap_or_else(|| {
            usage
                .input_tokens
                .unwrap_or(0)
                .saturating_add(usage.output_tokens.unwrap_or(0))
        });
        s.known_tokens = s.known_tokens.saturating_add(known);
        s.usage += usage;
        let token_budget_exceeded = !self.config.unlimited_tokens && s.known_tokens > MAX_TOKENS;
        s.failed |= result.is_err() || token_budget_exceeded;
        if let Some(trace) = s.traces.iter_mut().find(|t| t["requestIndex"] == index) {
            trace["finishReason"] = json!(
                result
                    .as_ref()
                    .ok()
                    .and_then(|response| response.finish_reason())
                    .map(|reason| format!("{reason:?}"))
            );
            trace["elapsedMs"] =
                json!(span_started.map(|start| start.elapsed().as_secs_f64() * 1000.0));
            trace["status"] = json!(if result.is_ok() {
                "completed"
            } else {
                "failed_or_unknown"
            });
            trace["usage"] = json!({"input_tokens":usage.input_tokens,"output_tokens":usage.output_tokens,
                "cached_input_tokens":usage.cached_input_tokens,"reasoning_tokens":usage.reasoning_tokens,
                "total_tokens":usage.total_tokens,"cache_creation_input_tokens":usage.cache_creation_input_tokens});
            audit_model_event(trace);
        }
        if token_budget_exceeded {
            anyhow::bail!("native_known_token_budget_exceeded");
        }
        result
    }
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod tests;
