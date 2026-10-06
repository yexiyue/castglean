//! Bounded Chat Completions transport and final-content decoding.
use castglean_core::{ModelError, ModelResponse, TokenUsage};
use serde_json::Value;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

pub(super) fn client() -> Result<reqwest::Client, ModelError> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .map_err(|_| ModelError::Configuration)
}

pub(super) async fn send(request: reqwest::RequestBuilder) -> Result<ModelResponse, ModelError> {
    let mut response = request.send().await.map_err(|_| ModelError::Transport)?;
    match response.status().as_u16() {
        200..=299 => {}
        401 | 403 => return Err(ModelError::Authentication),
        429 => return Err(ModelError::RateLimited),
        _ => return Err(ModelError::Transport),
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_RESPONSE_BYTES as u64)
    {
        return Err(ModelError::Response);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ModelError::Transport)? {
        if chunk.len() > MAX_RESPONSE_BYTES - bytes.len() {
            return Err(ModelError::Response);
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| ModelError::Response)?;
    if let Some(base) = value.get("base_resp") {
        let code = base["status_code"].as_i64().ok_or(ModelError::Response)?;
        match code {
            0 => {}
            1004 | 2049 => return Err(ModelError::Authentication),
            1002 | 2045 | 2056 => return Err(ModelError::RateLimited),
            2013 => return Err(ModelError::Configuration),
            _ => return Err(ModelError::Transport),
        }
    }
    let choices = value["choices"]
        .as_array()
        .filter(|c| c.len() == 1)
        .ok_or(ModelError::Response)?;
    let choice = &choices[0];
    let truncated = match choice["finish_reason"].as_str() {
        Some("stop") => false,
        Some("length") => true,
        _ => return Err(ModelError::Response),
    };
    if !choice["message"]["tool_calls"].is_null()
        && choice["message"]["tool_calls"]
            .as_array()
            .is_none_or(|c| !c.is_empty())
    {
        return Err(ModelError::Response);
    }
    let text = match choice["message"]["content"].as_str() {
        Some(text) if truncated || !text.trim().is_empty() => text.to_owned(),
        None if truncated && choice["message"]["content"].is_null() => String::new(),
        _ => return Err(ModelError::Response),
    };
    Ok(ModelResponse {
        text,
        truncated,
        usage: TokenUsage {
            input: value["usage"]["prompt_tokens"].as_u64(),
            output: value["usage"]["completion_tokens"].as_u64(),
            reasoning: value["usage"]["completion_tokens_details"]["reasoning_tokens"].as_u64(),
        },
    })
}

pub(super) fn configuration(
    model: impl Into<String>,
    endpoint: &str,
) -> Result<(String, url::Url), ModelError> {
    let model = model.into();
    let mut endpoint = url::Url::parse(endpoint).map_err(|_| ModelError::Configuration)?;
    if model.trim().is_empty()
        || model.trim() != model
        || model.chars().any(char::is_control)
        || !matches!(endpoint.scheme(), "http" | "https")
        || endpoint.host_str().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(ModelError::Configuration);
    }
    endpoint.set_path(&format!("{}/", endpoint.path().trim_end_matches('/')));
    Ok((model, endpoint))
}
