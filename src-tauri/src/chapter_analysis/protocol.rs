//! Model-local keys and scalar coordinates never become trusted identities directly.
use super::{
    source::{self, ModelRange},
    types::*,
    windows::Window,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModelEvidence {
    pub range: ModelRange,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModelCharacter {
    #[schemars(regex(pattern = r"^new:"))]
    #[schemars(
        description = "NEW candidate key only, prefixed with new:. Never put a confirmed character UUID or a previously declared localCandidates key here."
    )]
    pub key: String,
    pub name: String,
    pub evidence: Vec<ModelEvidence>,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ModelAttribution {
    Narrator,
    Unknown,
    Resolved { key: String },
    Ambiguous { keys: Vec<String> },
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModelSegment {
    pub range: ModelRange,
    pub kind: SegmentKind,
    pub attribution: ModelAttribution,
    pub evidence: Vec<ModelEvidence>,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModelOutput {
    #[schemars(
        description = "Only NEW candidate identities not present in confirmedCharacters or localCandidates. If there are no new people, return []. Existing characters are referenced by attribution.key and must NOT be redeclared here."
    )]
    pub characters: Vec<ModelCharacter>,
    pub segments: Vec<ModelSegment>,
}

pub(crate) fn convert(
    output: ModelOutput,
    window: &Window,
    binding: &SourceBinding,
    known: &[Character],
    local: &mut BTreeMap<String, Character>,
) -> Result<Vec<Segment>, AnalysisError> {
    let mut keys: HashSet<_> = known.iter().map(|c| c.id.clone()).collect();
    keys.extend(local.keys().cloned());
    let evidence = |items: Vec<ModelEvidence>| -> Result<Vec<Evidence>, AnalysisError> {
        if items.is_empty() {
            return Err(AnalysisError::InvalidData);
        }
        items
            .into_iter()
            .map(|e| {
                let range = source::resolve(&window.anchors, &e.range)?;
                if range.start < binding.start
                    || range.end > binding.end
                    || e.reason.trim().is_empty()
                {
                    return Err(AnalysisError::InvalidData);
                }
                Ok(Evidence {
                    range,
                    reason: e.reason,
                })
            })
            .collect()
    };
    for c in output.characters {
        if !c.key.starts_with("new:")
            || c.key.len() > 128
            || c.name.trim().is_empty()
            || c.name.chars().count() > 120
            || !keys.insert(c.key.clone())
        {
            return Err(AnalysisError::InvalidData);
        }
        local.insert(
            c.key,
            Character {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: binding.project_id.clone(),
                display_name: c.name,
                status: CharacterStatus::Candidate,
                revision: 1,
                origin: binding.clone(),
                evidence: evidence(c.evidence)?,
            },
        );
    }
    let lookup = |key: &str| -> Result<String, AnalysisError> {
        local
            .get(key)
            .map(|c| c.id.clone())
            .or_else(|| known.iter().find(|c| c.id == key).map(|c| c.id.clone()))
            .ok_or(AnalysisError::InvalidData)
    };
    let mut next = window.owned.start;
    let mut segments = Vec::new();
    for s in output.segments {
        let range = source::resolve(&window.anchors, &s.range)?;
        if range.start != next || range.end > window.owned.end || s.reason.trim().is_empty() {
            return Err(AnalysisError::InvalidData);
        }
        let attribution = match s.attribution {
            ModelAttribution::Narrator => Attribution::Narrator,
            ModelAttribution::Unknown => Attribution::Unknown,
            ModelAttribution::Resolved { key } => Attribution::Resolved {
                character_id: lookup(&key)?,
            },
            ModelAttribution::Ambiguous { keys } => {
                let ids = keys
                    .iter()
                    .map(|k| lookup(k))
                    .collect::<Result<Vec<_>, _>>()?;
                if ids.len() < 2 || ids.iter().collect::<HashSet<_>>().len() != ids.len() {
                    return Err(AnalysisError::InvalidData);
                }
                Attribution::Ambiguous { character_ids: ids }
            }
        };
        if (s.kind == SegmentKind::Narration) != matches!(attribution, Attribution::Narrator) {
            return Err(AnalysisError::InvalidData);
        }
        next = range.end;
        segments.push(Segment {
            id: uuid::Uuid::new_v4().to_string(),
            range,
            kind: s.kind,
            attribution,
            review: ReviewStatus::Unreviewed,
            evidence: evidence(s.evidence)?,
            reason: s.reason,
        });
    }
    if next != window.owned.end {
        return Err(AnalysisError::InvalidData);
    }
    Ok(segments)
}

/// Model-visible coordinates have one unit only; absolute byte offsets remain host-private.
pub(crate) fn window_payload(window: &Window) -> Result<serde_json::Value, AnalysisError> {
    let first = window
        .anchors
        .iter()
        .find(|a| a.start == window.owned.start)
        .ok_or(AnalysisError::InvalidData)?;
    let last = window
        .anchors
        .iter()
        .find(|a| a.start + a.text.len() as u32 == window.owned.end)
        .ok_or(AnalysisError::InvalidData)?;
    Ok(serde_json::json!({
        "owned": {"start":{"anchorId":first.id,"scalar":0},"end":{"anchorId":last.id,"scalar":last.text.chars().count()}},
        "anchors": window.anchors.iter().map(|a| serde_json::json!({"id":a.id,"text":a.text,"scalarLength":a.text.chars().count(),"owned":a.start >= window.owned.start && a.start < window.owned.end})).collect::<Vec<_>>(),
        "coordinate":"Each scalar index is relative to its anchor, zero-based, end-exclusive. Anchor IDs are opaque identifiers, NOT positions. The listed anchors are contiguous; do not infer gaps from their IDs.",
        "outputSchema": schemars::schema_for!(ModelOutput)
    }))
}

#[cfg(test)]
mod tests {
    use super::super::source::Position;
    use super::*;
    fn fixture() -> (Window, SourceBinding, ModelOutput) {
        let text = "甲说：‘你好🙂’\r\n乙沉默。";
        let b = SourceBinding {
            project_id: "p".into(),
            chapter_id: "c".into(),
            source_id: "s".into(),
            sha256: crate::project::hash(text.as_bytes()),
            start: 0,
            end: text.len() as u32,
        };
        let w = super::super::windows::plan(text, &b, None, None, 0)
            .unwrap()
            .remove(0);
        let first = &w.anchors[0];
        let last = w.anchors.last().unwrap();
        let range = ModelRange {
            start: Position {
                anchor_id: first.id.clone(),
                scalar: 0,
            },
            end: Position {
                anchor_id: last.id.clone(),
                scalar: last.text.chars().count() as u32,
            },
        };
        let e = ModelEvidence {
            range: range.clone(),
            reason: "原文无法确定全段归属".into(),
        };
        let output = ModelOutput {
            characters: vec![],
            segments: vec![ModelSegment {
                range,
                kind: SegmentKind::Speech,
                attribution: ModelAttribution::Unknown,
                evidence: vec![e],
                reason: "未知".into(),
            }],
        };
        (w, b, output)
    }
    #[test]
    fn confirmed_id_is_a_reference_and_never_a_new_declaration() {
        let (w, b, mut raw) = fixture();
        let character = Character {
            id: "confirmed-id".into(),
            project_id: b.project_id.clone(),
            display_name: "已确认人物".into(),
            status: CharacterStatus::Confirmed,
            revision: 1,
            origin: b.clone(),
            evidence: vec![Evidence {
                range: ByteRange {
                    start: b.start,
                    end: b.end,
                },
                reason: "人工确认".into(),
            }],
        };
        raw.segments[0].attribution = ModelAttribution::Resolved {
            key: character.id.clone(),
        };
        let mut local = BTreeMap::new();
        let result = convert(
            raw.clone(),
            &w,
            &b,
            std::slice::from_ref(&character),
            &mut local,
        )
        .unwrap();
        assert_eq!(
            result[0].attribution,
            Attribution::Resolved {
                character_id: character.id.clone()
            }
        );
        assert!(local.is_empty());
        raw.characters.push(ModelCharacter {
            key: character.id.clone(),
            name: character.display_name.clone(),
            evidence: raw.segments[0].evidence.clone(),
        });
        assert!(convert(raw, &w, &b, &[character], &mut BTreeMap::new()).is_err());
        let schema = serde_json::to_value(schemars::schema_for!(ModelOutput)).unwrap();
        assert_eq!(
            schema["$defs"]["ModelCharacter"]["properties"]["key"]["pattern"],
            "^new:"
        );
        assert!(
            schema["properties"]["characters"]["description"]
                .as_str()
                .unwrap()
                .contains("must NOT be redeclared")
        );
    }
    #[test]
    fn valid_unknown_is_preserved_and_candidate_names_never_merge() {
        let (w, b, mut raw) = fixture();
        let mut local = BTreeMap::new();
        let result = convert(raw.clone(), &w, &b, &[], &mut local).unwrap();
        assert_eq!(result[0].attribution, Attribution::Unknown);
        raw.characters = vec![
            ModelCharacter {
                key: "new:one".into(),
                name: "甲".into(),
                evidence: raw.segments[0].evidence.clone(),
            },
            ModelCharacter {
                key: "new:two".into(),
                name: "甲".into(),
                evidence: raw.segments[0].evidence.clone(),
            },
        ];
        convert(raw, &w, &b, &[], &mut local).unwrap();
        assert_ne!(local["new:one"].id, local["new:two"].id);
    }
    #[test]
    fn invalid_indices_missing_coverage_and_forged_characters_are_rejected() {
        let (w, b, raw) = fixture();
        let mut invalid = raw.clone();
        invalid.segments[0].range.end.scalar += 1;
        assert!(convert(invalid, &w, &b, &[], &mut BTreeMap::new()).is_err());
        let mut invalid = raw.clone();
        invalid.segments[0].range.start.scalar = 1;
        assert!(convert(invalid, &w, &b, &[], &mut BTreeMap::new()).is_err());
        let mut invalid = raw;
        invalid.segments[0].attribution = ModelAttribution::Resolved {
            key: "forged-id".into(),
        };
        assert!(convert(invalid, &w, &b, &[], &mut BTreeMap::new()).is_err());
    }
}
