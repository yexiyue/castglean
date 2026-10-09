//! Read-only, application-generated failure diagnostics.
use super::{AnalysisError, AnalysisStats, SuggestionIssue};
use crate::SegmentId;
use serde::Serialize;
use std::fmt;

/// Execution stage, distinct from persistence or publication.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisStage {
    /// Input and context preparation.
    Preparation,
    /// Bounded model window and application validation.
    Window,
    /// Whole-chapter validation and final cancellation check.
    FinalValidation,
}
/// Trusted source target; never copied from rejected model values.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct DiagnosticTarget {
    pub(crate) segment_id: SegmentId,
    pub(crate) reference: String,
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) whitespace_only: bool,
}
impl DiagnosticTarget {
    /// Formal target identity.
    pub fn segment_id(&self) -> &SegmentId {
        &self.segment_id
    }
    /// Window-local transport handle.
    pub fn reference(&self) -> &str {
        &self.reference
    }
    /// Half-open UTF-8 source range.
    pub fn range(&self) -> std::ops::Range<usize> {
        self.start..self.end
    }
    /// Every scalar in this complete target is whitespace.
    pub fn whitespace_only(&self) -> bool {
        self.whitespace_only
    }
}
/// Current window; absence means preparation or final validation.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct WindowFailureDiagnostics {
    pub(crate) index: usize,
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) targets: Vec<DiagnosticTarget>,
    pub(crate) issue: Option<SuggestionIssue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) validation_issues: Vec<SuggestionIssue>,
    pub(crate) missing_targets: Vec<DiagnosticTarget>,
    pub(crate) repairs_attempted: usize,
    pub(crate) repair_exhausted: bool,
}
impl WindowFailureDiagnostics {
    /// Zero-based window index.
    pub fn index(&self) -> usize {
        self.index
    }
    /// Half-open UTF-8 target extent.
    pub fn range(&self) -> std::ops::Range<usize> {
        self.start..self.end
    }
    /// Source-generated target definitions.
    pub fn targets(&self) -> &[DiagnosticTarget] {
        &self.targets
    }
    /// Latest candidate validation issue, if any.
    pub fn issue(&self) -> Option<&SuggestionIssue> {
        self.issue.as_ref()
    }
    /// Rejected candidate issues in received-response order for this window.
    pub fn validation_issues(&self) -> &[SuggestionIssue] {
        &self.validation_issues
    }
    /// All missing targets from the latest fully decoded candidate.
    pub fn missing_targets(&self) -> &[DiagnosticTarget] {
        &self.missing_targets
    }
    /// Corrective calls actually started, including calls with no response.
    pub fn repairs_attempted(&self) -> usize {
        self.repairs_attempted
    }
    /// Allowed corrective candidates all failed validation.
    pub fn repair_exhausted(&self) -> bool {
        self.repair_exhausted
    }
}
/// Safe versioned report. Accepted windows are private candidates, never commits.
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct AnalysisFailureDiagnostics {
    pub(crate) format_version: u32,
    pub(crate) category: String,
    pub(crate) stage: AnalysisStage,
    pub(crate) window: Option<WindowFailureDiagnostics>,
    pub(crate) accepted_windows: usize,
    pub(crate) stats: AnalysisStats,
}
impl Default for AnalysisFailureDiagnostics {
    fn default() -> Self {
        Self {
            format_version: 1,
            category: String::new(),
            stage: AnalysisStage::Preparation,
            window: None,
            accepted_windows: 0,
            stats: AnalysisStats::default(),
        }
    }
}
impl AnalysisFailureDiagnostics {
    /// Safe failure category, independent of error display text.
    pub fn category(&self) -> &str {
        &self.category
    }
    /// Analysis stage at failure.
    pub fn stage(&self) -> AnalysisStage {
        self.stage
    }
    /// Current window, when executing a window.
    pub fn window(&self) -> Option<&WindowFailureDiagnostics> {
        self.window.as_ref()
    }
    /// Count of private accepted windows; not published or committed.
    pub fn accepted_windows(&self) -> usize {
        self.accepted_windows
    }
    /// All responses received during this attempt, including rejected responses.
    pub fn stats(&self) -> &AnalysisStats {
        &self.stats
    }
    pub(crate) fn finish(&mut self, error: &AnalysisError) {
        self.category = match error {
            AnalysisError::Delivery(super::DeliveryError::Closed) => "consumer_closed".into(),
            AnalysisError::Delivery(super::DeliveryError::Rejected) => "consumer_rejected".into(),
            AnalysisError::RepairExhausted(issue) => issue.code().as_str().to_owned(),
            AnalysisError::InvalidOptions => "invalid_options".into(),
            AnalysisError::Budget(_) => "analysis_budget".into(),
            AnalysisError::Cancelled => "cancelled".into(),
            AnalysisError::Timeout => "request_timeout".into(),
            AnalysisError::ChapterTimeout => "chapter_timeout".into(),
            AnalysisError::Model(e) => match e {
                super::ModelError::Configuration => "configuration",
                super::ModelError::Authentication => "authentication",
                super::ModelError::RateLimited => "rate_limit",
                super::ModelError::Transport => "service",
                super::ModelError::Response => "response",
            }
            .into(),
            AnalysisError::Suggestion("truncated response") => "truncated_response".into(),
            AnalysisError::Suggestion(_) => self
                .window
                .as_ref()
                .and_then(|w| w.issue.as_ref())
                .map(|i| i.code().as_str().to_owned())
                .unwrap_or_else(|| "invalid_suggestion".into()),
            AnalysisError::Context(_) => "context".into(),
            AnalysisError::Validation(_) => "validation".into(),
        };
    }
}
/// Original workflow error plus optional safe analysis diagnostics.
#[derive(Debug)]
pub struct WorkflowFailure<E> {
    error: E,
    diagnostics: Option<Box<AnalysisFailureDiagnostics>>,
}
impl<E> WorkflowFailure<E> {
    pub(crate) fn new(error: E, diagnostics: AnalysisFailureDiagnostics) -> Self {
        Self {
            error,
            diagnostics: Some(Box::new(diagnostics)),
        }
    }
    /// Original error, preserving matching and category semantics.
    pub fn error(&self) -> &E {
        &self.error
    }
    /// Analysis report; absent for workflow errors before or after analysis.
    pub fn diagnostics(&self) -> Option<&AnalysisFailureDiagnostics> {
        self.diagnostics.as_deref()
    }
    /// Recover the original error for the compatibility entrance.
    pub fn into_error(self) -> E {
        self.error
    }
    pub(crate) fn map<F>(self, f: impl FnOnce(E) -> F) -> WorkflowFailure<F> {
        WorkflowFailure {
            error: f(self.error),
            diagnostics: self.diagnostics,
        }
    }
}
impl<E> From<E> for WorkflowFailure<E> {
    fn from(error: E) -> Self {
        Self {
            error,
            diagnostics: None,
        }
    }
}
impl<E: fmt::Display> fmt::Display for WorkflowFailure<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(f)
    }
}
impl<E: std::error::Error + 'static> std::error::Error for WorkflowFailure<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}
/// Detailed chapter analysis failure; diagnostics are always present.
pub type AnalysisFailure = WorkflowFailure<AnalysisError>;
/// Book errors retain diagnostics when caused by chapter analysis.
pub type BookAnalysisFailure = WorkflowFailure<crate::BookError>;
/// Run errors retain diagnostics when caused by chapter analysis.
pub type RunFailure = WorkflowFailure<crate::RunError>;

impl From<std::io::Error> for RunFailure {
    fn from(error: std::io::Error) -> Self {
        crate::RunError::Io(error).into()
    }
}
impl From<crate::BookError> for RunFailure {
    fn from(error: crate::BookError) -> Self {
        crate::RunError::Book(error).into()
    }
}
