//! Errors from JSON decoding and offline source/annotation validation.

/// A decoding or validation failure; validation locations are data paths.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Invalid JSON or an IO error encountered by a JSON stream.
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// A source or annotation invariant failed.
    #[error("{path}: {reason}")]
    Invalid {
        /// The field or document that failed validation.
        path: String,
        /// A diagnostic explaining the failed invariant.
        reason: String,
    },
}

impl Error {
    pub(crate) fn invalid(path: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Invalid {
            path: path.into(),
            reason: reason.into(),
        }
    }
}
