//! Rig is the provider boundary. Callers receive normalized data and safe failure categories.
use super::{config::ConnectionLease, types::*};
use rig_core::{
    DynModel,
    completion::{CompletionRequest, CompletionResponse, ToolDefinition},
    message::{Message, ToolChoice},
    operation::Completion,
    providers::{anthropic::AnthropicConfig, gemini::GeminiConfig, openai::OpenAIConfig},
};
use serde_json::json;
use std::time::Duration;

pub(crate) fn failure(error: rig_core::error::ProviderError) -> LlmError {
    let report = error.report();
    match report.http_status {
        Some(401 | 403) => LlmError::Authentication,
        Some(404) => LlmError::ModelNotFound,
        Some(400 | 405 | 422) => LlmError::CapabilityUnavailable,
        _ => match report.kind {
            rig_core::error::ErrorKind::Timeout => LlmError::Timeout,
            rig_core::error::ErrorKind::Http => LlmError::Network,
            _ => LlmError::InvalidResponse,
        },
    }
}

fn http(endpoint: &str) -> Result<super::transport::BoundedHttp, LlmError> {
    super::transport::BoundedHttp::new(endpoint)
}

pub(crate) fn model(lease: &ConnectionLease) -> Result<DynModel<Completion>, LlmError> {
    model_with_account(lease, None)
}
pub(crate) fn model_with_account(
    lease: &ConnectionLease,
    account: Option<super::transport::RequestAccounting>,
) -> Result<DynModel<Completion>, LlmError> {
    let transport = match account {
        Some(account) => http(&lease.connection.endpoint)?.with_account(account),
        None => http(&lease.connection.endpoint)?,
    };
    let key = lease.key()?;
    let endpoint = &lease.connection.endpoint;
    let id = &lease.model.model_id;
    Ok(match lease.connection.protocol {
        LlmProtocol::Openai => OpenAIConfig::new(key)
            .with_base_url(endpoint)
            .connect(transport.clone())
            .chat(id)
            .erase(),
        LlmProtocol::Anthropic => AnthropicConfig::new(key)
            .with_base_url(endpoint)
            .connect(transport.clone())
            .completion(id)
            .erase(),
        LlmProtocol::Gemini => GeminiConfig::new(key)
            .with_base_url(endpoint)
            .connect(transport.clone())
            .completion(id)
            .erase(),
    })
}

pub(crate) async fn call(
    model: &DynModel<Completion>,
    request: CompletionRequest,
) -> Result<CompletionResponse, LlmError> {
    if serde_json::to_vec(&request)
        .map_err(|_| LlmError::InvalidConfiguration)?
        .len()
        > 128 * 1024
    {
        return Err(LlmError::TooLarge);
    }
    let response = tokio::time::timeout(Duration::from_secs(120), model.call(request))
        .await
        .map_err(|_| LlmError::Timeout)?
        .map_err(failure)?;
    if serde_json::to_vec(&response)
        .map_err(|_| LlmError::InvalidResponse)?
        .len()
        > 256 * 1024
    {
        return Err(LlmError::TooLarge);
    }
    if response.error.is_some()
        || response.aborted.is_some()
        || response
            .finish_reason()
            .is_some_and(|r| r.truncated_output())
    {
        return Err(LlmError::InvalidResponse);
    }
    Ok(response)
}

pub(crate) async fn list(lease: &ConnectionLease) -> Result<Vec<LlmModel>, LlmError> {
    let key = lease.key()?;
    let endpoint = &lease.connection.endpoint;
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        match lease.connection.protocol {
            LlmProtocol::Openai => OpenAIConfig::new(key)
                .with_base_url(endpoint)
                .connect(http(endpoint)?)
                .list_models()
                .await
                .map_err(failure),
            LlmProtocol::Anthropic => AnthropicConfig::new(key)
                .with_base_url(endpoint)
                .connect(http(endpoint)?)
                .list_models()
                .await
                .map_err(failure),
            LlmProtocol::Gemini => GeminiConfig::new(key)
                .with_base_url(endpoint)
                .connect(http(endpoint)?)
                .list_models()
                .await
                .map_err(failure),
        }
    })
    .await
    .map_err(|_| LlmError::Timeout)??;
    if result.len() > 4096 {
        return Err(LlmError::TooLarge);
    }
    Ok(result
        .data
        .into_iter()
        .map(|m| LlmModel {
            name: m.name.unwrap_or_else(|| m.id.clone()),
            model_id: m.id.clone(),
            id: m.id,
        })
        .collect())
}

pub(super) async fn probe(lease: &ConnectionLease, kind: ProbeKind) -> Result<(), LlmError> {
    let model = model(lease)?;
    match kind {
        ProbeKind::Connection => {
            let response = call(
                &model,
                CompletionRequest::new("Reply with OK.").max_tokens(2048),
            )
            .await?;
            if response.text().trim().is_empty() {
                return Err(LlmError::InvalidResponse);
            }
        }
        ProbeKind::Structured => {
            let schema = schemars::Schema::try_from(json!({"type":"object","properties":{"ok":{"type":"boolean","const":true}},"required":["ok"],"additionalProperties":false}))
                .map_err(|_| LlmError::InvalidConfiguration)?;
            let response = call(
                &model,
                CompletionRequest::new("Return an object with ok set to true.")
                    .max_tokens(2048)
                    .output_schema(schema),
            )
            .await?;
            let value: serde_json::Value = serde_json::from_str(&response.text())
                .map_err(|_| LlmError::CapabilityUnavailable)?;
            if value != json!({"ok":true}) {
                return Err(LlmError::CapabilityUnavailable);
            }
        }
        ProbeKind::Tools => {
            let name = rig_core::message::ToolName::new("connection_probe")
                .map_err(|_| LlmError::InvalidConfiguration)?;
            let tool = ToolDefinition::new(
                name.clone(),
                "Return a locally generated verification token. Call exactly once.",
                json!({"type":"object","properties":{},"additionalProperties":false}),
            );
            let response = call(
                &model,
                CompletionRequest::new(
                    "Call connection_probe once, then reply with the exact token it returns.",
                )
                .max_tokens(2048)
                .tool(tool)
                .tool_choice(ToolChoice::Required),
            )
            .await?;
            let calls: Vec<_> = response.tool_calls().collect();
            if calls.len() != 1
                || calls[0].function.name != name
                || !calls[0].function.arguments.is_empty()
            {
                return Err(LlmError::CapabilityUnavailable);
            }
            let token = uuid::Uuid::new_v4().to_string();
            let result = Message::User {
                content: vec![rig_core::message::UserContent::ToolResult(
                    rig_core::message::ToolResult {
                        call: calls[0].id.clone(),
                        name,
                        is_error: false,
                        content: vec![rig_core::message::ToolResultContent::text(&token)],
                    },
                )],
            };
            let followup = CompletionRequest::new(result)
                .message(Message::user(
                    "Call connection_probe once, then repeat its token.",
                ))
                .message(response.message().ok_or(LlmError::InvalidResponse)?)
                .max_tokens(2048);
            if !call(&model, followup).await?.text().contains(&token) {
                return Err(LlmError::CapabilityUnavailable);
            }
        }
    }
    Ok(())
}
