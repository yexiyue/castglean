//! MiniMax final-text JSON, with explicit domestic endpoint and credentials.
use castglean_core::{AnalysisModel, ModelError, ModelRequest, ModelResponse};
use reqwest::header::HeaderValue;
use serde_json::json;

/// Default verified MiniMax model.
pub const DEFAULT_MINIMAX_MODEL: &str = "MiniMax-M2.5";
/// Official domestic OpenAI-compatible API base.
pub const DEFAULT_MINIMAX_ENDPOINT: &str = "https://api.minimax.cn/v1/";

/// Explicit configuration; credentials are never serialized or debug formatted.
pub struct MiniMaxConfig {
    model: String,
    endpoint: url::Url,
    authorization: HeaderValue,
}
impl MiniMaxConfig {
    /// Validate a model, HTTPS service base (HTTP allowed on loopback) and API key.
    pub fn new(
        model: impl Into<String>,
        endpoint: &str,
        key: impl Into<String>,
    ) -> Result<Self, ModelError> {
        let (model, endpoint) = crate::chat_completion::configuration(model, endpoint)?;
        if endpoint.scheme() != "https"
            && !matches!(
                endpoint.host_str(),
                Some("127.0.0.1" | "localhost" | "[::1]")
            )
        {
            return Err(ModelError::Configuration);
        }
        let key = key.into();
        if key.is_empty() || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(ModelError::Configuration);
        }
        let mut authorization = HeaderValue::from_str(&format!("Bearer {key}"))
            .map_err(|_| ModelError::Configuration)?;
        authorization.set_sensitive(true);
        Ok(Self {
            model,
            endpoint,
            authorization,
        })
    }
    /// Service model identifier.
    pub fn model(&self) -> &str {
        &self.model
    }
    /// Normalized service base.
    pub fn endpoint(&self) -> &str {
        self.endpoint.as_str()
    }
}

/// One final-text request; core owns validation, repair, deadlines and cancellation.
///
/// MiniMax thinking stays enabled. The service separates it from final content;
/// only final content is returned for JSON validation. No Schema enforcement is assumed.
pub struct MiniMaxModel {
    config: MiniMaxConfig,
    client: reqwest::Client,
}
impl MiniMaxModel {
    /// Build an isolated client without redirects or implicit retries.
    pub fn new(config: MiniMaxConfig) -> Result<Self, ModelError> {
        Ok(Self {
            config,
            client: crate::chat_completion::client()?,
        })
    }
}
impl AnalysisModel for MiniMaxModel {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        let endpoint = self
            .config
            .endpoint
            .join("chat/completions")
            .map_err(|_| ModelError::Configuration)?;
        crate::chat_completion::send(self.client.post(endpoint)
            .header(reqwest::header::AUTHORIZATION, self.config.authorization.clone())
            .json(&json!({
                "model":self.config.model,
                "messages":[{"role":"system","content":request.system},{"role":"user","content":request.user}],
                "max_completion_tokens":request.max_output_tokens,
                "temperature":0, "stream":false, "reasoning_split":true
            }))).await
    }
}
