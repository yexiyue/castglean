use castglean_core::{
    AnalysisModel, ModelError, ModelRequest, ModelResponse, TokenUsage,
    analysis_suggestion_schema_for,
};
use genai::{
    Client,
    chat::{
        ChatMessage, ChatOptions, ChatRequest, ChatResponseFormat, JsonSpec, ReasoningEffort,
        StopReason, Tool, ToolChoice,
    },
    resolver::{AuthData, AuthResolver, Endpoint, ServiceTargetResolver},
};

/// Model default matching comfy-agent.
pub const DEFAULT_GLM_MODEL: &str = "bigmodel::glm-4.6";
/// Domestic BigModel Coding Plan endpoint matching comfy-agent.
pub const DEFAULT_GLM_ENDPOINT: &str = "https://open.bigmodel.cn/api/coding/paas/v4/";
const SUBMIT_TOOL: &str = "submit_analysis";

/// Explicit output transport; unsupported modes fail without automatic fallback.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum GlmOutputMode {
    /// Request JSON object output.
    #[default]
    Json,
    /// Request strict JSON Schema output; enforcement depends on the endpoint.
    Schema,
    /// Require exactly one submission tool call, without executing a tool loop.
    Tool,
}
impl GlmOutputMode {
    /// Configuration value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Schema => "schema",
            Self::Tool => "tool",
        }
    }
}
impl std::str::FromStr for GlmOutputMode {
    type Err = ModelError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "json" => Ok(Self::Json),
            "schema" => Ok(Self::Schema),
            "tool" => Ok(Self::Tool),
            _ => Err(ModelError::Configuration),
        }
    }
}

/// Explicit GLM thinking budget; supported values depend on the chosen model.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum GlmReasoningEffort {
    /// Lower thinking budget, the analysis default.
    #[default]
    Low,
    /// Higher thinking budget.
    High,
    /// Maximum thinking budget.
    Max,
}
impl GlmReasoningEffort {
    /// Provider parameter value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::High => "high",
            Self::Max => "max",
        }
    }
    fn sdk_effort(self) -> ReasoningEffort {
        match self {
            Self::Low => ReasoningEffort::Low,
            Self::High => ReasoningEffort::High,
            Self::Max => ReasoningEffort::Max,
        }
    }
}
impl std::str::FromStr for GlmReasoningEffort {
    type Err = ModelError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "low" => Ok(Self::Low),
            "high" => Ok(Self::High),
            "max" => Ok(Self::Max),
            _ => Err(ModelError::Configuration),
        }
    }
}

