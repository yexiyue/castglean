//! Atomic non-secret configuration, credential publication and active configuration leases.
use super::{credentials::Credentials, types::*};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
mod reasoning;
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredConnection {
    connection: LlmConnection,
    credential_ref: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    version: u32,
    generation: u32,
    connections: Vec<StoredConnection>,
    default_model: Option<ModelSelection>,
    cleanup: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            generation: 0,
            connections: Vec::new(),
            default_model: None,
            cleanup: Vec::new(),
        }
    }
}

struct Inner {
    config: Config,
    active: HashMap<String, usize>,
    run_leases: usize,
    update_receipts: HashMap<String, [u8; 32]>,
}

pub(crate) struct LlmState {
    path: PathBuf,
    credentials: Arc<dyn Credentials>,
    inner: Mutex<Inner>,
    read_error: Option<LlmError>,
    receipt_salt: uuid::Uuid,
}

struct DigestWriter(Sha256);
impl std::io::Write for DigestWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Holds an immutable model/configuration identity until its local work has exited.
pub(crate) struct ConnectionLease {
    state: Arc<LlmState>,
    pub connection: LlmConnection,
    pub model: LlmModel,
    credential_ref: Option<String>,
    belongs_to_run: bool,
}

impl ConnectionLease {
    /// Resolve the immutable lease default or a validated per-run override.
    /// The same options configure both the native wire and explicit task requests.
    pub fn completion_options_with(
        &self,
        reasoning_override: Option<ReasoningSetting>,
    ) -> Result<rig_core::completion::GenerationOptions, LlmError> {
        reasoning::options(
            self.connection.protocol,
            &self.connection.endpoint,
            &self.model,
            reasoning_override.unwrap_or(self.model.reasoning),
        )
    }

    pub fn key(&self) -> Result<String, LlmError> {
        self.credential_ref
            .as_deref()
            .map(|r| self.state.credentials.get(r))
            .unwrap_or_else(|| Ok(String::new()))
    }
}

impl Drop for ConnectionLease {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.state.inner.lock() {
            if let Some(count) = inner.active.get_mut(&self.connection.id) {
                *count = count.saturating_sub(1);
            }
            if self.belongs_to_run {
                inner.run_leases = inner.run_leases.saturating_sub(1);
            }
        }
    }
}

fn valid_text(value: &str, limit: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= limit
        && !value.chars().any(char::is_control)
}

pub(super) fn endpoint(value: &str) -> Result<String, LlmError> {
    let url = url::Url::parse(value).map_err(|_| LlmError::InvalidConfiguration)?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(LlmError::InvalidConfiguration);
    }
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

fn validate_models(
    protocol: LlmProtocol,
    endpoint: &str,
    models: &[LlmModel],
) -> Result<(), LlmError> {
    let mut ids = HashSet::new();
    let mut provider_ids = HashSet::new();
    if models.len() > 256 {
        return Err(LlmError::InvalidConfiguration);
    }
    for model in models {
        reasoning::options(protocol, endpoint, model, model.reasoning)?;
        if model.context_window == Some(0)
            || model.max_output_tokens == Some(0)
            || !valid_text(&model.id, 128)
            || !ids.insert(&model.id)
            || !valid_text(&model.model_id, 256)
            || !provider_ids.insert(&model.model_id)
            || !valid_text(&model.name, 120)
        {
            return Err(LlmError::InvalidConfiguration);
        }
    }
    Ok(())
}

fn same_model_requests(previous: &[LlmModel], next: &[LlmModel]) -> bool {
    previous.len() == next.len()
        && previous.iter().all(|model| {
            next.iter().any(|candidate| {
                candidate.id == model.id
                    && candidate.model_id == model.model_id
                    && candidate.advertised_reasoning == model.advertised_reasoning
                    && candidate.max_output_tokens == model.max_output_tokens
                    && candidate.reasoning == model.reasoning
            })
        })
}

fn load(path: &std::path::Path) -> Result<Config, LlmError> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Config::default()),
        Err(_) => return Err(LlmError::ReadFailed),
    };
    let mut bytes = Vec::new();
    file.take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| LlmError::ReadFailed)?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(LlmError::TooLarge);
    }
    let config: Config = serde_json::from_slice(&bytes).map_err(|_| LlmError::ReadFailed)?;
    if config.version != 1 {
        return Err(LlmError::UnsupportedVersion);
    }
    let mut ids = HashSet::new();
    if config.connections.len() > 64 {
        return Err(LlmError::InvalidConfiguration);
    }
    for stored in &config.connections {
        let c = &stored.connection;
        if !valid_text(&c.id, 128)
            || !ids.insert(&c.id)
            || !valid_text(&c.name, 120)
            || c.revision == 0
            || c.has_key != stored.credential_ref.is_some()
        {
            return Err(LlmError::InvalidConfiguration);
        }
        endpoint(&c.endpoint)?;
        validate_models(c.protocol, &c.endpoint, &c.models)?;
    }
    if let Some(selected) = &config.default_model {
        selected_model(&config, selected)?;
    }
    Ok(config)
}

