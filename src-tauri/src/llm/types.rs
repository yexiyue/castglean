//! Application-owned configuration and errors; no provider or credential values cross reads.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LlmProtocol {
    Openai,
    Anthropic,
    Gemini,
}

/// App-owned names; Rig's provider-specific effort/budget encoding stays in Rust.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReasoningSetting {
    #[default]
    Lowest,
    ProviderDefault,
    Off,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelReasoning {
    pub protocol: LlmProtocol,
    pub model_id: String,
    pub choices: Vec<ReasoningSetting>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LlmModel {
    #[serde(default)]
    pub context_window: Option<u32>,
    /// Absent in older configuration files: select the lowest known supported setting.
    #[serde(default)]
    pub reasoning: ReasoningSetting,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    pub id: String,
    pub model_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModelSelection {
    pub connection_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProbeKind {
    Connection,
    Tools,
    Structured,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProbeResult {
    pub model_id: String,
    pub kind: ProbeKind,
    pub revision: u32,
    pub tested_at: String,
    pub failure: Option<LlmError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LlmConnection {
    pub id: String,
    pub name: String,
    pub protocol: LlmProtocol,
    pub endpoint: String,
    pub revision: u32,
    pub has_key: bool,
    pub models: Vec<LlmModel>,
    pub probes: Vec<ProbeResult>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LlmSnapshot {
    pub connections: Vec<LlmConnection>,
    pub default_model: Option<ModelSelection>,
    pub cleanup_required: bool,
    /// Local capability facts, not a claim that a configured endpoint has been probed.
    pub reasoning_catalog: Vec<ModelReasoning>,
}

// Deliberately no Debug: a command may carry a fresh credential.
#[derive(Deserialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub(crate) enum CredentialChange {
    Keep,
    Replace(String),
    Remove,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConnectionChange {
    pub id: Option<String>,
    pub expected_revision: Option<u32>,
    pub name: String,
    pub protocol: LlmProtocol,
    pub endpoint: String,
    pub models: Vec<LlmModel>,
    pub credential: CredentialChange,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type, thiserror::Error,
)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LlmError {
    #[error("invalid_configuration")]
    InvalidConfiguration,
    #[error("unsupported_version")]
    UnsupportedVersion,
    #[error("configuration_conflict")]
    Conflict,
    #[error("configuration_busy")]
    Busy,
    #[error("configuration_read_failed")]
    ReadFailed,
    #[error("configuration_write_failed")]
    WriteFailed,
    #[error("credential_unavailable")]
    CredentialUnavailable,
    #[error("model_not_found")]
    ModelNotFound,
    #[error("authentication_failed")]
    Authentication,
    #[error("network_failed")]
    Network,
    #[error("request_timed_out")]
    Timeout,
    #[error("capability_unavailable")]
    CapabilityUnavailable,
    #[error("invalid_response")]
    InvalidResponse,
    #[error("request_cancelled")]
    Cancelled,
    #[error("request_too_large")]
    TooLarge,
}
