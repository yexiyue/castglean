use super::super::{types::*, validation::range_valid};
use crate::database::entity::character;
use sea_orm::{ActiveModelTrait, ConnectionTrait, Set};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ManualSpeaker {
    Narrator,
    Existing { character_id: String },
    New { name: String },
}

pub(super) fn empty(source: SourceBinding) -> AnalysisVersion {
    let range = ByteRange {
        start: source.start,
        end: source.end,
    };
    AnalysisVersion {
        format_version: 2,
        id: uuid::Uuid::new_v4().to_string(),
        parent_id: None,
        run_id: None,
        dependencies: Dependencies {
            source,
            analysis_revision: 0,
            human_revision: 0,
            characters: Vec::new(),
            contexts: Vec::new(),
        },
        segments: vec![segment(
            range,
            SegmentKind::Unassigned,
            Attribution::Unassigned,
        )],
        protections: Vec::new(),
    }
}

fn segment(range: ByteRange, kind: SegmentKind, attribution: Attribution) -> Segment {
    let unassigned = kind == SegmentKind::Unassigned;
    let reason = if unassigned {
        "尚未标注"
    } else {
        "手动指定归属"
    }
    .to_owned();
    Segment {
        id: uuid::Uuid::new_v4().to_string(),
        kind,
        attribution,
        range: range.clone(),
        review: if unassigned {
            ReviewStatus::Unreviewed
        } else {
            ReviewStatus::Confirmed
        },
        evidence: vec![Evidence {
            range,
            reason: reason.clone(),
        }],
        reason,
    }
}

pub(super) fn check_range(
    text: &str,
    source: &SourceBinding,
    range: &ByteRange,
) -> Result<(), AnalysisError> {
    if !range_valid(text, source, range)
        || text[range.start as usize..range.end as usize]
            .chars()
            .all(blank)
    {
        return Err(AnalysisError::InvalidData);
    }
    Ok(())
}

pub(super) fn blank(ch: char) -> bool {
    ch.is_whitespace() || ch == '\u{feff}'
}

pub(super) async fn resolve(
    db: &impl ConnectionTrait,
    source: &SourceBinding,
    range: &ByteRange,
    kind: SegmentKind,
    speaker: &ManualSpeaker,
) -> Result<Attribution, AnalysisError> {
    match (kind, speaker) {
        (SegmentKind::Narration, ManualSpeaker::Narrator) => Ok(Attribution::Narrator),
        (SegmentKind::Speech | SegmentKind::Thought, ManualSpeaker::Existing { character_id }) => {
            Ok(Attribution::Resolved {
                character_id: character_id.clone(),
            })
        }
        (SegmentKind::Speech | SegmentKind::Thought, ManualSpeaker::New { name }) => {
            if name.trim().is_empty() || name.chars().count() > 120 || name.contains('\0') {
                return Err(AnalysisError::InvalidData);
            }
            let value = Character {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: source.project_id.clone(),
                display_name: name.trim().into(),
                status: CharacterStatus::Confirmed,
                revision: 1,
                origin: source.clone(),
                evidence: vec![Evidence {
                    range: range.clone(),
                    reason: "手动指定归属".into(),
                }],
            };
            character::ActiveModel {
                id: Set(value.id.clone()),
                project_id: Set(value.project_id.clone()),
                display_name: Set(value.display_name.clone()),
                status: Set("confirmed".into()),
                revision: Set(1),
                content: Set(serde_json::to_value(&value).map_err(|_| AnalysisError::InvalidData)?),
            }
            .insert(db)
            .await
            .map_err(|_| AnalysisError::WriteFailed)?;
            Ok(Attribution::Resolved {
                character_id: value.id,
            })
        }
        _ => Err(AnalysisError::InvalidData),
    }
}

pub(super) fn assign(
    version: &mut AnalysisVersion,
    range: &ByteRange,
    kind: SegmentKind,
    attribution: Attribution,
) {
    let mut replacement = Some(segment(range.clone(), kind, attribution));
    let mut segments = Vec::new();
    for previous in std::mem::take(&mut version.segments) {
        if previous.range.end <= range.start || previous.range.start >= range.end {
            segments.push(previous);
            continue;
        }
        if previous.range.start < range.start {
            segments.push(crop(
                previous.clone(),
                ByteRange {
                    start: previous.range.start,
                    end: range.start,
                },
            ));
        }
        if let Some(assigned) = replacement.take() {
            segments.push(assigned);
        }
        if previous.range.end > range.end {
            let end = previous.range.end;
            segments.push(crop(
                previous,
                ByteRange {
                    start: range.end,
                    end,
                },
            ));
        }
    }
    version.segments = segments;
    protect(version, range);
}

fn crop(mut value: Segment, range: ByteRange) -> Segment {
    value.id = uuid::Uuid::new_v4().to_string();
    value.evidence.retain_mut(|evidence| {
        evidence.range.start = evidence.range.start.max(range.start);
        evidence.range.end = evidence.range.end.min(range.end);
        evidence.range.start < evidence.range.end
    });
    if value.evidence.is_empty() {
        value.evidence.push(Evidence {
            range: range.clone(),
            reason: "原文定位".into(),
        });
    }
    value.range = range;
    value
}

pub(super) fn fill_narrator(version: &mut AnalysisVersion) -> Result<(), AnalysisError> {
    let ranges: Vec<_> = version
        .segments
        .iter()
        .filter(|segment| segment.kind == SegmentKind::Unassigned)
        .map(|segment| segment.range.clone())
        .collect();
    if ranges.is_empty() {
        return Err(AnalysisError::InvalidData);
    }
    for item in &mut version.segments {
        if item.kind == SegmentKind::Unassigned {
            *item = segment(
                item.range.clone(),
                SegmentKind::Narration,
                Attribution::Narrator,
            );
        }
    }
    for range in &ranges {
        protect(version, range);
    }
    Ok(())
}

fn protect(version: &mut AnalysisVersion, range: &ByteRange) {
    super::super::review::subtract_protection_range(&mut version.protections, range);
    version.protections.push(Protection {
        range: range.clone(),
        fields: vec![
            ProtectedField::Boundary,
            ProtectedField::Kind,
            ProtectedField::Attribution,
            ProtectedField::Review,
        ],
    });
}
