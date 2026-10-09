use super::{
    AnalysisSuggestion, CharacterReference, EvidenceMode, SuggestedAttribution, SuggestionIssue,
    SuggestionIssueCode, quotation::QuotationContext,
};
use crate::{
    Attribution, Character, CharacterId, CharacterRegistry, EvidenceRef, ExpressionKind,
    Extensions, ReviewStatus, Segment, SegmentId,
};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

/// A complete staged window, constructible only through validation.
pub(super) struct ValidatedWindow {
    new_characters: Vec<Character>,
    updates: Vec<(usize, ExpressionKind, Option<Attribution>, Extensions)>,
}
impl ValidatedWindow {
    pub(super) fn apply(self, registry: &mut CharacterRegistry, segments: &mut [Segment]) {
        registry.characters.extend(self.new_characters);
        for (index, kind, attribution, extensions) in self.updates {
            segments[index].kind = kind;
            segments[index].attribution = attribution;
            segments[index].extensions.extend(extensions);
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
    window: &super::window::WindowContext<'_, '_>,
    evidence_mode: EvidenceMode,
) -> Result<ValidatedWindow, SuggestionIssue> {
    let input = window.input;
    let window_index = window.index;
    let target = &window.target;
    let visible = &window.visible;
    let registry = window.registry;
    let segments = window.segments;
    let visible_ids: HashSet<_> = segments[visible.clone()]
        .iter()
        .map(|s| s.id.clone())
        .collect();
    let quotations = QuotationContext {
        input,
        segments,
        visible,
    };
    let required_quotes = evidence_mode == EvidenceMode::VerifiedQuotes;
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
        let extensions = quotations.locate(
            &character.evidence_quotes,
            &character.evidence_segment_ids,
            required_quotes,
            &format!("{path}/evidence_quotes"),
        )?;
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
            extensions,
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
        let (attribution, extensions) = annotation
            .attribution
            .map(|a| {
                attribution(
                    a,
                    &temporary,
                    &existing,
                    &visible_ids,
                    &quotations,
                    required_quotes,
                    &format!("{path}/attribution"),
                )
            })
            .transpose()
            .map_err(|code| code.for_segment(segment_id))?
            .map(|(a, extensions)| (Some(a), extensions))
            .unwrap_or_default();
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
        updates.push((index, annotation.kind, attribution, extensions));
    }
    let missing: Vec<_> = segments[target.clone()]
        .iter()
        .filter(|s| !seen.contains(&s.id))
        .map(|s| s.id.clone())
        .collect();
    if let Some(first) = missing.first() {
        return Err(
            SuggestionIssue::new(SuggestionIssueCode::MissingTarget, "/segments")
                .for_segment(first)
                .with_missing(missing),
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
    quotations: &QuotationContext<'_, '_>,
    required_quotes: bool,
    path: &str,
) -> Result<(Attribution, Extensions), SuggestionIssue> {
    let issue = |code| SuggestionIssue::new(code, path);
    let review_status = ReviewStatus::Unreviewed;
    let (ids, quotes, required) = match &value {
        SuggestedAttribution::Resolved {
            evidence_segment_ids,
            evidence_quotes,
            ..
        }
        | SuggestedAttribution::Ambiguous {
            evidence_segment_ids,
            evidence_quotes,
            ..
        } => (evidence_segment_ids, evidence_quotes, true),
        SuggestedAttribution::Unknown {
            evidence_segment_ids,
            evidence_quotes,
        } => (evidence_segment_ids, evidence_quotes, false),
    };
    check_evidence(ids, visible, required).map_err(issue)?;
    let extensions = quotations.locate(
        quotes,
        ids,
        required && required_quotes,
        &format!("{path}/evidence_quotes"),
    )?;
    let attribution = match value {
        SuggestedAttribution::Resolved {
            character,
            evidence_segment_ids,
            ..
        } => Attribution::Resolved {
            character_id: resolve(character, temporary, existing).map_err(issue)?,
            evidence_segment_ids,
            review_status,
        },
        SuggestedAttribution::Ambiguous {
            candidates,
            evidence_segment_ids,
            ..
        } => {
            let candidate_ids: Vec<_> = candidates
                .into_iter()
                .map(|r| resolve(r, temporary, existing))
                .collect::<Result<_, _>>()
                .map_err(issue)?;
            let unique: HashSet<_> = candidate_ids.iter().collect();
            if unique.len() < 2 || unique.len() != candidate_ids.len() {
                return Err(issue(SuggestionIssueCode::InvalidCandidates));
            }
            Attribution::Ambiguous {
                candidate_ids,
                evidence_segment_ids,
                review_status,
            }
        }
        SuggestedAttribution::Unknown {
            evidence_segment_ids,
            ..
        } => Attribution::Unknown {
            evidence_segment_ids,
            review_status,
        },
    };
    Ok((attribution, extensions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AnalysisInput, BookId, ChapterId, CharacterSuggestion, FORMAT_VERSION, SourceSnapshot,
        partition_source,
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
                evidence_quotes: vec![],
            }],
            segments: vec![],
        };
        let before = segments.clone();
        let issue = validate(
            suggestion,
            &super::super::window::WindowContext {
                input: &input,
                index: 0,
                target: 0..1,
                visible: 0..1,
                registry: &registry,
                segments: &segments,
                remaining_windows: 0,
            },
            EvidenceMode::SegmentIds,
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
