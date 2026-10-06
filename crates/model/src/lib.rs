//! Explicit model service adapters with no environment access.
mod chat_completion;
mod glm;
mod local;
mod minimax;
pub use glm::{
    DEFAULT_GLM_ENDPOINT, DEFAULT_GLM_MODEL, GlmConfig, GlmModel, GlmOutputMode, GlmReasoningEffort,
};
pub use local::{DEFAULT_LOCAL_ENDPOINT, DEFAULT_LOCAL_MODEL, LocalConfig, LocalModel};
pub use minimax::{DEFAULT_MINIMAX_ENDPOINT, DEFAULT_MINIMAX_MODEL, MiniMaxConfig, MiniMaxModel};
