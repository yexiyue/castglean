//! Sequential bounded analysis, with no caller-state mutation or implicit IO.
mod diagnostics;
mod issue;
pub use diagnostics::{
    AnalysisFailure, AnalysisFailureDiagnostics, AnalysisStage, BookAnalysisFailure,
    DiagnosticTarget, RunFailure, WindowFailureDiagnostics, WorkflowFailure,
};
mod partition;
mod protocol;
mod quotation;
mod references;
mod suggestions;
mod window;
pub use issue::{SuggestionIssue, SuggestionIssueCode};
pub use partition::{SEGMENTATION_VERSION, partition_source};
pub use protocol::{
    AnalysisSuggestion, CharacterReference, CharacterSuggestion, QuotationSuggestion,
    SegmentSuggestion, SuggestedAttribution, analysis_suggestion_schema,
    analysis_suggestion_schema_for,
};
pub(crate) use quotation::check_saved_quotations;
pub use tokio_util::sync::CancellationToken;

use crate::{
    BookId, ChapterAnnotations, ChapterId, ChapterInput, CharacterRegistry, Error, FORMAT_VERSION,
    SourceSnapshot, ValidatedBook, validate_book,
};
use serde::{Deserialize, Serialize};
use std::{future::Future, time::Duration};

/// Version of task instruction and suggestion conventions for run provenance.
pub const ANALYSIS_PROMPT_VERSION: u32 = 9;

/// Evidence acceptance policy, independent of the model backend.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceMode {
    /// Visible segment references; compatible with earlier suggestions.
    #[default]
    SegmentIds,
    /// Also require uniquely locatable source quotations for supported claims.
    VerifiedQuotes,
}
impl EvidenceMode {
    /// Prompt version actually used by this mode.
    pub fn prompt_version(self) -> u32 {
        match self {
            Self::SegmentIds => ANALYSIS_PROMPT_VERSION,
            Self::VerifiedQuotes => 10,
        }
    }
}

