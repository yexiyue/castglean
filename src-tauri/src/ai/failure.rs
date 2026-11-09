//! Shared safe execution failure classification for both native Agent paths.
use super::RunFailure;

pub(crate) fn provider(error: crate::llm::LlmError) -> RunFailure {
    use crate::llm::LlmError;
    match error {
        LlmError::Timeout => RunFailure::Timeout,
        LlmError::Cancelled => RunFailure::Cancelled,
        LlmError::Authentication
        | LlmError::CredentialUnavailable
        | LlmError::ModelNotFound
        | LlmError::CapabilityUnavailable
        | LlmError::InvalidConfiguration => RunFailure::ConfigurationUnavailable,
        LlmError::TooLarge => RunFailure::BudgetExhausted,
        LlmError::Network => RunFailure::Unknown,
        _ => RunFailure::InvalidResponse,
    }
}

pub(crate) fn prompt(error: rig_agent::run::PromptError) -> RunFailure {
    use rig_agent::run::PromptError;
    use rig_core::error::{ErrorKind, ProviderError};
    match error {
        PromptError::Provider(e) => provider(crate::llm::provider_failure(e)),
        PromptError::Report(report) if matches!(report.kind, ErrorKind::Tool(_)) => {
            RunFailure::ToolFailed
        }
        PromptError::Report(report) => provider(crate::llm::provider_failure(
            ProviderError::Relayed(Box::new(report)),
        )),
        PromptError::Cancelled { .. } => RunFailure::Cancelled,
        PromptError::MaxTurns { .. } => RunFailure::BudgetExhausted,
        PromptError::Memory { .. } => RunFailure::StorageFailed,
        PromptError::UnknownToolCall { .. } => RunFailure::ToolFailed,
        _ => RunFailure::InvalidResponse,
    }
}
