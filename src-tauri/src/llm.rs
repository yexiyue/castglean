//! LLM connections own credentials and model configuration, independently of speech resources.
pub(crate) mod commands;
mod config;
mod credentials;
mod providers;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;
mod transport;
#[cfg(test)]
pub(crate) use transport::BoundedHttp as TestHttp;
mod types;

pub(crate) use config::LlmState;
pub(crate) use providers::failure as provider_failure;
pub(crate) use providers::{call_run as complete, model_with_account as configured_model};
use std::sync::Arc;
use tauri::Manager;
pub(crate) use types::{LlmError, LlmModel, ModelSelection, ReasoningSetting};

pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let path = app.path().app_config_dir()?.join("llm-connections.json");
    app.manage(Arc::new(LlmState::open(
        path,
        Arc::new(credentials::SystemCredentials),
    )?));
    Ok(())
}