fn selected_model<'a>(
    config: &'a Config,
    selection: &ModelSelection,
) -> Result<(&'a StoredConnection, &'a LlmModel), LlmError> {
    let connection = config
        .connections
        .iter()
        .find(|c| c.connection.id == selection.connection_id)
        .ok_or(LlmError::ModelNotFound)?;
    let model = connection
        .connection
        .models
        .iter()
        .find(|m| m.id == selection.model_id)
        .ok_or(LlmError::ModelNotFound)?;
    Ok((connection, model))
}

impl LlmState {
    pub(super) fn open(path: PathBuf, credentials: Arc<dyn Credentials>) -> Result<Self, LlmError> {
        let (config, read_error) = match load(&path) {
            Ok(config) => (config, None),
            Err(error) => (Config::default(), Some(error)),
        };
        Ok(Self {
            path,
            credentials,
            read_error,
            inner: Mutex::new(Inner {
                config,
                active: HashMap::new(),
                run_leases: 0,
                update_receipts: HashMap::new(),
            }),
            receipt_salt: uuid::Uuid::new_v4(),
        })
    }

    fn file_lock(&self) -> Result<std::fs::File, LlmError> {
        if let Some(error) = self.read_error {
            return Err(error);
        }
        let parent = self.path.parent().ok_or(LlmError::WriteFailed)?;
        std::fs::create_dir_all(parent).map_err(|_| LlmError::WriteFailed)?;
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.path.with_extension("lock"))
            .map_err(|_| LlmError::WriteFailed)?;
        fs2::FileExt::lock_exclusive(&lock).map_err(|_| LlmError::WriteFailed)?;
        Ok(lock)
    }

    fn commit(&self, inner: &mut Inner, mut next: Config) -> Result<(), LlmError> {
        let parent = self.path.parent().ok_or(LlmError::WriteFailed)?;
        std::fs::create_dir_all(parent).map_err(|_| LlmError::WriteFailed)?;
        if load(&self.path)?.generation != inner.config.generation {
            return Err(LlmError::Conflict);
        }
        next.generation = next
            .generation
            .checked_add(1)
            .ok_or(LlmError::WriteFailed)?;
        crate::atomic_json::save(&self.path, &next, None).map_err(|_| LlmError::WriteFailed)?;
        inner.config = next;
        Ok(())
    }

    pub fn snapshot(&self) -> Result<LlmSnapshot, LlmError> {
        if let Some(error) = self.read_error {
            return Err(error);
        }
        let mut inner = self.inner.lock().map_err(|_| LlmError::ReadFailed)?;
        inner.config = load(&self.path)?;
        Ok(LlmSnapshot {
            connections: inner
                .config
                .connections
                .iter()
                .map(|c| c.connection.clone())
                .collect(),
            default_model: inner.config.default_model.clone(),
            cleanup_required: !inner.config.cleanup.is_empty(),
            reasoning_catalog: reasoning::catalog(),
        })
    }

    /// Database runs are counted from their persisted state, not again as leases.
    pub fn active_foreground(&self) -> u32 {
        self.inner
            .lock()
            .map(|i| {
                i.active
                    .values()
                    .sum::<usize>()
                    .saturating_sub(i.run_leases) as u32
            })
            .unwrap_or(1)
    }

    #[cfg(test)]
    pub fn update(&self, change: ConnectionChange) -> Result<LlmSnapshot, LlmError> {
        self.update_inner(change, None)
    }

    pub fn update_idempotent(
        &self,
        change: ConnectionChange,
        operation_id: String,
    ) -> Result<LlmSnapshot, LlmError> {
        if uuid::Uuid::parse_str(&operation_id).is_err() {
            return Err(LlmError::InvalidConfiguration);
        }
        let mut digest = DigestWriter(Sha256::new());
        digest.0.update(self.receipt_salt.as_bytes());
        serde_json::to_writer(&mut digest, &change).map_err(|_| LlmError::InvalidConfiguration)?;
        let fingerprint = digest.0.finalize().into();
        self.update_inner(change, Some((operation_id, fingerprint)))
    }

    fn update_inner(
        &self,
        change: ConnectionChange,
        operation: Option<(String, [u8; 32])>,
    ) -> Result<LlmSnapshot, LlmError> {
        if !valid_text(&change.name, 120) {
            return Err(LlmError::InvalidConfiguration);
        }
        let endpoint = endpoint(&change.endpoint)?;
        validate_models(change.protocol, &endpoint, &change.models)?;
        if let CredentialChange::Replace(ref value) = change.credential
            && (value.is_empty() || value.len() > 16 * 1024 || value.chars().any(char::is_control))
        {
            return Err(LlmError::InvalidConfiguration);
        }
        let mut inner = self.inner.lock().map_err(|_| LlmError::ReadFailed)?;
        if let Some((id, fingerprint)) = &operation {
            if let Some(previous) = inner.update_receipts.get(id) {
                if previous != fingerprint {
                    return Err(LlmError::Conflict);
                }
                drop(inner);
                return self.snapshot();
            }
            if inner.update_receipts.len() >= 4096 {
                return Err(LlmError::TooLarge);
            }
        }
        let file_lock = self.file_lock()?;
        let id = change
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let previous = inner
            .config
            .connections
            .iter()
            .find(|c| c.connection.id == id)
            .cloned();
        if previous.as_ref().map(|p| p.connection.revision) != change.expected_revision {
            return Err(LlmError::Conflict);
        }
        let changed_request = previous.as_ref().is_none_or(|p| {
            p.connection.protocol != change.protocol
                || p.connection.endpoint != endpoint
                || !same_model_requests(&p.connection.models, &change.models)
                || !matches!(change.credential, CredentialChange::Keep)
        });
        // Generation preference can change for future runs while an immutable lease
        // keeps its old model/settings. Endpoint/credentials/model replacement stays fenced.
        let reasoning_only = previous.as_ref().is_some_and(|p| {
            let mut old = p.connection.models.clone();
            let mut next = change.models.clone();
            for model in old.iter_mut().chain(next.iter_mut()) {
                model.reasoning = ReasoningSetting::Lowest;
            }
            p.connection.protocol == change.protocol
                && p.connection.endpoint == endpoint
                && same_model_requests(&old, &next)
                && matches!(change.credential, CredentialChange::Keep)
        });
        if changed_request && !reasoning_only && inner.active.get(&id).copied().unwrap_or(0) > 0 {
            return Err(LlmError::Busy);
        }
        if previous.is_none() && inner.config.connections.len() >= 64 {
            return Err(LlmError::TooLarge);
        }
        let old_ref = previous.as_ref().and_then(|p| p.credential_ref.clone());
        let credential_ref = match &change.credential {
            CredentialChange::Keep => old_ref.clone(),
            CredentialChange::Remove => None,
            CredentialChange::Replace(secret) => {
                let reference = uuid::Uuid::new_v4().to_string();
                // Journal only the reference before touching the credential store. A failed final
                // publication leaves the old connection usable and the orphan explicitly tracked.
                let mut staged = inner.config.clone();
                staged.cleanup.push(reference.clone());
                self.commit(&mut inner, staged)?;
                self.credentials.set(&reference, secret)?;
                Some(reference)
            }
        };
        let mut next = inner.config.clone();
        if let Some(r) = &credential_ref {
            next.cleanup.retain(|x| x != r);
        }
        if old_ref != credential_ref
            && let Some(r) = old_ref
        {
            next.cleanup.push(r);
        }
        let revision = previous
            .as_ref()
            .map(|p| p.connection.revision)
            .unwrap_or(0)
            .checked_add(u32::from(changed_request))
            .ok_or(LlmError::InvalidConfiguration)?;
        let connection = LlmConnection {
            id: id.clone(),
            name: change.name,
            protocol: change.protocol,
            endpoint,
            revision,
            has_key: credential_ref.is_some(),
            models: change.models,
            probes: previous.map(|p| p.connection.probes).unwrap_or_default(),
        };
        next.connections.retain(|c| c.connection.id != id);
        next.connections.push(StoredConnection {
            connection,
            credential_ref,
        });
        if next
            .default_model
            .as_ref()
            .is_some_and(|s| selected_model(&next, s).is_err())
        {
            next.default_model = None;
        }
        self.commit(&mut inner, next)?;
        if let Some((id, fingerprint)) = operation {
            inner.update_receipts.insert(id, fingerprint);
        }
        drop(inner);
        drop(file_lock);
        self.cleanup()?;
        self.snapshot()
    }

    pub fn cleanup(&self) -> Result<(), LlmError> {
        let mut inner = self.inner.lock().map_err(|_| LlmError::ReadFailed)?;
        let file_lock = self.file_lock()?;
        let mut next = inner.config.clone();
        next.cleanup.retain(|r| self.credentials.delete(r).is_err());
        if next.cleanup != inner.config.cleanup {
            self.commit(&mut inner, next)?;
        }
        drop(file_lock);
        Ok(())
    }

    pub fn delete(&self, id: &str, revision: u32) -> Result<LlmSnapshot, LlmError> {
        let mut inner = self.inner.lock().map_err(|_| LlmError::ReadFailed)?;
        let file_lock = self.file_lock()?;
        if inner.active.get(id).copied().unwrap_or(0) > 0 {
            return Err(LlmError::Busy);
        }
        let c = inner
            .config
            .connections
            .iter()
            .find(|c| c.connection.id == id)
            .ok_or(LlmError::ModelNotFound)?;
        if c.connection.revision != revision {
            return Err(LlmError::Conflict);
        }
        let mut next = inner.config.clone();
        if let Some(r) = &c.credential_ref {
            next.cleanup.push(r.clone());
        }
        next.connections.retain(|c| c.connection.id != id);
        if next
            .default_model
            .as_ref()
            .is_some_and(|s| s.connection_id == id)
        {
            next.default_model = None;
        }
        self.commit(&mut inner, next)?;
        drop(inner);
        drop(file_lock);
        self.cleanup()?;
        self.snapshot()
    }

    pub fn set_default(&self, selected: Option<ModelSelection>) -> Result<LlmSnapshot, LlmError> {
        let mut inner = self.inner.lock().map_err(|_| LlmError::ReadFailed)?;
        let file_lock = self.file_lock()?;
        if let Some(s) = &selected {
            selected_model(&inner.config, s)?;
        }
        let mut next = inner.config.clone();
        next.default_model = selected;
        self.commit(&mut inner, next)?;
        drop(inner);
        drop(file_lock);
        self.snapshot()
    }

    pub fn acquire(
        self: &Arc<Self>,
        selected: &ModelSelection,
    ) -> Result<ConnectionLease, LlmError> {
        self.acquire_model(selected, false)
    }

    pub fn acquire_for_run(
        self: &Arc<Self>,
        selected: &ModelSelection,
    ) -> Result<ConnectionLease, LlmError> {
        self.acquire_model(selected, true)
    }

    fn acquire_model(
        self: &Arc<Self>,
        selected: &ModelSelection,
        belongs_to_run: bool,
    ) -> Result<ConnectionLease, LlmError> {
        if let Some(error) = self.read_error {
            return Err(error);
        }
        let mut inner = self.inner.lock().map_err(|_| LlmError::ReadFailed)?;
        inner.config = load(&self.path)?;
        let (stored, model) = selected_model(&inner.config, selected)?;
        let lease = ConnectionLease {
            state: self.clone(),
            connection: stored.connection.clone(),
            model: model.clone(),
            credential_ref: stored.credential_ref.clone(),
            belongs_to_run,
        };
        *inner
            .active
            .entry(selected.connection_id.clone())
            .or_default() += 1;
        if belongs_to_run {
            inner.run_leases += 1;
        }
        Ok(lease)
    }

    pub fn acquire_connection(self: &Arc<Self>, id: &str) -> Result<ConnectionLease, LlmError> {
        if let Some(error) = self.read_error {
            return Err(error);
        }
        let mut inner = self.inner.lock().map_err(|_| LlmError::ReadFailed)?;
        inner.config = load(&self.path)?;
        let stored = inner
            .config
            .connections
            .iter()
            .find(|c| c.connection.id == id)
            .ok_or(LlmError::ModelNotFound)?;
        let lease = ConnectionLease {
            state: self.clone(),
            connection: stored.connection.clone(),
            model: LlmModel {
                advertised_reasoning: None,
                context_window: None,
                reasoning: ReasoningSetting::Lowest,
                max_output_tokens: None,
                id: String::new(),
                model_id: String::new(),
                name: String::new(),
            },
            credential_ref: stored.credential_ref.clone(),
            belongs_to_run: false,
        };
        *inner.active.entry(id.to_owned()).or_default() += 1;
        Ok(lease)
    }

    pub fn record_probe(
        &self,
        selected: &ModelSelection,
        probe: ProbeResult,
    ) -> Result<LlmSnapshot, LlmError> {
        let mut inner = self.inner.lock().map_err(|_| LlmError::ReadFailed)?;
        let file_lock = self.file_lock()?;
        let (stored, _) = selected_model(&inner.config, selected)?;
        if stored.connection.revision != probe.revision {
            return Err(LlmError::Conflict);
        }
        let mut next = inner.config.clone();
        let c = next
            .connections
            .iter_mut()
            .find(|c| c.connection.id == selected.connection_id)
            .ok_or(LlmError::ModelNotFound)?;
        c.connection
            .probes
            .retain(|p| p.model_id != probe.model_id || p.kind != probe.kind);
        c.connection.probes.push(probe);
        self.commit(&mut inner, next)?;
        drop(inner);
        drop(file_lock);
        self.snapshot()
    }
}
