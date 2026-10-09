use castglean_core::{
    AnalysisModel, ModelError, ModelRequest, ModelResponse, analysis_suggestion_schema_for,
};
use serde_json::json;

/// Default model alias served by mistral.rs.
pub const DEFAULT_LOCAL_MODEL: &str = "default";
/// Default loopback OpenAI-compatible API base URL.
pub const DEFAULT_LOCAL_ENDPOINT: &str = "http://127.0.0.1:1234/v1/";

/// Validated, credential-free service configuration; never reads the environment.
pub struct LocalConfig {
    model: String,
    endpoint: url::Url,
}
impl LocalConfig {
    /// Validate the model alias and HTTP/HTTPS API base, including an optional path.
    pub fn new(model: impl Into<String>, endpoint: &str) -> Result<Self, ModelError> {
        let (model, endpoint) = crate::chat_completion::configuration(model, endpoint)?;
        Ok(Self { model, endpoint })
    }
    /// Service model alias.
    pub fn model(&self) -> &str {
        &self.model
    }
    /// Normalized API base URL.
    pub fn endpoint(&self) -> &str {
        self.endpoint.as_str()
    }
}

/// Local Chat Completions adapter using Schema output and disabled thinking.
///
/// The host owns the Tokio runtime, request deadline and cancellation. This
/// adapter performs one HTTP request, without retries or process management.
///
/// ```
/// use castglean_model::{LocalConfig, LocalModel, DEFAULT_LOCAL_ENDPOINT};
/// let model = LocalModel::new(LocalConfig::new("default", DEFAULT_LOCAL_ENDPOINT)?)?;
/// // Pass &model to castglean_core::analyze_chapter on the host runtime.
/// # Ok::<(), castglean_core::ModelError>(())
/// ```
pub struct LocalModel {
    client: reqwest::Client,
    config: LocalConfig,
}
impl LocalModel {
    /// Construct a client without proxies, redirects or implicit authentication.
    pub fn new(config: LocalConfig) -> Result<Self, ModelError> {
        let client = crate::chat_completion::client()?;
        Ok(Self { client, config })
    }
}
impl AnalysisModel for LocalModel {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        let endpoint = self
            .config
            .endpoint
            .join("chat/completions")
            .map_err(|_| ModelError::Configuration)?;
        let payload = json!({
            "model": self.config.model,
            "messages": [{"role":"system","content":request.system},
                         {"role":"user","content":request.user}],
            "max_tokens": request.max_output_tokens,
            "temperature": 0, "stream": false,
            "enable_thinking": false, "reasoning_effort": "off",
            "response_format": {"type":"json_schema","json_schema":{
                "name":"analysis", "schema":analysis_suggestion_schema_for(request.evidence_mode)
            }}
        });
        crate::chat_completion::send(self.client.post(endpoint).json(&payload)).await
    }
}
