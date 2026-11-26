//! Pure validation over authoritative source bytes and project-scoped identities.
use super::types::*;
use std::collections::HashSet;

pub(crate) fn range_valid(text: &str, binding: &SourceBinding, range: &ByteRange) -> bool {
    range.start >= binding.start
        && range.end <= binding.end
        && range.start < range.end
        && text.get(range.start as usize..range.end as usize).is_some()
}

pub(crate) fn validate(
    version: &AnalysisVersion,
    text: &str,
    characters: &[Character],
) -> Result<(), AnalysisError> {
    let invalid = AnalysisError::InvalidData;
    let binding = &version.dependencies.source;
    if !matches!(version.format_version, 1 | 2)
        || version.id.is_empty()
        || binding.project_id.is_empty()
        || binding.chapter_id.is_empty()
        || binding.source_id.is_empty()
        || !range_valid(
            text,
            binding,
            &ByteRange {
                start: binding.start,
                end: binding.end,
            },
        )
    {
        return Err(invalid);
    }
    if crate::project::hash(text.as_bytes()) != binding.sha256 {
        return Err(AnalysisError::SourceChanged);
    }
    let known = validate_character_identities(characters, &binding.project_id)?;
    validate_segment_partition(version, text, &known)?;
    for p in &version.protections {
        if p.fields.is_empty() || !range_valid(text, binding, &p.range) {
            return Err(invalid);
        }
    }
    Ok(())
}

fn validate_character_identities<'a>(
    characters: &'a [Character],
    project_id: &str,
) -> Result<HashSet<&'a str>, AnalysisError> {
    let invalid = AnalysisError::InvalidData;
    let mut known = HashSet::new();
    for c in characters {
        if c.id.is_empty()
            || c.project_id != project_id
            || c.origin.project_id != project_id
            || c.display_name.trim().is_empty()
            || c.revision == 0
            || !known.insert(c.id.as_str())
        {
            return Err(invalid);
        }
    }
    Ok(known)
}

fn validate_segment_partition(
    version: &AnalysisVersion,
    text: &str,
    known: &HashSet<&str>,
) -> Result<(), AnalysisError> {
    let invalid = AnalysisError::InvalidData;
    let binding = &version.dependencies.source;
    let mut ids = HashSet::new();
    let mut next = binding.start;
    for segment in &version.segments {
        if segment.id.is_empty()
            || !ids.insert(segment.id.as_str())
            || segment.range.start != next
            || !range_valid(text, binding, &segment.range)
        {
            return Err(invalid);
        }
        validate_attribution(segment, version.format_version, known)?;
        if segment.reason.trim().is_empty()
            || segment.evidence.is_empty()
            || segment
                .evidence
                .iter()
                .any(|e| e.reason.trim().is_empty() || !range_valid(text, binding, &e.range))
        {
            return Err(invalid);
        }
        next = segment.range.end;
    }
    if next != binding.end {
        return Err(invalid);
    }
    Ok(())
}

fn validate_attribution(
    segment: &Segment,
    format_version: u32,
    known: &HashSet<&str>,
) -> Result<(), AnalysisError> {
    let invalid = AnalysisError::InvalidData;
    match (&segment.kind, &segment.attribution) {
        (SegmentKind::Narration, Attribution::Narrator) => {}
        (SegmentKind::Unassigned, Attribution::Unassigned)
            if format_version == 2 && segment.review == ReviewStatus::Unreviewed => {}
        (SegmentKind::Unassigned, _) | (_, Attribution::Unassigned) => return Err(invalid),
        (SegmentKind::Narration, _) | (_, Attribution::Narrator) => return Err(invalid),
        (_, Attribution::Resolved { character_id }) if !known.contains(character_id.as_str()) => {
            return Err(invalid);
        }
        (_, Attribution::Ambiguous { character_ids }) => {
            let unique: HashSet<_> = character_ids.iter().collect();
            if unique.len() < 2
                || unique.len() != character_ids.len()
                || character_ids.iter().any(|id| !known.contains(id.as_str()))
            {
                return Err(invalid);
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (String, AnalysisVersion, Vec<Character>) {
        let text = "\u{feff}甲：你好😀！\r\n乙想：e\u{301}。\n\n".to_owned();
        let binding = SourceBinding {
            project_id: "p".into(),
            chapter_id: "c".into(),
            source_id: "s".into(),
            sha256: crate::project::hash(text.as_bytes()),
            start: 0,
            end: text.len() as u32,
        };
        let evidence = Evidence {
            range: ByteRange {
                start: 0,
                end: text.len() as u32,
            },
            reason: "原文".into(),
        };
        let character = Character {
            id: "person".into(),
            project_id: "p".into(),
            display_name: "甲".into(),
            status: CharacterStatus::Candidate,
            revision: 1,
            origin: binding.clone(),
            evidence: vec![evidence.clone()],
        };
        let version = AnalysisVersion {
            format_version: 1,
            id: "v".into(),
            parent_id: None,
            run_id: None,
            dependencies: Dependencies {
                source: binding,
                analysis_revision: 0,
                human_revision: 0,
                characters: vec![],
                contexts: vec![],
            },
            segments: vec![Segment {
                id: "segment".into(),
                range: evidence.range.clone(),
                kind: SegmentKind::Speech,
                attribution: Attribution::Resolved {
                    character_id: "person".into(),
                },
                review: ReviewStatus::Unreviewed,
                evidence: vec![evidence],
                reason: "建议".into(),
            }],
            protections: vec![],
        };
        (text, version, vec![character])
    }
    #[test]
    fn strict_contract_roundtrip_and_unknown_fields() {
        let (_, version, _) = fixture();
        let mut json = serde_json::to_value(&version).unwrap();
        assert_eq!(
            serde_json::from_value::<AnalysisVersion>(json.clone()).unwrap(),
            version
        );
        json["segments"][0]["rewrittenText"] = "不要保存正文".into();
        assert!(serde_json::from_value::<AnalysisVersion>(json).is_err());
        let mut json = serde_json::to_value(&version).unwrap();
        json["segments"][0]["attribution"]["extra"] = true.into();
        assert!(serde_json::from_value::<AnalysisVersion>(json).is_err());
    }
    #[test]
    fn rejects_cross_project_unknown_identity_and_incompatible_type() {
        let (text, mut v, mut characters) = fixture();
        validate(&v, &text, &characters).unwrap();
        characters[0].project_id = "elsewhere".into();
        assert!(validate(&v, &text, &characters).is_err());
        assert!(validate(&v, &text, &[]).is_err());
        characters[0].project_id = "p".into();
        v.segments[0].kind = SegmentKind::Narration;
        assert!(validate(&v, &text, &characters).is_err());
        v.segments[0].attribution = Attribution::Narrator;
        validate(&v, &text, &characters).unwrap();
    }
    #[test]
    fn coverage_unicode_and_evidence_are_not_normalized() {
        let (text, mut v, chars) = fixture();
        validate(&v, &text, &chars).unwrap();
        assert_eq!(
            v.segments
                .iter()
                .map(|s| &text[s.range.start as usize..s.range.end as usize])
                .collect::<String>(),
            text
        );
        v.segments[0].range.start = 1;
        assert!(validate(&v, &text, &chars).is_err());
        v.segments[0].range.start = 0;
        v.segments[0].evidence[0].range.end += 1;
        assert!(validate(&v, &text, &chars).is_err());
        v.segments[0].evidence[0].range.end -= 1;
        v.segments[0].range.end -= 1;
        assert!(validate(&v, &text, &chars).is_err());
        assert!(validate(&fixture().1, &text.replace("\r\n", "\n"), &chars).is_err());
    }
}