/// Minimal provider-neutral text model, also implemented by offline doubles.
pub trait AnalysisModel: Sync {
    /// Generate once, respecting the supplied output-token limit.
    fn generate(
        &self,
        request: ModelRequest,
    ) -> impl Future<Output = Result<ModelResponse, ModelError>> + Send;
}
/// Text generation request; contains private source, so has no Debug derive.
pub struct ModelRequest {
    /// Select structural quotation fields independently of the provider.
    pub evidence_mode: EvidenceMode,
    /// Task instruction.
    pub system: String,
    /// Serialized visible text, identities and targets.
    pub user: String,
    /// Maximum provider generation tokens.
    pub max_output_tokens: u32,
}
/// Text response and optional provider usage.
pub struct ModelResponse {
    /// JSON suggestion text.
    pub text: String,
    /// Provider reports incomplete output.
    pub truncated: bool,
    /// Actual reported tokens.
    pub usage: TokenUsage,
}
/// Missing usage remains unknown rather than zero.
#[derive(Clone, Debug, Default, Serialize, Deserialize, schemars::JsonSchema)]
pub struct TokenUsage {
    /// Input tokens.
    pub input: Option<u64>,
    /// Provider-reported completion tokens, which may include reasoning.
    pub output: Option<u64>,
    /// Provider-reported reasoning tokens; absence is unknown, not zero.
    #[serde(default)]
    pub reasoning: Option<u64>,
}
/// Safe categories without raw SDK errors, credentials or response content.
#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum ModelError {
    /// Invalid explicit model configuration.
    #[error("invalid model configuration")]
    Configuration,
    /// Authentication rejected.
    #[error("model authentication failed")]
    Authentication,
    /// Capacity limit.
    #[error("model rate limit exceeded")]
    RateLimited,
    /// Network or service failure.
    #[error("model transport or service failed")]
    Transport,
    /// Empty or unsupported response.
    #[error("model response was unusable")]
    Response,
}
/// Analysis failures exclude raw suggestions and source text.
#[derive(Debug, thiserror::Error)]
pub enum AnalysisError {
    /// Invalid zero limits or segment limit exceeding window size.
    #[error("invalid analysis limits")]
    InvalidOptions,
    /// Request count or payload size limit.
    #[error("analysis budget exceeded: {0}")]
    Budget(&'static str),
    /// Caller cancellation.
    #[error("analysis cancelled")]
    Cancelled,
    /// Request deadline.
    #[error("model request timed out")]
    Timeout,
    /// End-to-end chapter deadline.
    #[error("chapter analysis timed out")]
    ChapterTimeout,
    /// All allowed candidate repairs failed validation.
    #[error("analysis repair exhausted: {0}")]
    RepairExhausted(SuggestionIssue),
    /// Safe provider category.
    #[error(transparent)]
    Model(#[from] ModelError),
    /// Invalid suggestion without embedding raw output.
    #[error("invalid model suggestion: {0}")]
    Suggestion(&'static str),
    /// Context cannot be extended safely.
    #[error("invalid analysis context: {0}")]
    Context(&'static str),
    /// Source or final structural validation.
    #[error("analysis validation failed: {0}")]
    Validation(#[from] Error),
}
/// Per-run limits; use the host Tokio runtime with its time driver enabled.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AnalysisOptions {
    /// Explicit evidence policy; quotations do not establish semantic truth.
    pub evidence_mode: EvidenceMode,
    /// Maximum Unicode scalar count per segment.
    pub segment_chars: usize,
    /// Maximum target scalar count per window.
    pub window_chars: usize,
    /// Maximum targets per window, bounding verbose JSON response growth.
    pub window_segments: usize,
    /// Adjacent segments on each side.
    pub context_segments: usize,
    /// Request count cap, checked before calling.
    pub max_requests: usize,
    /// Combined system/user byte limit.
    pub max_input_bytes: usize,
    /// Returned text byte limit before parsing.
    pub max_response_bytes: usize,
    /// Maximum generation tokens per request.
    pub max_output_tokens: u32,
    /// Complete provider-call deadline.
    pub request_timeout: Duration,
    /// Maximum corrective generations per window; zero disables repair.
    pub max_repairs_per_window: usize,
    /// End-to-end chapter limit, including requests and synchronous preparation.
    pub chapter_timeout: Duration,
}
impl Default for AnalysisOptions {
    fn default() -> Self {
        Self {
            evidence_mode: EvidenceMode::default(),
            segment_chars: 160,
            window_chars: 3000,
            window_segments: 24,
            context_segments: 3,
            max_requests: 32,
            max_input_bytes: 128_000,
            max_response_bytes: 256_000,
            max_output_tokens: 8192,
            request_timeout: Duration::from_secs(120),
            max_repairs_per_window: 1,
            chapter_timeout: Duration::from_secs(600),
        }
    }
}
impl AnalysisOptions {
    pub(crate) fn validate(&self) -> Result<(), AnalysisError> {
        if self.segment_chars == 0
            || self.window_chars < self.segment_chars
            || self.window_segments == 0
            || self.max_requests == 0
            || self.max_input_bytes == 0
            || self.max_response_bytes == 0
            || self.max_output_tokens == 0
            || self.request_timeout.is_zero()
            || self.chapter_timeout.is_zero()
        {
            return Err(AnalysisError::InvalidOptions);
        }
        Ok(())
    }
}
/// Explicit new chapter and optional complete validated evidence context.
pub struct AnalysisInput<'a> {
    /// Book identity.
    pub book_id: BookId,
    /// New chapter identity, absent from context.
    pub chapter_id: ChapterId,
    /// Immutable normalized source.
    pub source: SourceSnapshot,
    /// Existing identities and evidence; never mutated.
    pub context: Option<&'a ValidatedBook>,
}
/// Safe diagnostics with no prompt text or secrets.
#[derive(Clone, Debug, Default, Serialize, Deserialize, schemars::JsonSchema)]
pub struct AnalysisStats {
    /// Provider calls with a received response, including rejected candidates.
    pub requests: usize,
    /// Corrective calls with a received response.
    #[serde(default)]
    pub repair_requests: usize,
    /// Windows accepted after one or more corrective calls.
    #[serde(default)]
    pub repaired_windows: usize,
    /// Actual per-call token counts; missing values are null.
    pub usage: Vec<TokenUsage>,
    /// Per-call UTF-8 bytes of final suggestion text, excluding reasoning.
    #[serde(default)]
    pub response_bytes: Vec<usize>,
    /// End-to-end milliseconds.
    pub elapsed_ms: u64,
}
/// Validated complete candidate, without storage or commit side effects.
pub struct AnalysisResult {
    /// Prior chapters followed by the new chapter.
    pub book: ValidatedBook,
    /// Run diagnostics.
    pub stats: AnalysisStats,
}

/// Analyze one new chapter with bounded candidate repair; cancellation discards local work.
///
/// This does not promise remote request withdrawal or billing reversal.
pub async fn analyze_chapter<M: AnalysisModel>(
    model: &M,
    input: AnalysisInput<'_>,
    options: &AnalysisOptions,
    cancel: &CancellationToken,
) -> Result<AnalysisResult, AnalysisError> {
    analyze_chapter_detailed(model, input, options, cancel)
        .await
        .map_err(AnalysisFailure::into_error)
}

/// Analyze one chapter with safe failure statistics and window context.
pub async fn analyze_chapter_detailed<M: AnalysisModel>(
    model: &M,
    input: AnalysisInput<'_>,
    options: &AnalysisOptions,
    cancel: &CancellationToken,
) -> Result<AnalysisResult, AnalysisFailure> {
    execute_detailed(model, input, options, cancel, false).await
}
pub(crate) async fn reanalyze_last_detailed<M: AnalysisModel>(
    model: &M,
    input: AnalysisInput<'_>,
    options: &AnalysisOptions,
    cancel: &CancellationToken,
) -> Result<AnalysisResult, AnalysisFailure> {
    execute_detailed(model, input, options, cancel, true).await
}
async fn execute_detailed<M: AnalysisModel>(
    model: &M,
    input: AnalysisInput<'_>,
    options: &AnalysisOptions,
    cancel: &CancellationToken,
    replacing: bool,
) -> Result<AnalysisResult, AnalysisFailure> {
    let started = tokio::time::Instant::now();
    let mut diagnostics = AnalysisFailureDiagnostics::default();
    let result = execute_chapter(model, input, options, cancel, replacing, &mut diagnostics).await;
    diagnostics.stats.elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    match result {
        Ok(mut result) => {
            result.stats = diagnostics.stats;
            Ok(result)
        }
        Err(error) => {
            diagnostics.finish(&error);
            Err(AnalysisFailure::new(error, diagnostics))
        }
    }
}

async fn execute_chapter<M: AnalysisModel>(
    model: &M,
    mut input: AnalysisInput<'_>,
    options: &AnalysisOptions,
    cancel: &CancellationToken,
    replacing: bool,
    diagnostics: &mut AnalysisFailureDiagnostics,
) -> Result<AnalysisResult, AnalysisError> {
    let started = tokio::time::Instant::now();
    options.validate()?;
    let deadline = started
        .checked_add(options.chapter_timeout)
        .ok_or(AnalysisError::InvalidOptions)?;
    window::check_progress(cancel, deadline)?;
    if let Some(context) = input.context {
        if context.registry().book_id != input.book_id {
            return Err(AnalysisError::Context("book ID mismatch"));
        }
        if !replacing
            && context
                .chapters()
                .iter()
                .any(|ch| ch.annotations().chapter_id == input.chapter_id)
        {
            return Err(AnalysisError::Context(
                "chapter already exists; reanalysis requires correction workflow",
            ));
        }
    }
    let mut registry =
        input
            .context
            .map(|book| book.registry().clone())
            .unwrap_or(CharacterRegistry {
                format_version: FORMAT_VERSION,
                book_id: input.book_id.clone(),
                revision: 1,
                characters: vec![],
                extensions: Default::default(),
            });
    let previous = if replacing {
        let chapter = input
            .context
            .and_then(|book| book.chapters().last())
            .filter(|c| c.annotations().chapter_id == input.chapter_id)
            .ok_or(AnalysisError::Context(
                "only the last chapter can be reanalyzed",
            ))?;
        if chapter.source().text() != input.source.text() {
            return Err(AnalysisError::Context("reanalysis source mismatch"));
        }
        input.source = chapter.source().clone();
        Some(chapter)
    } else {
        None
    };
    let initial_count = registry.characters.len();
    let mut segments = partition_source(&input.source, options.segment_chars)?;
    if previous.is_some_and(|c| {
        c.annotations().segments.len() != segments.len()
            || c.annotations()
                .segments
                .iter()
                .zip(&segments)
                .any(|(old, new)| old.id != new.id || old.start != new.start || old.end != new.end)
    }) {
        return Err(AnalysisError::Context("reanalysis partition mismatch"));
    }
    let windows = partition::windows(
        &segments,
        &input.source,
        options.window_chars,
        options.window_segments,
    );
    if windows.len() > options.max_requests {
        return Err(AnalysisError::Budget("request count"));
    }
    let window_count = windows.len();
    for (window_index, target) in windows.into_iter().enumerate() {
        let visible = target.start.saturating_sub(options.context_segments)
            ..target
                .end
                .saturating_add(options.context_segments)
                .min(segments.len());
        diagnostics.stage = AnalysisStage::Window;
        diagnostics.window = Some(WindowFailureDiagnostics {
            index: window_index,
            start: segments[target.start].start,
            end: segments[target.end - 1].end,
            targets: segments[target.clone()]
                .iter()
                .enumerate()
                .map(|(i, s)| DiagnosticTarget {
                    segment_id: s.id.clone(),
                    reference: format!("s{}", target.start + i - visible.start),
                    start: s.start,
                    end: s.end,
                    whitespace_only: input.source.text()[s.start..s.end]
                        .chars()
                        .all(char::is_whitespace),
                })
                .collect(),
            issue: None,
            validation_issues: vec![],
            missing_targets: vec![],
            repairs_attempted: 0,
            repair_exhausted: false,
        });
        let validated = window::execute(
            model,
            window::WindowContext {
                input: &input,
                index: window_index,
                target,
                visible,
                registry: &registry,
                segments: &segments,
                remaining_windows: window_count - window_index - 1,
            },
            options,
            cancel,
            deadline,
            diagnostics,
        )
        .await?;
        validated.apply(&mut registry, &mut segments);
        diagnostics.accepted_windows += 1;
        if let Some(previous) = previous {
            for (old, current) in previous.annotations().segments.iter().zip(&mut segments) {
                if crate::corrections::confirmed(old) {
                    *current = old.clone();
                }
            }
        }
    }
    diagnostics.stage = AnalysisStage::FinalValidation;
    diagnostics.window = None;
    window::check_progress(cancel, deadline)?;
    if input.context.is_some() && registry.characters.len() != initial_count {
        registry.revision = registry
            .revision
            .checked_add(1)
            .ok_or(AnalysisError::Context("revision overflow"))?;
    }
    let mut chapters: Vec<_> = input
        .context
        .into_iter()
        .flat_map(|book| book.chapters())
        .filter(|ch| !replacing || ch.annotations().chapter_id != input.chapter_id)
        .map(|ch| {
            let mut annotations = ch.annotations().clone();
            annotations.character_revision = registry.revision;
            ChapterInput {
                annotations,
                source: ch.source().clone(),
            }
        })
        .collect();
    chapters.push(ChapterInput {
        annotations: ChapterAnnotations {
            format_version: FORMAT_VERSION,
            book_id: input.book_id,
            chapter_id: input.chapter_id,
            character_revision: registry.revision,
            source: input.source.metadata().clone(),
            segments,
            extensions: previous
                .map(|c| c.annotations().extensions.clone())
                .unwrap_or_default(),
        },
        source: input.source,
    });
    window::check_progress(cancel, deadline)?;
    let book = validate_book(registry, chapters)?;
    window::check_progress(cancel, deadline)?;
    Ok(AnalysisResult {
        book,
        stats: AnalysisStats::default(),
    })
}
