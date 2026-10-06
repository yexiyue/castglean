//! CastGlean's offline source and annotation validation library.
//!
//! Draft DTOs are editable inputs. [`validate_book`] checks complete source
//! coverage, identity/revisions and supplied evidence before returning owned
//! read-only results. [`analyze_chapter`] accepts bounded model suggestions to
//! produce new validated candidates. State commits and recovery remain planned.

mod agent;
mod analysis;
mod document;
mod domain;
mod error;
mod memory;
mod storage;
mod validation;

pub use analysis::{
    ANALYSIS_PROMPT_VERSION, AnalysisError, AnalysisInput, AnalysisModel, AnalysisOptions,
    AnalysisResult, AnalysisStats, AnalysisSuggestion, CancellationToken, CharacterReference,
    CharacterSuggestion, ModelError, ModelRequest, ModelResponse, SEGMENTATION_VERSION,
    SegmentSuggestion, SuggestedAttribution, SuggestionIssue, SuggestionIssueCode, TokenUsage,
    analysis_suggestion_schema, analyze_chapter, partition_source,
};
pub use document::{ByteRange, NORMALIZATION_VERSION, OffsetUnit, SourceMetadata, SourceSnapshot};
pub use domain::{
    Attribution, BookId, ChapterAnnotations, ChapterId, Character, CharacterId, CharacterRegistry,
    EvidenceRef, ExpressionKind, Extensions, FORMAT_VERSION, ReviewStatus, Segment, SegmentId,
    VoiceProfile,
};
pub use error::Error;
pub use storage::{annotations_schema, characters_schema, read_json, write_json};
pub use validation::{ChapterInput, ValidatedBook, ValidatedChapter, validate_book};
