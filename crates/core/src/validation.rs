//! Closed-set source and reference validation, with owned read-only results.

use crate::{
    Attribution, ByteRange, ChapterAnnotations, ChapterId, CharacterId, CharacterRegistry, Error,
    EvidenceRef, ExpressionKind, FORMAT_VERSION, Segment, SegmentId, SourceSnapshot,
};
use std::collections::{HashMap, HashSet};

/// A caller-provided pair of untrusted annotations and immutable source.
#[derive(Clone, Debug)]
pub struct ChapterInput {
    /// Draft annotations to validate.
    pub annotations: ChapterAnnotations,
    /// Source to which the annotations must be bound.
    pub source: SourceSnapshot,
}

/// An owned registry and chapters whose source/references have been validated.
///
/// This establishes structural consistency, not semantic attribution accuracy.
#[derive(Debug)]
pub struct ValidatedBook {
    registry: CharacterRegistry,
    chapters: Vec<ValidatedChapter>,
}

impl ValidatedBook {
    /// Read-only validated registry. Modified clones must be revalidated.
    pub fn registry(&self) -> &CharacterRegistry {
        &self.registry
    }
    /// Chapters in caller-provided order; chapter IDs are not sequence numbers.
    pub fn chapters(&self) -> &[ValidatedChapter] {
        &self.chapters
    }
}

/// An owned chapter with complete, valid source partition and references.
#[derive(Debug)]
pub struct ValidatedChapter {
    annotations: ChapterAnnotations,
    source: SourceSnapshot,
}

impl ValidatedChapter {
    /// Read-only annotation data.
    pub fn annotations(&self) -> &ChapterAnnotations {
        &self.annotations
    }
    /// Source snapshot bound to these annotations.
    pub fn source(&self) -> &SourceSnapshot {
        &self.source
    }
    /// Read source slices in annotation order without recalculating coordinates.
    pub fn segments(&self) -> impl ExactSizeIterator<Item = (&Segment, &str)> {
        self.annotations
            .segments
            .iter()
            .map(|segment| (segment, &self.source.text()[segment.start..segment.end]))
    }
}

/// Validate a registry and all supplied chapters as a closed evidence set.
///
/// Every referenced evidence chapter must be supplied. This function performs
/// no IO, does not merge identities and never mutates a caller's saved files.
pub fn validate_book(
    registry: CharacterRegistry,
    chapters: Vec<ChapterInput>,
) -> Result<ValidatedBook, Error> {
    check_version("characters.format_version", registry.format_version)?;
    if registry.revision == 0 {
        return Err(Error::invalid("characters.revision", "must be positive"));
    }
    let mut character_ids = HashSet::new();
    for character in &registry.characters {
        let path = format!("characters[{}]", character.id);
        if !character_ids.insert(&character.id) {
            return Err(Error::invalid(&path, "duplicate character ID"));
        }
        if character.display_name.trim().is_empty()
            || character
                .aliases
                .iter()
                .any(|alias| alias.trim().is_empty())
        {
            return Err(Error::invalid(&path, "names and aliases must not be blank"));
        }
    }

    let mut evidence_index: HashMap<&ChapterId, HashSet<&SegmentId>> = HashMap::new();
    for chapter in &chapters {
        let annotation = &chapter.annotations;
        let path = format!("chapters[{}]", annotation.chapter_id);
        check_version(&format!("{path}.format_version"), annotation.format_version)?;
        if annotation.book_id != registry.book_id {
            return Err(Error::invalid(&path, "book ID mismatch"));
        }
        if annotation.character_revision != registry.revision {
            return Err(Error::invalid(&path, "character revision mismatch"));
        }
        if &annotation.source != chapter.source.metadata() {
            return Err(Error::invalid(&path, "source metadata mismatch"));
        }
        if evidence_index.contains_key(&annotation.chapter_id) {
            return Err(Error::invalid(&path, "duplicate chapter ID"));
        }
        let mut segment_ids = HashSet::new();
        let mut cursor = 0;
        for segment in &annotation.segments {
            let segment_path = format!("{path}.segments[{}]", segment.id);
            if !segment_ids.insert(&segment.id) {
                return Err(Error::invalid(&segment_path, "duplicate segment ID"));
            }
            ByteRange::new(&chapter.source, segment.start, segment.end)
                .map_err(|error| Error::invalid(&segment_path, error.to_string()))?;
            if segment.start != cursor {
                return Err(Error::invalid(
                    &segment_path,
                    "source coverage gap, overlap or unordered range",
                ));
            }
            cursor = segment.end;
        }
        if cursor != chapter.source.text().len() {
            return Err(Error::invalid(&path, "incomplete source coverage"));
        }
        for segment in &annotation.segments {
            check_attribution(segment, &path, &character_ids, &segment_ids)?;
        }
        evidence_index.insert(&annotation.chapter_id, segment_ids);
    }

    for character in &registry.characters {
        let path = format!("characters[{}].evidence", character.id);
        check_evidence(&path, &character.evidence, &evidence_index)?;
        crate::analysis::check_saved_quotations(
            &character.extensions,
            &character.evidence,
            &chapters,
        )?;
        if let Some(profile) = &character.voice_profile {
            let path = format!("characters[{}].voice_profile", character.id);
            for value in profile
                .gender
                .iter()
                .chain(profile.age_band.iter())
                .chain(profile.impressions.iter())
            {
                if value.trim().is_empty() {
                    return Err(Error::invalid(
                        &path,
                        "profile descriptions must not be blank",
                    ));
                }
            }
            let has_claim = profile
                .gender
                .iter()
                .chain(profile.age_band.iter())
                .any(|value| value != "unknown")
                || !profile.impressions.is_empty();
            if has_claim && profile.evidence.is_empty() {
                return Err(Error::invalid(&path, "profile claims require evidence"));
            }
            check_evidence(&path, &profile.evidence, &evidence_index)?;
        }
    }
    for chapter in &chapters {
        for segment in &chapter.annotations.segments {
            let allowed: Vec<_> = segment
                .attribution
                .as_ref()
                .map(|a| a.evidence())
                .unwrap_or(&[])
                .iter()
                .map(|id| EvidenceRef {
                    chapter_id: chapter.annotations.chapter_id.clone(),
                    segment_id: id.clone(),
                })
                .collect();
            crate::analysis::check_saved_quotations(&segment.extensions, &allowed, &chapters)?;
        }
    }
    // Borrowed indices have no role after validation; return only owned inputs.
    Ok(ValidatedBook {
        registry,
        chapters: chapters
            .into_iter()
            .map(|chapter| ValidatedChapter {
                annotations: chapter.annotations,
                source: chapter.source,
            })
            .collect(),
    })
}

