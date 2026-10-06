//! CLI model selection, configuration precedence and backend assembly.
use crate::cli::CliError;
use castglean_core::{AnalysisModel, ModelError, ModelRequest, ModelResponse};
use castglean_model::{
    DEFAULT_GLM_ENDPOINT, DEFAULT_GLM_MODEL, DEFAULT_LOCAL_ENDPOINT, DEFAULT_LOCAL_MODEL,
    DEFAULT_MINIMAX_ENDPOINT, DEFAULT_MINIMAX_MODEL, GlmConfig, GlmModel, GlmOutputMode,
    GlmReasoningEffort, LocalConfig, LocalModel, MiniMaxConfig, MiniMaxModel,
};
use clap::ValueEnum;
use std::{collections::HashMap, io, path::Path};

#[derive(Clone, Copy, ValueEnum)]
pub(crate) enum Backend {
    Local,
    Glm,
    Minimax,
}
impl Backend {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Glm => "glm",
            Self::Minimax => "minimax",
        }
    }
}
pub(crate) enum BackendModel {
    Local(LocalModel),
    Glm(GlmModel),
    Minimax(MiniMaxModel),
}
impl AnalysisModel for BackendModel {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        match self {
            Self::Local(model) => model.generate(request).await,
            Self::Glm(model) => model.generate(request).await,
            Self::Minimax(model) => model.generate(request).await,
        }
    }
}
pub(crate) struct ConfiguredModel {
    pub model: BackendModel,
    pub backend: Backend,
    pub model_id: String,
    pub endpoint: String,
    pub reasoning_effort: &'static str,
    pub output_mode: &'static str,
}
pub(crate) fn load(
    path: Option<&Path>,
    backend: Option<Backend>,
    effort: Option<GlmReasoningEffort>,
    mode: Option<GlmOutputMode>,
) -> Result<ConfiguredModel, CliError> {
    let file = path.unwrap_or(Path::new(".env"));
    let values: HashMap<String, String> = match dotenvy::from_path_iter(file) {
        Ok(iter) => iter
            .collect::<Result<_, _>>()
            .map_err(|_| CliError::Config("invalid environment file"))?,
        Err(dotenvy::Error::Io(error))
            if path.is_none() && error.kind() == io::ErrorKind::NotFound =>
        {
            HashMap::new()
        }
        Err(_) => return Err(CliError::Config("cannot read environment file")),
    };
    let value = |name: &str, default: Option<&str>| -> Result<String, CliError> {
        match std::env::var(name) {
            Ok(v) => Ok(v),
            Err(std::env::VarError::NotUnicode(_)) => {
                Err(CliError::Config("model environment values must be UTF-8"))
            }
            Err(std::env::VarError::NotPresent) => values
                .get(name)
                .cloned()
                .or_else(|| default.map(str::to_owned))
                .ok_or(CliError::Config("required model configuration is missing")),
        }
    };
    let backend = match backend {
        Some(backend) => backend,
        None => match value("MODEL_BACKEND", Some("glm"))?.as_str() {
            "local" => Backend::Local,
            "glm" => Backend::Glm,
            "minimax" => Backend::Minimax,
            _ => return Err(CliError::Config("invalid model backend")),
        },
    };
    match backend {
        Backend::Minimax => {
            if effort.is_some() || mode.is_some() {
                return Err(CliError::Config(
                    "minimax backend uses final-text JSON with provider thinking; GLM options are unsupported",
                ));
            }
            let config = MiniMaxConfig::new(
                value("MINIMAX_MODEL", Some(DEFAULT_MINIMAX_MODEL))?,
                &value("MINIMAX_API_BASE_URL", Some(DEFAULT_MINIMAX_ENDPOINT))?,
                value("MINIMAX_API_KEY", None)?,
            )?;
            Ok(ConfiguredModel {
                backend,
                model_id: config.model().to_owned(),
                endpoint: config.endpoint().to_owned(),
                reasoning_effort: "provider_default",
                output_mode: "text",
                model: BackendModel::Minimax(MiniMaxModel::new(config)?),
            })
        }
        Backend::Local => {
            if effort.is_some() || mode.is_some_and(|m| m != GlmOutputMode::Schema) {
                return Err(CliError::Config(
                    "local backend requires Schema output and disabled thinking; GLM options are unsupported",
                ));
            }
            let config = LocalConfig::new(
                value("LOCAL_MODEL", Some(DEFAULT_LOCAL_MODEL))?,
                &value("LOCAL_API_BASE_URL", Some(DEFAULT_LOCAL_ENDPOINT))?,
            )?;
            Ok(ConfiguredModel {
                backend,
                model_id: config.model().to_owned(),
                endpoint: config.endpoint().to_owned(),
                reasoning_effort: "off",
                output_mode: "schema",
                model: BackendModel::Local(LocalModel::new(config)?),
            })
        }
        Backend::Glm => {
            let effort = match effort {
                Some(e) => e,
                None => value("REASONING_EFFORT", Some("low"))?.parse()?,
            };
            let mode = match mode {
                Some(m) => m,
                None => value("OUTPUT_MODE", Some("json"))?.parse()?,
            };
            let config = GlmConfig::new(
                value("MODEL", Some(DEFAULT_GLM_MODEL))?,
                value("API_BASE_URL", Some(DEFAULT_GLM_ENDPOINT))?,
                value("BIGMODEL_API_KEY", None)?,
            )?
            .with_reasoning_effort(effort)
            .with_output_mode(mode);
            Ok(ConfiguredModel {
                backend,
                model_id: config.model().to_owned(),
                endpoint: config.endpoint().to_owned(),
                reasoning_effort: effort.as_str(),
                output_mode: mode.as_str(),
                model: BackendModel::Glm(GlmModel::new(config)?),
            })
        }
    }
}