/// Validated explicit configuration, without Debug or Serialize.
pub struct GlmConfig {
    model: String,
    endpoint: String,
    api_key: String,
    reasoning_effort: GlmReasoningEffort,
    output_mode: GlmOutputMode,
}
impl GlmConfig {
    /// Validate BigModel values without reading environment variables.
    pub fn new(
        model: impl Into<String>,
        endpoint: impl Into<String>,
        api_key: impl Into<String>,
    ) -> Result<Self, ModelError> {
        let model = model.into();
        let endpoint = endpoint.into();
        let api_key = api_key.into();
        if !model.starts_with("bigmodel::")
            || model.trim() != model
            || model["bigmodel::".len()..].trim().is_empty()
            || api_key.trim().is_empty()
            || api_key.contains(['\r', '\n'])
        {
            return Err(ModelError::Configuration);
        }
        let mut endpoint =
            url::Url::parse(endpoint.trim()).map_err(|_| ModelError::Configuration)?;
        if !matches!(endpoint.scheme(), "http" | "https")
            || endpoint.host_str().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(ModelError::Configuration);
        }
        endpoint.set_path(&format!("{}/", endpoint.path().trim_end_matches('/')));
        Ok(Self {
            model,
            endpoint: endpoint.to_string(),
            api_key,
            reasoning_effort: GlmReasoningEffort::default(),
            output_mode: GlmOutputMode::default(),
        })
    }
    /// Configured model ID.
    pub fn model(&self) -> &str {
        &self.model
    }
    /// Normalized service endpoint.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
    /// Set an explicit thinking budget without changing process configuration.
    pub fn with_reasoning_effort(mut self, effort: GlmReasoningEffort) -> Self {
        self.reasoning_effort = effort;
        self
    }
    /// Requested thinking budget.
    pub fn reasoning_effort(&self) -> GlmReasoningEffort {
        self.reasoning_effort
    }
    /// Select the structured output transport explicitly.
    pub fn with_output_mode(mut self, mode: GlmOutputMode) -> Self {
        self.output_mode = mode;
        self
    }
    /// Requested output transport.
    pub fn output_mode(&self) -> GlmOutputMode {
        self.output_mode
    }
}
/// GLM implementation of the core analysis model interface.
pub struct GlmModel {
    client: Client,
    model: String,
    reasoning_effort: GlmReasoningEffort,
    output_mode: GlmOutputMode,
}
impl GlmModel {
    /// Build a client from explicit values, reusing the host runtime.
    pub fn new(config: GlmConfig) -> Result<Self, ModelError> {
        let key = config.api_key;
        let endpoint = config.endpoint;
        let client = Client::builder()
            .with_auth_resolver(AuthResolver::from_resolver_fn(move |_| {
                Ok(Some(AuthData::Key(key.clone())))
            }))
            .with_service_target_resolver(ServiceTargetResolver::from_resolver_fn(
                move |mut target: genai::ServiceTarget| {
                    target.endpoint = Endpoint::from_owned(endpoint.clone());
                    Ok(target)
                },
            ))
            .build()
            .map_err(|_| ModelError::Transport)?;
        Ok(Self {
            client,
            model: config.model,
            reasoning_effort: config.reasoning_effort,
            output_mode: config.output_mode,
        })
    }
}
impl AnalysisModel for GlmModel {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        let mut options = ChatOptions::default()
            .with_max_tokens(request.max_output_tokens)
            .with_reasoning_effort(self.reasoning_effort.sdk_effort());
        let mut chat = ChatRequest::new(vec![
            ChatMessage::system(request.system),
            ChatMessage::user(request.user),
        ]);
        match self.output_mode {
            GlmOutputMode::Json => {
                options = options.with_response_format(ChatResponseFormat::JsonMode)
            }
            GlmOutputMode::Schema => {
                options = options.with_response_format(JsonSpec::new(
                    "analysis",
                    analysis_suggestion_schema_for(request.evidence_mode).to_value(),
                ))
            }
            GlmOutputMode::Tool => {
                options = options.with_tool_choice(ToolChoice::tool(SUBMIT_TOOL));
                chat = chat.with_tools(vec![Tool::new(SUBMIT_TOOL)
                    .with_description("Submit character and segment suggestions for this window. This returns data only and performs no action.")
                    .with_schema(analysis_suggestion_schema_for(request.evidence_mode).to_value())
                    .with_strict(true)]);
            }
        }
        let response = self
            .client
            .exec_chat(&self.model, chat, Some(&options))
            .await
            .map_err(safe_error)?;
        let truncated = response
            .stop_reason
            .as_ref()
            .is_some_and(StopReason::is_max_tokens);
        let valid_stop = match (self.output_mode, response.stop_reason.as_ref()) {
            (_, Some(StopReason::MaxTokens(_))) => true,
            (GlmOutputMode::Tool, Some(StopReason::ToolCall(_))) => true,
            (GlmOutputMode::Tool, _) => false,
            (_, None | Some(StopReason::Completed(_))) => true,
            _ => false,
        };
        if !valid_stop {
            return Err(ModelError::Response);
        }
        let usage = TokenUsage {
            input: response
                .usage
                .prompt_tokens
                .and_then(|n| u64::try_from(n).ok()),
            output: response
                .usage
                .completion_tokens
                .and_then(|n| u64::try_from(n).ok()),
            reasoning: response
                .usage
                .completion_tokens_details
                .as_ref()
                .and_then(|details| details.reasoning_tokens)
                .and_then(|n| u64::try_from(n).ok()),
        };
        let text = if self.output_mode == GlmOutputMode::Tool {
            let calls = response.into_tool_calls();
            if calls.len() != 1
                || calls[0].fn_name != SUBMIT_TOOL
                || !calls[0].fn_arguments.is_object()
            {
                return Err(ModelError::Response);
            }
            serde_json::to_string(&calls[0].fn_arguments).map_err(|_| ModelError::Response)?
        } else {
            if !response.tool_calls().is_empty() {
                return Err(ModelError::Response);
            }
            response
                .into_first_text()
                .filter(|t| !t.trim().is_empty())
                .ok_or(ModelError::Response)?
        };
        Ok(ModelResponse {
            text,
            truncated,
            usage,
        })
    }
}
fn safe_error(error: genai::Error) -> ModelError {
    match error.status().map(|status| status.as_u16()) {
        Some(401 | 403) => ModelError::Authentication,
        Some(429) => ModelError::RateLimited,
        _ => match error {
            genai::Error::ChatResponseGeneration { .. }
            | genai::Error::NoChatResponse { .. }
            | genai::Error::SerdeJson(_)
            | genai::Error::JsonValueExt(_) => ModelError::Response,
            _ => ModelError::Transport,
        },
    }
}
