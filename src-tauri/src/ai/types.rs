//! Application contracts. Database rows and framework types never cross IPC.
use super::messages::MessageParts;
use crate::llm::ModelSelection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type, thiserror::Error)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AiError {
    #[error("invalid_request")]
    InvalidRequest,
    #[error("not_found")]
    NotFound,
    #[error("conflict")]
    Conflict,
    #[error("busy")]
    Busy,
    #[error("configuration_changed")]
    ConfigurationChanged,
    #[error("configuration_unavailable")]
    ConfigurationUnavailable,
    #[error("budget_exhausted")]
    BudgetExhausted,
    #[error("storage_failed")]
    StorageFailed,
}
impl From<sea_orm::DbErr> for AiError {
    fn from(_: sea_orm::DbErr) -> Self {
        Self::StorageFailed
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Configuration {
    pub selection: ModelSelection,
    pub revision: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Budget {
    pub requests: u32,
    pub input_bytes: u32,
    pub tool_calls: u32,
    pub tool_bytes: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RunStatus {
    Queued,
    Running,
    Cancelling,
    WaitingForInput,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RunFailure {
    Interrupted,
    Cancelled,
    Timeout,
    BudgetExhausted,
    ConfigurationChanged,
    ConfigurationUnavailable,
    StaleProject,
    InvalidResponse,
    ToolFailed,
    StorageFailed,
    Unknown,
}
impl RunStatus {
    pub(crate) fn parse(value: &str) -> Result<Self, AiError> {
        serde_json::from_value(serde_json::Value::String(value.into()))
            .map_err(|_| AiError::StorageFailed)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateSession {
    pub id: String,
    pub project_id: String,
    pub task_kind: String,
    pub chapter_id: Option<String>,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Trigger {
    Message { message: String },
    Retry { run_id: String },
    Continue { run_id: String, message: String },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceAction {
    #[default]
    Auto,
    Split,
    Analyze,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceContext {
    pub action: WorkspaceAction,
    pub chapter_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartRun {
    #[serde(default)]
    pub workspace_context: Option<WorkspaceContext>,
    pub session_id: String,
    pub request_id: String,
    pub configuration: Configuration,
    pub confirm_rebind: bool,
    pub expected_project_revision: u32,
    pub trigger: Trigger,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionInfo {
    pub id: String,
    pub project_id: String,
    pub task_kind: String,
    pub chapter_id: Option<String>,
    pub title: String,
    pub configuration: Option<Configuration>,
    pub budget: Budget,
    pub sequence: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunInfo {
    pub workspace_context: Option<WorkspaceContext>,
    pub id: String,
    pub session_id: String,
    pub retry_of: Option<String>,
    pub status: RunStatus,
    pub configuration: Configuration,
    pub base_revision: u32,
    pub budget: Budget,
    pub error: Option<RunFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TokenUsage {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub cached_input_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Message {
    pub usage: Option<TokenUsage>,
    pub id: String,
    pub run_id: Option<String>,
    pub ordinal: u32,
    pub role: String,
    pub version: u32,
    pub parts: MessageParts,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryPage {
    pub contexts: std::collections::BTreeMap<String, WorkspaceContext>,
    pub session: SessionInfo,
    pub messages: Vec<Message>,
    pub run: Option<RunInfo>,
    pub before: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SessionCursor {
    pub created_at: String,
    pub id: String,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionPage {
    pub sessions: Vec<SessionInfo>,
    pub before: Option<SessionCursor>,
}

pub(super) fn encode<T: Serialize>(value: &T) -> Result<serde_json::Value, AiError> {
    serde_json::to_value(value).map_err(|_| AiError::InvalidRequest)
}
pub(super) fn decode<T: serde::de::DeserializeOwned>(
    value: serde_json::Value,
) -> Result<T, AiError> {
    serde_json::from_value(value).map_err(|_| AiError::StorageFailed)
}
