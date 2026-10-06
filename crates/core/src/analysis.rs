//! Sequential bounded analysis, with no caller-state mutation or implicit IO.
mod issue;
mod partition;
mod protocol;
mod suggestions;
mod window;
pub use issue::{SuggestionIssue, SuggestionIssueCode};
pub use partition::{SEGMENTATION_VERSION, partition_source};
pub use protocol::{
    AnalysisSuggestion, CharacterReference, CharacterSuggestion, SegmentSuggestion,
    SuggestedAttribution, analysis_suggestion_schema,
};
pub use tokio_util::sync::CancellationToken;

use crate::{
    BookId, ChapterAnnotations, ChapterId, ChapterInput, CharacterRegistry, Error, FORMAT_VERSION,
    SourceSnapshot, ValidatedBook, validate_book,
};
use serde::{Deserialize, Serialize};
use std::{future::Future, time::Duration};

/// Version of task instruction and suggestion conventions for run provenance.
pub const ANALYSIS_PROMPT_VERSION: u32 = 2;

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
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
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
#[derive(Clone, Debug, Serialize)]
pub struct AnalysisOptions {
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
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
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
    let started = tokio::time::Instant::now();
    if options.segment_chars == 0
        || options.window_chars < options.segment_chars
        || options.window_segments == 0
        || options.max_requests == 0
        || options.max_input_bytes == 0
        || options.max_response_bytes == 0
        || options.max_output_tokens == 0
        || options.request_timeout.is_zero()
        || options.chapter_timeout.is_zero()
    {
        return Err(AnalysisError::InvalidOptions);
    }
    let deadline = started
        .checked_add(options.chapter_timeout)
        .ok_or(AnalysisError::InvalidOptions)?;
    window::check_progress(cancel, deadline)?;
    if let Some(context) = input.context {
        if context.registry().book_id != input.book_id {
            return Err(AnalysisError::Context("book ID mismatch"));
        }
        if context
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
    let initial_count = registry.characters.len();
    let mut segments = partition_source(&input.source, options.segment_chars)?;
    let windows = partition::windows(
        &segments,
        &input.source,
        options.window_chars,
        options.window_segments,
    );
    if windows.len() > options.max_requests {
        return Err(AnalysisError::Budget("request count"));
    }
    let mut stats = AnalysisStats::default();
    let window_count = windows.len();
    for (window_index, target) in windows.into_iter().enumerate() {
        window::check_progress(cancel, deadline)?;
        let visible = target.start.saturating_sub(options.context_segments)
            ..target
                .end
                .saturating_add(options.context_segments)
                .min(segments.len());
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
            &mut stats,
        )
        .await?;
        validated.apply(&mut registry, &mut segments);
    }
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
            extensions: Default::default(),
        },
        source: input.source,
    });
    window::check_progress(cancel, deadline)?;
    let book = validate_book(registry, chapters)?;
    window::check_progress(cancel, deadline)?;
    stats.elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    Ok(AnalysisResult { book, stats })
}
