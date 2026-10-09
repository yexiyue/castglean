//! Ordered, immutable book state. Operations construct fully validated candidates.
use crate::{
    AnalysisError, AnalysisInput, AnalysisModel, AnalysisOptions, AnalysisStats, Attribution,
    BookId, CancellationToken, ChapterAnnotations, ChapterId, ChapterInput, Character, CharacterId,
    CharacterRegistry, Correction, Error, FORMAT_VERSION, SourceSnapshot, ValidatedBook,
    validate_book,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Saved normalized text and its existing annotation document.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SavedChapter {
    /// Exact normalized UTF-8 source, never a path.
    pub text: String,
    /// Annotations bound to this text.
    pub annotations: ChapterAnnotations,
}
/// Editable aggregate DTO; use `BookState::from_document` before operations.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BookDocument {
    /// Aggregate draft version, independently validated.
    #[schemars(range(min = 1, max = 1))]
    pub format_version: u32,
    /// Its revision is the common book commit revision.
    pub registry: CharacterRegistry,
    /// Explicit chronology, independent of chapter ID spelling.
    pub chapters: Vec<SavedChapter>,
    /// Operation history since this snapshot lineage was imported.
    #[serde(default)]
    pub changes: Vec<BookChange>,
}
/// A committed operation, without provider data or mutable file paths.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BookChange {
    /// Common revision after the operation.
    #[schemars(range(min = 1))]
    pub revision: u64,
    /// Committed action.
    pub action: BookAction,
}
/// Observable book mutation history; identity merges are not implemented.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum BookAction {
    /// A chapter was appended.
    Appended {
        /// Opaque chapter ID.
        chapter_id: ChapterId,
    },
    /// The last chapter was reanalyzed with human data protected.
    Reanalyzed {
        /// Opaque chapter ID.
        chapter_id: ChapterId,
    },
    /// Validated human operations, in batch order.
    Corrected {
        /// Exact committed corrections.
        corrections: Vec<Correction>,
    },
}
/// Structural and optimistic revision failures; no rejected model payloads.
#[derive(Debug, thiserror::Error)]
pub enum BookError {
    /// Caller is operating on a stale snapshot.
    #[error("book revision conflict: expected {expected}, actual {actual}")]
    Revision {
        /// Supplied revision.
        expected: u64,
        /// Snapshot revision.
        actual: u64,
    },
    /// Revision cannot advance.
    #[error("book revision overflow")]
    RevisionOverflow,
    /// Operation boundary was violated.
    #[error("book operation: {0}")]
    Operation(&'static str),
    /// Source, references, or DTO validation failed.
    #[error("book validation: {0}")]
    Validation(#[from] Error),
    /// The bounded model workflow failed.
    #[error("book analysis: {0}")]
    Analysis(#[from] AnalysisError),
}
/// Requested analysis operation; earlier chapters cannot be reanalyzed yet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BookAnalysisMode {
    /// Append a chapter after the current prefix.
    Append,
    /// Replace only the final chapter, with identical text and partition.
    ReanalyzeLast,
}
/// Explicit source and revision binding for a book analysis candidate.
pub struct BookAnalysisInput {
    /// Opaque chapter identity.
    pub chapter_id: ChapterId,
    /// Immutable imported source.
    pub source: SourceSnapshot,
    /// Current snapshot revision expected by the caller.
    pub expected_revision: u64,
    /// Append or last-chapter replacement.
    pub mode: BookAnalysisMode,
}
/// Immutable validated snapshot; there are no mutable accessors or implicit IO.
///
/// Corrections and analysis return a new snapshot with a new common revision.
/// Hosts consuming annotations must compare the current source identity and
/// revision before constructing or replacing a playback execution. An older
/// snapshot stays immutable and does not automatically detect later revisions.
#[derive(Debug)]
pub struct BookState {
    book: ValidatedBook,
    changes: Vec<BookChange>,
}
/// A complete new state and the usage of its analysis operation.
pub struct BookAnalysisResult {
    /// New state; the original state remains untouched.
    pub state: BookState,
    /// All obtained responses, including rejected candidates.
    pub stats: AnalysisStats,
}
impl BookState {
    /// Construct an empty book at revision 1.
    pub fn new(book_id: BookId) -> Result<Self, BookError> {
        Self::from_validated(validate_book(
            CharacterRegistry {
                format_version: FORMAT_VERSION,
                book_id,
                revision: 1,
                characters: vec![],
                extensions: Default::default(),
            },
            vec![],
        )?)
    }
    /// Import legacy validated documents without inventing operation history.
    pub fn from_validated(book: ValidatedBook) -> Result<Self, BookError> {
        check_order(&book)?;
        Ok(Self {
            book,
            changes: vec![],
        })
    }
    /// Validate saved source hashes, complete references, order and history.
    pub fn from_document(document: BookDocument) -> Result<Self, BookError> {
        if document.format_version != FORMAT_VERSION {
            return Err(BookError::Operation("unsupported aggregate version"));
        }
        let mut previous: Option<u64> = None;
        for change in &document.changes {
            if change.revision == 0
                || change.revision > document.registry.revision
                || previous.is_some_and(|revision| Some(change.revision) != revision.checked_add(1))
            {
                return Err(BookError::Operation("invalid change revisions"));
            }
            previous = Some(change.revision);
        }
        if previous.is_some_and(|revision| revision != document.registry.revision) {
            return Err(BookError::Operation(
                "history does not end at current revision",
            ));
        }
        let chapters = document
            .chapters
            .into_iter()
            .map(|c| {
                Ok(ChapterInput {
                    source: SourceSnapshot::from_saved(c.text, c.annotations.source.clone())?,
                    annotations: c.annotations,
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        let mut state = Self::from_validated(validate_book(document.registry, chapters)?)?;
        state.changes = document.changes;
        Ok(state)
    }
    /// Export editable clones; modifications require validation again.
    pub fn document(&self) -> BookDocument {
        BookDocument {
            format_version: FORMAT_VERSION,
            registry: self.book.registry().clone(),
            chapters: self
                .book
                .chapters()
                .iter()
                .map(|c| SavedChapter {
                    text: c.source().text().into(),
                    annotations: c.annotations().clone(),
                })
                .collect(),
            changes: self.changes.clone(),
        }
    }
    /// Full validated prefix, read-only.
    pub fn book(&self) -> &ValidatedBook {
        &self.book
    }
    /// Common commit revision.
    pub fn revision(&self) -> u64 {
        self.book.registry().revision
    }
    /// Earliest evidence chapter for a stable identity.
    pub fn known_at(&self, id: &CharacterId) -> Option<&ChapterId> {
        let character = self
            .book
            .registry()
            .characters
            .iter()
            .find(|c| &c.id == id)?;
        self.book
            .chapters()
            .iter()
            .find(|ch| {
                character
                    .evidence
                    .iter()
                    .any(|e| e.chapter_id == ch.annotations().chapter_id)
            })
            .map(|ch| &ch.annotations().chapter_id)
    }
    /// Exact label lookup through an explicit inclusive chapter boundary.
    /// All matches are returned; names never imply automatic identity merging.
    pub fn candidates(
        &self,
        label: &str,
        through: &ChapterId,
    ) -> Result<Vec<&Character>, BookError> {
        let boundary = self
            .book
            .chapters()
            .iter()
            .position(|c| &c.annotations().chapter_id == through)
            .ok_or(BookError::Operation("unknown chapter boundary"))?;
        let prefix = &self.book.chapters()[..=boundary];
        Ok(self
            .book
            .registry()
            .characters
            .iter()
            .filter(|character| {
                let known = prefix.iter().any(|chapter| {
                    character
                        .evidence
                        .iter()
                        .any(|e| e.chapter_id == chapter.annotations().chapter_id)
                });
                known && self.label_known(character, label, boundary)
            })
            .collect())
    }
    fn label_known(&self, character: &Character, label: &str, boundary: usize) -> bool {
        if character.display_name == label {
            return true;
        }
        if !character.aliases.iter().any(|a| a == label) {
            return false;
        }
        self.alias_evidence(character).iter().any(|e| {
            self.book.chapters()[..=boundary].iter().any(|chapter| {
                chapter.annotations().chapter_id == e.chapter_id
                    && chapter
                        .segments()
                        .any(|(segment, text)| segment.id == e.segment_id && text.contains(label))
            })
        })
    }
    fn alias_evidence<'a>(&'a self, character: &'a Character) -> &'a [crate::EvidenceRef] {
        for change in self.changes.iter().rev() {
            if let BookAction::Corrected { corrections } = &change.action {
                for correction in corrections.iter().rev() {
                    if let Correction::Aliases {
                        character_id,
                        evidence,
                        ..
                    } = correction
                        && character_id == &character.id
                    {
                        return evidence;
                    }
                }
            }
        }
        &character.evidence
    }
    pub(crate) fn next_revision(&self, expected: u64) -> Result<u64, BookError> {
        if expected != self.revision() {
            return Err(BookError::Revision {
                expected,
                actual: self.revision(),
            });
        }
        self.revision()
            .checked_add(1)
            .ok_or(BookError::RevisionOverflow)
    }
    pub(crate) fn finish(
        &self,
        mut document: BookDocument,
        revision: u64,
        action: BookAction,
    ) -> Result<Self, BookError> {
        document.registry.revision = revision;
        for ch in &mut document.chapters {
            ch.annotations.character_revision = revision;
        }
        document.changes.push(BookChange { revision, action });
        Self::from_document(document)
    }
    /// Analyze against this prefix, then validate a complete new commit candidate.
    pub async fn analyze<M: AnalysisModel>(
        &self,
        model: &M,
        request: BookAnalysisInput,
        options: &AnalysisOptions,
        cancel: &CancellationToken,
    ) -> Result<BookAnalysisResult, BookError> {
        self.analyze_detailed(model, request, options, cancel)
            .await
            .map_err(crate::BookAnalysisFailure::into_error)
    }
    /// Analyze a complete book candidate while retaining chapter failure diagnostics.
    pub async fn analyze_detailed<M: AnalysisModel>(
        &self,
        model: &M,
        request: BookAnalysisInput,
        options: &AnalysisOptions,
        cancel: &CancellationToken,
    ) -> Result<BookAnalysisResult, crate::BookAnalysisFailure> {
        let (revision, replacing, chapter_id, input) = self.prepare_analysis(request)?;
        let result = if replacing {
            crate::analysis::reanalyze_last_detailed(model, input, options, cancel)
                .await
                .map_err(|f| f.map(BookError::Analysis))?
        } else {
            crate::analyze_chapter_detailed(model, input, options, cancel)
                .await
                .map_err(|f| f.map(BookError::Analysis))?
        };
        self.finish_analysis(result, revision, replacing, chapter_id)
            .map_err(Into::into)
    }
    /// Deliver stable prefixes with human corrections protected, then return a new book.
    /// No state is changed or persisted on failure. Seal only after this call succeeds.
    pub async fn analyze_incremental<M: AnalysisModel, C: crate::AnalysisConsumer>(
        &self,
        model: &M,
        request: BookAnalysisInput,
        options: &AnalysisOptions,
        cancel: &CancellationToken,
        execution_key: &str,
        consumer: &mut C,
    ) -> Result<crate::IncrementalResult<BookAnalysisResult>, crate::IncrementalFailure<BookError>>
    {
        let (revision, replacing, chapter_id, input) =
            self.prepare_analysis(request)
                .map_err(|error| crate::IncrementalFailure {
                    failure: Box::new(error.into()),
                    delivery: Default::default(),
                    completed_stats: None,
                })?;
        let result = crate::analysis::execute_incremental(
            model,
            input,
            options,
            cancel,
            replacing,
            execution_key,
            consumer,
        )
        .await
        .map_err(|failure| failure.map(BookError::Analysis))?;
        let completed_stats = result.result.stats.clone();
        match self.finish_analysis(result.result, revision, replacing, chapter_id) {
            Ok(book) => Ok(crate::IncrementalResult {
                result: book,
                delivery: result.delivery,
            }),
            Err(error) => Err(crate::IncrementalFailure {
                failure: Box::new(error.into()),
                delivery: result.delivery,
                completed_stats: Some(Box::new(completed_stats)),
            }),
        }
    }
    fn prepare_analysis(
        &self,
        request: BookAnalysisInput,
    ) -> Result<(u64, bool, ChapterId, AnalysisInput<'_>), BookError> {
        let revision = self.next_revision(request.expected_revision)?;
        let replacing = request.mode == BookAnalysisMode::ReanalyzeLast;
        if replacing
            && self
                .book
                .chapters()
                .last()
                .is_none_or(|c| c.annotations().chapter_id != request.chapter_id)
        {
            return Err(BookError::Operation(
                "only the last chapter can be reanalyzed",
            ));
        }
        let chapter_id = request.chapter_id.clone();
        let input = AnalysisInput {
            book_id: self.book.registry().book_id.clone(),
            chapter_id: request.chapter_id,
            source: request.source,
            context: Some(&self.book),
        };
        Ok((revision, replacing, chapter_id, input))
    }
    fn finish_analysis(
        &self,
        result: crate::AnalysisResult,
        revision: u64,
        replacing: bool,
        chapter_id: ChapterId,
    ) -> Result<BookAnalysisResult, BookError> {
        let mut document = self.document();
        document.registry = result.book.registry().clone();
        document.chapters = result
            .book
            .chapters()
            .iter()
            .map(|c| SavedChapter {
                text: c.source().text().into(),
                annotations: c.annotations().clone(),
            })
            .collect();
        let action = if replacing {
            BookAction::Reanalyzed { chapter_id }
        } else {
            BookAction::Appended { chapter_id }
        };
        Ok(BookAnalysisResult {
            state: self.finish(document, revision, action)?,
            stats: result.stats,
        })
    }
}
fn check_order(book: &ValidatedBook) -> Result<(), BookError> {
    for (index, chapter) in book.chapters().iter().enumerate() {
        for segment in &chapter.annotations().segments {
            if let Some(value) = segment.extensions.get(crate::corrections::CONFIRMED)
                && value.as_bool() != Some(true)
            {
                return Err(BookError::Operation("invalid human confirmation marker"));
            }
            let ids: &[CharacterId] = match &segment.attribution {
                Some(Attribution::Resolved { character_id, .. }) => {
                    std::slice::from_ref(character_id)
                }
                Some(Attribution::Ambiguous { candidate_ids, .. }) => candidate_ids,
                _ => &[],
            };
            for id in ids {
                let character = book
                    .registry()
                    .characters
                    .iter()
                    .find(|c| &c.id == id)
                    .expect("validated identity");
                if !book.chapters()[..=index].iter().any(|ch| {
                    character
                        .evidence
                        .iter()
                        .any(|e| e.chapter_id == ch.annotations().chapter_id)
                }) {
                    return Err(BookError::Operation(
                        "attribution references a future identity",
                    ));
                }
            }
        }
    }
    if book
        .registry()
        .characters
        .iter()
        .any(|c| c.evidence.is_empty())
    {
        return Err(BookError::Operation(
            "characters require an evidence anchor",
        ));
    }
    Ok(())
}
