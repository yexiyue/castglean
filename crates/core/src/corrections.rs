//! Human operations on immutable, source-bound book snapshots.
use crate::{
    Attribution, BookAction, BookError, BookId, BookState, ChapterId, CharacterId, EvidenceRef,
    ExpressionKind, ReviewStatus, Segment, SegmentId,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
pub(crate) const CONFIRMED: &str = "castglean.human_confirmed";
/// Human input batch; every entry must pass before a new state is returned.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CorrectionBatch {
    /// Owning book; prevents application to a different book.
    pub book_id: BookId,
    /// Exact current commit revision.
    #[schemars(range(min = 1))]
    pub expected_revision: u64,
    /// Ordered human operations, applied as one candidate.
    pub corrections: Vec<Correction>,
}
/// Explicit human edits, separate from model suggestions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Correction {
    /// Replace expression type and attribution for a source-bound segment.
    Attribution {
        /// Chapter owning the segment.
        chapter_id: ChapterId,
        /// Exact normalized source hash.
        #[schemars(pattern(r"^[0-9a-f]{64}$"))]
        source_sha256: String,
        /// Formal segment identity.
        segment_id: SegmentId,
        /// Correct expression type.
        expression_kind: ExpressionKind,
        /// Correct attribution; the program sets its confirmation status.
        attribution: Option<Attribution>,
    },
    /// Replace aliases, retaining stable identity and display name.
    Aliases {
        /// Stable identity to edit.
        character_id: CharacterId,
        /// Exact source-grounded labels; empty removes aliases.
        aliases: Vec<String>,
        /// Supplied source anchors, appended without duplication.
        evidence: Vec<EvidenceRef>,
    },
}
pub(crate) fn confirmed(segment: &Segment) -> bool {
    segment.extensions.get(CONFIRMED).and_then(|v| v.as_bool()) == Some(true)
        || matches!(
            segment.attribution,
            Some(
                Attribution::Resolved {
                    review_status: ReviewStatus::Confirmed,
                    ..
                } | Attribution::Ambiguous {
                    review_status: ReviewStatus::Confirmed,
                    ..
                } | Attribution::Unknown {
                    review_status: ReviewStatus::Confirmed,
                    ..
                }
            )
        )
}
impl BookState {
    /// Apply a fully validated human batch; errors leave this state unchanged.
    pub fn correct(&self, batch: CorrectionBatch) -> Result<Self, BookError> {
        let revision = self.next_revision(batch.expected_revision)?;
        if batch.book_id != self.book().registry().book_id {
            return Err(BookError::Operation("correction book mismatch"));
        }
        if batch.corrections.is_empty() {
            return Err(BookError::Operation("empty correction batch"));
        }
        let mut document = self.document();
        for correction in &batch.corrections {
            match correction {
                Correction::Attribution {
                    chapter_id,
                    source_sha256,
                    segment_id,
                    expression_kind,
                    attribution,
                } => {
                    let chapter = document
                        .chapters
                        .iter_mut()
                        .find(|c| &c.annotations.chapter_id == chapter_id)
                        .ok_or(BookError::Operation("unknown correction chapter"))?;
                    if &chapter.annotations.source.sha256 != source_sha256 {
                        return Err(BookError::Operation("correction source mismatch"));
                    }
                    let segment = chapter
                        .annotations
                        .segments
                        .iter_mut()
                        .find(|s| &s.id == segment_id)
                        .ok_or(BookError::Operation("unknown correction segment"))?;
                    segment.kind = *expression_kind;
                    segment.attribution = attribution.clone().map(|mut a| {
                        match &mut a {
                            Attribution::Resolved { review_status, .. }
                            | Attribution::Ambiguous { review_status, .. }
                            | Attribution::Unknown { review_status, .. } => {
                                *review_status = ReviewStatus::Confirmed
                            }
                        }
                        a
                    });
                    segment.extensions.remove("castglean.quotation_evidence");
                    segment.extensions.insert(CONFIRMED.into(), true.into());
                }
                Correction::Aliases {
                    character_id,
                    aliases,
                    evidence,
                } => {
                    let texts = evidence
                        .iter()
                        .map(|e| {
                            let chapter = document
                                .chapters
                                .iter()
                                .find(|c| c.annotations.chapter_id == e.chapter_id)
                                .ok_or(BookError::Operation("unknown alias evidence chapter"))?;
                            let segment = chapter
                                .annotations
                                .segments
                                .iter()
                                .find(|s| s.id == e.segment_id)
                                .ok_or(BookError::Operation("unknown alias evidence segment"))?;
                            Ok(&chapter.text[segment.start..segment.end])
                        })
                        .collect::<Result<Vec<_>, BookError>>()?;
                    if aliases.iter().any(|a| {
                        a.trim().is_empty() || !texts.iter().any(|text| text.contains(a.as_str()))
                    }) {
                        return Err(BookError::Operation(
                            "alias has no supplied source evidence",
                        ));
                    }
                    let character = document
                        .registry
                        .characters
                        .iter_mut()
                        .find(|c| &c.id == character_id)
                        .ok_or(BookError::Operation("unknown correction character"))?;
                    character.aliases = aliases.clone();
                    character.review_status = ReviewStatus::Confirmed;
                    for e in evidence {
                        if !character.evidence.contains(e) {
                            character.evidence.push(e.clone());
                        }
                    }
                }
            }
        }
        self.finish(
            document,
            revision,
            BookAction::Corrected {
                corrections: batch.corrections,
            },
        )
    }
}
