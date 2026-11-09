//! Credential-free native call delegation. Only the helper opens the system credential store.
use crate::{
    contract::{Analysis, Review, hash},
    journal,
};
use anyhow::{Result, ensure};
use rig_core::{
    catalog::{ModelSpec, ReasoningSupport},
    completion::{
        AssistantContent, CompletionRequest, CompletionResponse, Effort, Message,
        ProviderCapabilities, Reasoning, Usage,
    },
    effect::{Answered, EffectKind, FamilyDescriptor, HandlerDescriptor, family, model_key},
    message::{Origin, UserContent},
    providers::registry::ProviderId,
    serve::{Dispatch, ErasedHandler, Reply, Serve},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{process::Command, sync::oneshot};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const TEST_NAME: &str = "chapter_analysis::experiment::protocol_experiment_bridge";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Selection {
    pub connection_id: String,
    pub model_id: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeConfig {
    pub bridge_binary: PathBuf,
    pub config_path: PathBuf,
    pub selection: Selection,
    /// Explicit local fake helper; its output can never be labelled live.
    #[serde(default)]
    pub controlled_helper: bool,
    #[serde(default)]
    pub bridge_identity: Option<BridgeIdentity>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BridgeIdentity {
    pub sha256: String,
    pub bytes: u64,
    pub modified_ns: u64,
    pub inode: u64,
    pub device: u64,
}
fn helper_stamp(path: &Path) -> Result<BridgeIdentity> {
    let metadata = fs::metadata(path).map_err(|_| anyhow::anyhow!("helper_metadata"))?;
    let modified_ns = u64::try_from(
        metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos(),
    )?;
    #[cfg(unix)]
    let (inode, device) = {
        use std::os::unix::fs::MetadataExt;
        (metadata.ino(), metadata.dev())
    };
    #[cfg(not(unix))]
    let (inode, device) = (0, 0);
    Ok(BridgeIdentity {
        sha256: String::new(),
        bytes: metadata.len(),
        modified_ns,
        inode,
        device,
    })
}
fn same_stamp(a: &BridgeIdentity, b: &BridgeIdentity) -> bool {
    a.bytes == b.bytes
        && a.modified_ns == b.modified_ns
        && a.inode == b.inode
        && a.device == b.device
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Binding {
    pub model: String,
    pub revision: u64,
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
    pub configuration_hash: String,
    pub route_hash: String,
}
fn capacity(value: &Value) -> Result<Option<u32>> {
    if value.is_null() {
        return Ok(None);
    }
    let n = value.as_u64().and_then(|n| u32::try_from(n).ok());
    ensure!(n.is_some_and(|n| n > 0), "invalid_model_capacity");
    Ok(n)
}
fn binding(config: &NativeConfig) -> Result<Binding> {
    let document: Value = serde_json::from_slice(
        &fs::read(&config.config_path).map_err(|_| anyhow::anyhow!("native_config_unreadable"))?,
    )
    .map_err(|_| anyhow::anyhow!("native_config_json"))?;
    ensure!(document["version"] == 1, "native_config_version");
    let connection = document["connections"]
        .as_array()
        .and_then(|cs| {
            cs.iter().find_map(|s| {
                let c = &s["connection"];
                (c["id"].as_str() == Some(&config.selection.connection_id)).then_some(c)
            })
        })
        .ok_or_else(|| anyhow::anyhow!("native_connection_missing"))?;
    let model = connection["models"]
        .as_array()
        .and_then(|ms| {
            ms.iter()
                .find(|m| m["id"].as_str() == Some(&config.selection.model_id))
        })
        .ok_or_else(|| anyhow::anyhow!("native_model_missing"))?;
    let id = model["modelId"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("native_model_identity"))?
        .to_owned();
    let revision = connection["revision"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("native_revision"))?;
    let context_window = capacity(&model["contextWindow"])?;
    let max_output_tokens = capacity(&model["maxOutputTokens"])?;
    // serde_json's map is a BTreeMap (preserve_order is disabled), matching the owning Rust bridge.
    let config_hash = hash(&serde_json::to_vec(
        &json!({"configuration":{"selection":config.selection,"revision":revision},"capacity":[context_window,max_output_tokens],"model":id,"reasoning":"low"}),
    )?);
    let route_hash = hash(&serde_json::to_vec(
        &json!({"protocol":connection["protocol"],"endpoint":connection["endpoint"]}),
    )?);
    Ok(Binding {
        model: id,
        revision,
        context_window,
        max_output_tokens,
        configuration_hash: config_hash,
        route_hash,
    })
}
fn file_hash(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path).map_err(|_| anyhow::anyhow!("helper_unreadable"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Fact {
    Running,
    Completed,
    ProviderFailed,
    Unknown,
    Timeout,
}
struct SupervisorCount(Arc<NativeBoundary>);
impl Drop for SupervisorCount {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}
struct CancelOnDrop(Option<oneshot::Sender<()>>);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if let Some(sender) = self.0.take() {
            let _ = sender.send(());
        }
    }
}

pub(crate) struct NativeBoundary {
    config: NativeConfig,
    pub binding: Binding,
    pub helper_identity: BridgeIdentity,
    jobs: PathBuf,
    facts: Mutex<std::collections::BTreeMap<usize, Fact>>,
    active: AtomicUsize,
    request_timeout: Duration,
}
impl NativeBoundary {
    pub fn open(config: NativeConfig, jobs: &Path) -> Result<Arc<Self>> {
        ensure!(
            config.bridge_binary.is_absolute() && config.config_path.is_absolute(),
            "native_paths_must_be_absolute"
        );
        ensure!(
            !config.selection.connection_id.trim().is_empty()
                && !config.selection.model_id.trim().is_empty(),
            "native_selection_required"
        );
        let bound = binding(&config)?;
        let mut helper_identity = helper_stamp(&config.bridge_binary)?;
        if let Some(frozen) = &config.bridge_identity {
            ensure!(
                same_stamp(frozen, &helper_identity)
                    && frozen.sha256.len() == 64
                    && frozen.sha256.bytes().all(|c| c.is_ascii_hexdigit()),
                "helper_identity_changed"
            );
            helper_identity = frozen.clone();
        } else {
            helper_identity.sha256 = file_hash(&config.bridge_binary)?;
            ensure!(
                same_stamp(&helper_identity, &helper_stamp(&config.bridge_binary)?),
                "helper_changed_during_hash"
            );
        }
        let anchor = journal::target_path(&jobs.join("anchor"))?;
        Ok(Arc::new(Self {
            config,
            binding: bound,
            helper_identity,
            jobs: anchor
                .parent()
                .ok_or_else(|| anyhow::anyhow!("jobs_parent"))?
                .to_path_buf(),
            facts: Mutex::new(Default::default()),
            active: AtomicUsize::new(0),
            request_timeout: REQUEST_TIMEOUT,
        }))
    }
    pub fn verify(&self) -> Result<()> {
        ensure!(
            binding(&self.config)? == self.binding,
            "native_binding_changed"
        );
        ensure!(
            same_stamp(
                &self.helper_identity,
                &helper_stamp(&self.config.bridge_binary)?
            ),
            "helper_identity_changed"
        );
        Ok(())
    }
    pub fn controlled(&self) -> bool {
        self.config.controlled_helper
    }
    pub fn identity(&self) -> Value {
        json!({"mode":if self.controlled(){"controlled_native_helper"}else{"native_live"},"binding":self.binding,"helperIdentity":self.helper_identity,"requestTimeoutMs":self.request_timeout.as_millis(),"configPathHash":hash(self.config.config_path.to_string_lossy().as_bytes())})
    }
    pub fn spec(&self) -> Result<Arc<ModelSpec>> {
        let provider = ProviderId::declare("castglean-native-bridge")?;
        let mut spec = ModelSpec::new(provider, &self.binding.model)
            .with_reasoning(ReasoningSupport::Unknown { default: None });
        spec.context_window = self.binding.context_window;
        spec.max_output_tokens = self.binding.max_output_tokens;
        // No tools/structured-output/pricing capability is claimed from another catalog model.
        Ok(Arc::new(spec))
    }
    pub fn handler(self: &Arc<Self>, index: usize) -> ErasedHandler {
        ErasedHandler::new(BridgeHandler {
            native: Arc::clone(self),
            index,
        })
    }
    fn fact(&self, index: usize, fact: Fact) {
        if let Ok(mut facts) = self.facts.lock() {
            facts.insert(index, fact);
        }
    }
    pub fn request_unknown(&self, index: usize) -> bool {
        self.facts.lock().is_ok_and(|f| {
            matches!(
                f.get(&index),
                Some(Fact::Running | Fact::Unknown | Fact::Timeout)
            )
        })
    }
    pub fn timed_out(&self) -> bool {
        self.facts
            .lock()
            .is_ok_and(|f| f.values().any(|f| *f == Fact::Timeout))
    }
    pub fn drain(&self) -> Result<()> {
        let began = Instant::now();
        while self.active.load(Ordering::SeqCst) > 0 && began.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(2));
        }
        ensure!(
            self.active.load(Ordering::SeqCst) == 0,
            "native_helpers_not_reaped"
        );
        Ok(())
    }
    async fn supervise(
        self: Arc<Self>,
        index: usize,
        job: Value,
        mut cancelled: oneshot::Receiver<()>,
    ) -> Result<CompletionResponse> {
        let _count = SupervisorCount(Arc::clone(&self));
        self.verify()?;
        let directory = tempfile::Builder::new()
            .prefix("call-")
            .tempdir_in(&self.jobs)?;
        let path = directory.path().join("job.json");
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(&serde_json::to_vec(&job)?)?;
        file.sync_all()?;
        drop(file);
        // If cancellation beat child admission, no new helper is launched.
        if cancelled.try_recv().is_ok() {
            self.fact(index, Fact::Unknown);
            anyhow::bail!("native_cancelled_unknown");
        }
        let mut child = Command::new(&self.config.bridge_binary)
            .args(["--exact", TEST_NAME, "--ignored", "--nocapture"])
            .env("CASTGLEAN_EXPERIMENT_JOB", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| anyhow::anyhow!("native_helper_start"))?;
        self.fact(index, Fact::Running);
        let termination = tokio::select! {
            status=child.wait()=>Some(status),
            _=tokio::time::sleep(self.request_timeout)=>{self.fact(index,Fact::Timeout);None},
            _=&mut cancelled=>{self.fact(index,Fact::Unknown);None},
        };
        if termination.is_none() {
            let _ = child.kill().await;
            let _ = child.wait().await;
            anyhow::bail!("native_unfinished_unknown");
        }
        let status = match termination {
            Some(Ok(status)) => status,
            Some(Err(_)) => {
                self.fact(index, Fact::Unknown);
                let _ = child.kill().await;
                let _ = child.wait().await;
                anyhow::bail!("native_helper_wait_unknown");
            }
            None => anyhow::bail!("native_unfinished_unknown"),
        };
        if !status.success() {
            self.fact(index, Fact::Unknown);
            anyhow::bail!("native_helper_exit_unknown");
        }
        let result_path = path.with_extension("result.json");
        let metadata = fs::metadata(&result_path).map_err(|_| {
            self.fact(index, Fact::Unknown);
            anyhow::anyhow!("native_result_missing")
        })?;
        ensure!(
            metadata.len() <= 16 * 1024 * 1024,
            "native_result_too_large"
        );
        let result: Value = serde_json::from_slice(&fs::read(&result_path)?).map_err(|_| {
            self.fact(index, Fact::Unknown);
            anyhow::anyhow!("native_result_json")
        })?;
        // Helper failures are redacted: never surface its error/stdout/stderr or raw response.
        if result["ok"] != true {
            self.fact(index, Fact::ProviderFailed);
            anyhow::bail!("native_provider_failed");
        }
        if self.verify().is_err() {
            self.fact(index, Fact::Unknown);
            anyhow::bail!("native_binding_changed_unknown");
        }
        ensure!(
            result["model"].as_str() == Some(&self.binding.model),
            "native_response_model_mismatch"
        );
        let text = result["text"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("native_response_text"))?;
        let usage: Usage = if result["usage"].is_null() {
            Usage::new()
        } else {
            serde_json::from_value(result["usage"].clone())
                .map_err(|_| anyhow::anyhow!("native_usage"))?
        };
        ensure!(
            usage
                .cached_input_tokens
                .zip(usage.input_tokens)
                .is_none_or(|(cached, total)| cached <= total),
            "native_usage_cache"
        );
        self.fact(index, Fact::Completed);
        Ok(CompletionResponse::new(
            vec![AssistantContent::text(text)],
            usage,
            Origin::new(
                "castglean.native.call",
                "castglean-native-bridge",
                &self.binding.model,
            ),
            Value::Null,
        ))
    }
}
struct BridgeHandler {
    native: Arc<NativeBoundary>,
    index: usize,
}
impl Serve for BridgeHandler {
    type Family = family::Completion;
    fn descriptor(&self) -> HandlerDescriptor {
        HandlerDescriptor {
            key: model_key(&self.native.binding.model),
            family: FamilyDescriptor::Completion {
                model: self.native.binding.model.clone().into(),
                capabilities: ProviderCapabilities::new(),
            },
            layers: vec![],
        }
    }
    async fn serve(&self, kind: EffectKind, _dispatch: Dispatch) -> Reply {
        let result = async {
            let EffectKind::Completion { request, .. } = kind else {
                anyhow::bail!("native_completion_only");
            };
            let job = call_job(&self.native, &request, self.index)?;
            let (cancel, signal) = oneshot::channel();
            let mut cancellation = CancelOnDrop(Some(cancel));
            let native = Arc::clone(&self.native);
            let index = self.index;
            native.active.fetch_add(1, Ordering::SeqCst);
            // Supervision survives cancellation of the caller only long enough to kill and wait.
            let work = tokio::spawn(async move { native.supervise(index, job, signal).await });
            let result = work
                .await
                .map_err(|_| anyhow::anyhow!("native_supervisor_failed"))?;
            cancellation.0.take();
            result
        }
        .await;
        Reply::Outcome(match result {
            Ok(response) => Ok(Answered::Completion(Arc::new(response))),
            Err(_) => Err(rig_core::error::ErrorReport::from(
                &rig_core::error::ProviderError::Provider("native_call_failed".into()),
            )),
        })
    }
}
fn call_job(native: &NativeBoundary, request: &CompletionRequest, index: usize) -> Result<Value> {
    ensure!(
        request.tools.is_empty() && request.documents.is_empty(),
        "native_read_only_text"
    );
    ensure!(
        request.options.reasoning == Some(Reasoning::Effort(Effort::Low)),
        "native_requires_low"
    );
    ensure!(
        request.temperature.is_none()
            && request.max_tokens.is_none()
            && request.additional_params.is_none(),
        "native_unmapped_options"
    );
    let mut system = Vec::new();
    let mut user = Vec::new();
    for message in &request.chat_history {
        match message.as_ref() {
            Message::System { content } => system.push(content.clone()),
            Message::User { content } => {
                for item in content {
                    match item {
                        UserContent::Text(text) => user.push(text.text.clone()),
                        _ => anyhow::bail!("native_text_only"),
                    }
                }
            }
            _ => anyhow::bail!("native_one_shot_only"),
        }
    }
    ensure!(user.len() == 1, "native_single_payload");
    let mut schema = if index == 3 {
        serde_json::to_value(schemars::schema_for!(Review))?
    } else {
        serde_json::to_value(schemars::schema_for!(Analysis))?
    };
    let payload: Value =
        serde_json::from_str(&user[0]).map_err(|_| anyhow::anyhow!("native_payload_json"))?;
    ensure!(
        payload.get("gold").is_none() && payload.get("reviewGold").is_none(),
        "native_no_gold"
    );
    if index != 3 {
        let source = payload["source"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("native_source"))?;
        let start = payload["range"]["start"]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| anyhow::anyhow!("native_owned_start"))?;
        let end = payload["range"]["end"]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| anyhow::anyhow!("native_owned_end"))?;
        ensure!(
            start < end && source.get(start..end).is_some(),
            "native_owned_range"
        );
        let boundaries: Vec<_> = source
            .char_indices()
            .map(|(i, _)| i)
            .chain(std::iter::once(source.len()))
            .filter(|i| *i >= start && *i <= end)
            .collect();
        schema["$defs"]["Segment"]["properties"]["start"]["enum"] =
            json!(&boundaries[..boundaries.len() - 1]);
        schema["$defs"]["Segment"]["properties"]["end"]["enum"] = json!(&boundaries[1..]);
        schema["$defs"]["Segment"]["properties"]["kind"]["enum"] =
            json!(["narration", "speech", "thought"]);
        let mut speakers = vec![
            Value::String("narrator".into()),
            Value::String("unknown".into()),
        ];
        if let Some(characters) = payload["characters"].as_array() {
            speakers.extend(characters.iter().map(|c| c["id"].clone()));
        }
        schema["$defs"]["Segment"]["properties"]["speaker"]["enum"] = json!(speakers);
    } else {
        let targets = payload["targets"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("native_review_targets"))?;
        schema["$defs"]["Issue"]["properties"]["start"]["enum"] = json!(
            targets
                .iter()
                .map(|s| s["start"].clone())
                .collect::<Vec<_>>()
        );
        schema["$defs"]["Issue"]["properties"]["end"]["enum"] =
            json!(targets.iter().map(|s| s["end"].clone()).collect::<Vec<_>>());
    }
    Ok(
        json!({"op":"call","configPath":native.config.config_path,"selection":native.config.selection,"system":system.join("\n\n"),"user":user[0],"schema":schema,"low":true}),
    )
}

#[cfg(test)]
mod tests;
