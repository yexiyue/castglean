//! CastGlean's offline source and annotation validation library.
//!
//! Draft DTOs are editable inputs. [`validate_book`] checks complete source
//! coverage, identity/revisions and supplied evidence before returning owned
//! read-only results. [`analyze_chapter`] accepts bounded model suggestions to
//! produce new validated candidates. [`BookState`] constructs immutable whole-book commit candidates and protects
//! source-bound human corrections. [`BookRun`] persists and recovers ordered
//! chapter commits in an explicit caller-owned directory.

mod agent;
mod analysis;
mod book;
mod corrections;
mod document;
mod domain;
mod error;
mod memory;
mod run;
mod storage;
mod validation;

pub use analysis::{
    ANALYSIS_PROMPT_VERSION, AcceptedPrefixBatch, AnalysisConsumer, AnalysisError, AnalysisFailure,
    AnalysisFailureDiagnostics, AnalysisInput, AnalysisModel, AnalysisOptions, AnalysisResult,
    AnalysisRunId, AnalysisStage, AnalysisStats, AnalysisSuggestion, BookAnalysisFailure,
    CancellationToken, CharacterReference, CharacterSuggestion, DeliveryError, DeliveryProgress,
    DiagnosticTarget, EvidenceMode, IncrementalFailure, IncrementalResult, ModelError,
    ModelRequest, ModelResponse, QuotationSuggestion, RunFailure, SEGMENTATION_VERSION,
    SegmentSuggestion, SuggestedAttribution, SuggestionIssue, SuggestionIssueCode, TokenUsage,
    WindowFailureDiagnostics, WorkflowFailure, accepted_prefix_schema, analysis_suggestion_schema,
    analysis_suggestion_schema_for, analyze_chapter, analyze_chapter_detailed,
    analyze_chapter_incremental, partition_source,
};
pub use book::{
    BookAction, BookAnalysisInput, BookAnalysisMode, BookAnalysisResult, BookChange, BookDocument,
    BookError, BookState, SavedChapter,
};
pub use corrections::{Correction, CorrectionBatch};
pub use document::{ByteRange, NORMALIZATION_VERSION, OffsetUnit, SourceMetadata, SourceSnapshot};
pub use domain::{
    Attribution, BookId, ChapterAnnotations, ChapterId, Character, CharacterId, CharacterRegistry,
    EvidenceRef, ExpressionKind, Extensions, FORMAT_VERSION, ReviewStatus, Segment, SegmentId,
    VoiceProfile,
};
pub use error::Error;
pub use run::{BookRun, RunChapter, RunConfig, RunError, RunModel, RunPlan, RunProgress};
pub use storage::{
    analysis_failure_schema, annotations_schema, book_schema, characters_schema,
    corrections_schema, read_json, run_plan_schema, write_json,
};
pub use validation::{ChapterInput, ValidatedBook, ValidatedChapter, validate_book};
