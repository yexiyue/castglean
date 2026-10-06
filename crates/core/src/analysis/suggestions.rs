use super::{
    AnalysisInput, AnalysisSuggestion, CharacterReference, SuggestedAttribution, SuggestionIssue,
    SuggestionIssueCode,
};
use crate::{
    Attribution, Character, CharacterId, CharacterRegistry, EvidenceRef, ExpressionKind,
    ReviewStatus, Segment, SegmentId,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    ops::Range,
};

/// A complete staged window, constructible only through validation.
pub(super) struct ValidatedWindow {
    new_characters: Vec<Character>,
    updates: Vec<(usize, ExpressionKind, Option<Attribution>)>,
}
impl ValidatedWindow {
    pub(super) fn apply(self, registry: &mut CharacterRegistry, segments: &mut [Segment]) {
        registry.characters.extend(self.new_characters);
        for (index, kind, attribution) in self.updates {
            segments[index].kind = kind;
            segments[index].attribution = attribution;
        }
    }
}

pub(super) fn parse(text: &str) -> Result<AnalysisSuggestion, SuggestionIssue> {
    let text = text.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .and_then(|body| body.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(text);
    serde_json::from_str::<serde_json::Value>(text)
        .map_err(|_| SuggestionIssue::new(SuggestionIssueCode::InvalidJson, ""))?;
    // Decode original text again to retain duplicate-field rejection.
    serde_json::from_str(text)
        .map_err(|_| SuggestionIssue::new(SuggestionIssueCode::InvalidStructure, ""))
}

pub(super) fn validate(
    suggestion: AnalysisSuggestion,
    input: &AnalysisInput<'_>,
    window_index: usize,
    target: &Range<usize>,
    visible: &Range<usize>,
    registry: &CharacterRegistry,
    segments: &[Segment],
) -> Result<ValidatedWindow, SuggestionIssue> {
    let visible_ids: HashSet<_> = segments[visible.clone()]
        .iter()
        .map(|s| s.id.clone())
        .collect();
    let existing: HashSet<_> = registry.characters.iter().map(|c| c.id.clone()).collect();
    let mut temporary = HashMap::new();
    let mut new_characters = Vec::new();
    for (position, character) in suggestion.characters.into_iter().enumerate() {
        let path = format!("/characters/{position}");
        if character.temp_id.trim().is_empty()
            || temporary.contains_key(&character.temp_id)
            || character.display_name.trim().is_empty()
            || character.aliases.iter().any(|a| a.trim().is_empty())
        {
            return Err(SuggestionIssue::new(
                SuggestionIssueCode::InvalidIdentity,
                path,
            ));
        }
        check_evidence(&character.evidence_segment_ids, &visible_ids, true)
            .map_err(|code| SuggestionIssue::new(code, format!("{path}/evidence_segment_ids")))?;
        // JSON array encoding prevents delimiter ambiguity between opaque IDs.
        let identity = serde_json::json!([
            input.book_id,
            input.chapter_id,
            input.source.metadata().sha256,
            window_index,
            character.temp_id
        ])
        .to_string();
        let id = CharacterId::new(format!("char-{:x}", Sha256::digest(identity.as_bytes())))
            .expect("SHA256 produces a nonblank identity");
        if existing.contains(&id) {
            return Err(SuggestionIssue::new(
                SuggestionIssueCode::InvalidIdentity,
                path,
            ));
        }
        temporary.insert(character.temp_id, id.clone());
        new_characters.push(Character {
            id,
            display_name: character.display_name,
            aliases: character.aliases,
            review_status: ReviewStatus::Unreviewed,
            evidence: character
                .evidence_segment_ids
                .into_iter()
                .map(|segment_id| EvidenceRef {
                    chapter_id: input.chapter_id.clone(),
                    segment_id,
                })
                .collect(),
            voice_profile: None,
            extensions: Default::default(),
        });
    }
    let target_ids: HashMap<_, _> = segments[target.clone()]
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id.clone(), target.start + i))
        .collect();
    let mut seen = HashSet::new();
    let mut updates = Vec::new();
    for (position, annotation) in suggestion.segments.into_iter().enumerate() {
        let path = format!("/segments/{position}");
        let Some(&index) = target_ids.get(&annotation.segment_id) else {
            return Err(SuggestionIssue::new(
                SuggestionIssueCode::OutsideTarget,
                format!("{path}/segment_id"),
            ));
        };
        let segment_id = &segments[index].id;
        if !seen.insert(annotation.segment_id) {
            return Err(SuggestionIssue::new(
                SuggestionIssueCode::DuplicateTarget,
                format!("{path}/segment_id"),
            )
            .for_segment(segment_id));
        }
        let attribution = annotation
            .attribution
            .map(|a| attribution(a, &temporary, &existing, &visible_ids))
            .transpose()
            .map_err(|code| {
                SuggestionIssue::new(code, format!("{path}/attribution")).for_segment(segment_id)
            })?;
        if attribution.is_none()
            && matches!(
                annotation.kind,
                ExpressionKind::Speech | ExpressionKind::Thought
            )
        {
            return Err(SuggestionIssue::new(
                SuggestionIssueCode::MissingAttribution,
                format!("{path}/attribution"),
            )
            .for_segment(segment_id));
        }
        updates.push((index, annotation.kind, attribution));
    }
    if let Some(segment) = segments[target.clone()]
        .iter()
        .find(|s| !seen.contains(&s.id))
    {
        return Err(
            SuggestionIssue::new(SuggestionIssueCode::MissingTarget, "/segments")
                .for_segment(&segment.id),
        );
    }
    Ok(ValidatedWindow {
        new_characters,
        updates,
    })
}