fn check_attribution(
    segment: &Segment,
    chapter_path: &str,
    character_ids: &HashSet<&CharacterId>,
    segment_ids: &HashSet<&SegmentId>,
) -> Result<(), Error> {
    let segment_path = format!("{chapter_path}.segments[{}].attribution", segment.id);
    let Some(attribution) = &segment.attribution else {
        if matches!(
            segment.kind,
            ExpressionKind::Speech | ExpressionKind::Thought
        ) {
            return Err(Error::invalid(
                &segment_path,
                "speech and thought require attribution",
            ));
        }
        return Ok(());
    };
    match attribution {
        Attribution::Resolved { character_id, .. } => {
            if !character_ids.contains(character_id) {
                return Err(Error::invalid(&segment_path, "unknown character reference"));
            }
        }
        Attribution::Ambiguous { candidate_ids, .. } => {
            let candidates: HashSet<_> = candidate_ids.iter().collect();
            if candidates.len() < 2 || candidates.len() != candidate_ids.len() {
                return Err(Error::invalid(
                    &segment_path,
                    "ambiguous attribution requires at least two distinct candidates",
                ));
            }
            if candidate_ids.iter().any(|id| !character_ids.contains(id)) {
                return Err(Error::invalid(&segment_path, "unknown candidate reference"));
            }
        }
        Attribution::Unknown { .. } => {}
    }
    for id in attribution.evidence() {
        if !segment_ids.contains(id) {
            return Err(Error::invalid(
                &segment_path,
                format!("missing evidence segment {id}"),
            ));
        }
    }
    Ok(())
}

fn check_version(path: &str, version: u32) -> Result<(), Error> {
    if version != FORMAT_VERSION {
        return Err(Error::invalid(path, "unsupported format version"));
    }
    Ok(())
}

fn check_evidence(
    path: &str,
    evidence: &[EvidenceRef],
    index: &HashMap<&ChapterId, HashSet<&SegmentId>>,
) -> Result<(), Error> {
    for reference in evidence {
        if !index
            .get(&reference.chapter_id)
            .is_some_and(|ids| ids.contains(&reference.segment_id))
        {
            return Err(Error::invalid(
                path,
                format!(
                    "missing evidence {}/{}; supply every referenced chapter",
                    reference.chapter_id, reference.segment_id
                ),
            ));
        }
    }
    Ok(())
}