fn check_evidence(
    ids: &[SegmentId],
    visible: &HashSet<SegmentId>,
    required: bool,
) -> Result<(), SuggestionIssueCode> {
    if (required && ids.is_empty()) || ids.iter().any(|id| !visible.contains(id)) {
        return Err(SuggestionIssueCode::InvalidEvidence);
    }
    Ok(())
}
fn resolve(
    reference: CharacterReference,
    temporary: &HashMap<String, CharacterId>,
    existing: &HashSet<CharacterId>,
) -> Result<CharacterId, SuggestionIssueCode> {
    match reference {
        CharacterReference::Existing(id) if existing.contains(&id) => Ok(id),
        CharacterReference::New(id) => temporary
            .get(&id)
            .cloned()
            .ok_or(SuggestionIssueCode::UndeclaredIdentity),
        _ => Err(SuggestionIssueCode::UnknownIdentity),
    }
}
fn attribution(
    value: SuggestedAttribution,
    temporary: &HashMap<String, CharacterId>,
    existing: &HashSet<CharacterId>,
    visible: &HashSet<SegmentId>,
) -> Result<Attribution, SuggestionIssueCode> {
    let review_status = ReviewStatus::Unreviewed;
    Ok(match value {
        SuggestedAttribution::Resolved {
            character,
            evidence_segment_ids,
        } => {
            check_evidence(&evidence_segment_ids, visible, true)?;
            Attribution::Resolved {
                character_id: resolve(character, temporary, existing)?,
                evidence_segment_ids,
                review_status,
            }
        }
        SuggestedAttribution::Ambiguous {
            candidates,
            evidence_segment_ids,
        } => {
            check_evidence(&evidence_segment_ids, visible, true)?;
            let candidate_ids: Vec<_> = candidates
                .into_iter()
                .map(|r| resolve(r, temporary, existing))
                .collect::<Result<_, _>>()?;
            let unique: HashSet<_> = candidate_ids.iter().collect();
            if unique.len() < 2 || unique.len() != candidate_ids.len() {
                return Err(SuggestionIssueCode::InvalidCandidates);
            }
            Attribution::Ambiguous {
                candidate_ids,
                evidence_segment_ids,
                review_status,
            }
        }
        SuggestedAttribution::Unknown {
            evidence_segment_ids,
        } => {
            check_evidence(&evidence_segment_ids, visible, false)?;
            Attribution::Unknown {
                evidence_segment_ids,
                review_status,
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        BookId, ChapterId, CharacterSuggestion, FORMAT_VERSION, SourceSnapshot, partition_source,
    };

    #[test]
    fn invalid_candidate_cannot_mutate_registry_or_segments() {
        let input = AnalysisInput {
            book_id: BookId::new("book").unwrap(),
            chapter_id: ChapterId::new("chapter").unwrap(),
            source: SourceSnapshot::import("张三。"),
            context: None,
        };
        let segments = partition_source(&input.source, 160).unwrap();
        let registry = CharacterRegistry {
            format_version: FORMAT_VERSION,
            book_id: input.book_id.clone(),
            revision: 1,
            characters: vec![],
            extensions: Default::default(),
        };
        let suggestion = AnalysisSuggestion {
            characters: vec![CharacterSuggestion {
                temp_id: "new".into(),
                display_name: "张三".into(),
                aliases: vec![],
                evidence_segment_ids: vec![segments[0].id.clone()],
            }],
            segments: vec![],
        };
        let before = segments.clone();
        let issue = validate(
            suggestion,
            &input,
            0,
            &(0..1),
            &(0..1),
            &registry,
            &segments,
        )
        .err()
        .unwrap();
        assert_eq!(issue.code(), SuggestionIssueCode::MissingTarget);
        assert_eq!(issue.segment_id(), Some(&segments[0].id));
        assert!(registry.characters.is_empty());
        assert_eq!(segments, before);
    }

    #[test]
    fn parse_feedback_has_no_rejected_values() {
        for (text, code) in [
            ("{\"private\":", SuggestionIssueCode::InvalidJson),
            (
                "{\"private-secret\":1}",
                SuggestionIssueCode::InvalidStructure,
            ),
            (
                "{\"characters\":[],\"characters\":[],\"segments\":[]}",
                SuggestionIssueCode::InvalidStructure,
            ),
        ] {
            let issue = parse(text).unwrap_err();
            assert_eq!(issue.code(), code);
            assert!(!format!("{issue:?} {issue}").contains("private"));
            assert!(!serde_json::to_string(&issue).unwrap().contains("private"));
        }
    }
}
