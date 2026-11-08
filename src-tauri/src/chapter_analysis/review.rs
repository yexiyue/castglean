//! Contiguous replacement groups preserve human ranges even when model IDs change.
use super::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Difference {
    pub id: String,
    pub range: ByteRange,
    pub current: Vec<Segment>,
    pub suggested: Vec<Segment>,
    pub conflict: bool,
}

fn same(a: &Segment, b: &Segment) -> bool {
    a.range == b.range && a.kind == b.kind && a.attribution == b.attribution
}

/// Remove only the replaced bytes; uncovered fragments keep their original fields.
pub(super) fn subtract_protection_range(protections: &mut Vec<Protection>, range: &ByteRange) {
    let mut remaining = Vec::new();
    for mut protection in std::mem::take(protections) {
        if protection.range.end <= range.start || protection.range.start >= range.end {
            remaining.push(protection);
            continue;
        }
        if protection.range.start < range.start {
            let mut left = protection.clone();
            left.range.end = range.start;
            remaining.push(left);
        }
        if protection.range.end > range.end {
            protection.range.start = range.end;
            remaining.push(protection);
        }
    }
    *protections = remaining;
}

pub(crate) fn differences(
    current: &AnalysisVersion,
    candidate: &AnalysisVersion,
) -> Result<Vec<Difference>, AnalysisError> {
    if current.dependencies.source != candidate.dependencies.source {
        return Err(AnalysisError::SourceChanged);
    }
    let (old, new) = (&current.segments, &candidate.segments);
    let (mut i, mut j) = (0, 0);
    let mut groups = Vec::new();
    while i < old.len() && j < new.len() {
        if old[i].range.start != new[j].range.start {
            return Err(AnalysisError::InvalidData);
        }
        let (a, b) = (i, j);
        while old[i].range.end != new[j].range.end {
            if old[i].range.end < new[j].range.end {
                i += 1;
            } else {
                j += 1;
            }
            if i >= old.len() || j >= new.len() {
                return Err(AnalysisError::InvalidData);
            }
        }
        let range = ByteRange {
            start: old[a].range.start,
            end: old[i].range.end,
        };
        if i - a != j - b || !old[a..=i].iter().zip(&new[b..=j]).all(|(a, b)| same(a, b)) {
            let conflict = current
                .protections
                .iter()
                .any(|p| p.range.start < range.end && p.range.end > range.start);
            groups.push(Difference {
                id: format!("{}:{}", range.start, range.end),
                range,
                current: old[a..=i].to_vec(),
                suggested: new[b..=j].to_vec(),
                conflict,
            });
        }
        i += 1;
        j += 1;
    }
    if i != old.len() || j != new.len() {
        return Err(AnalysisError::InvalidData);
    }
    Ok(groups)
}

/// Callers validate the resulting whole chapter before committing a new version.
pub(crate) fn merge(
    current: &AnalysisVersion,
    groups: &[Difference],
    selected: &[String],
    allow_conflicts: &[String],
) -> Result<AnalysisVersion, AnalysisError> {
    let chosen: HashSet<_> = selected.iter().collect();
    let allowed: HashSet<_> = allow_conflicts.iter().collect();
    if chosen.len() != selected.len()
        || allowed.iter().any(|id| !chosen.contains(id))
        || chosen.iter().any(|id| !groups.iter().any(|g| &g.id == *id))
    {
        return Err(AnalysisError::InvalidData);
    }
    let mut result = current.clone();
    let mut segments = Vec::new();
    let mut skip_until = current.dependencies.source.start;
    for segment in &current.segments {
        if segment.range.start < skip_until {
            continue;
        }
        if let Some(g) = groups
            .iter()
            .find(|g| g.range.start == segment.range.start && chosen.contains(&g.id))
        {
            if g.conflict && !allowed.contains(&g.id) {
                return Err(AnalysisError::Conflict);
            }
            segments.extend(g.suggested.clone());
            skip_until = g.range.end;
        } else {
            segments.push(segment.clone());
        }
    }
    for group in groups.iter().filter(|g| chosen.contains(&g.id)) {
        subtract_protection_range(&mut result.protections, &group.range);
    }
    result.segments = segments;
    result.id = uuid::Uuid::new_v4().to_string();
    result.parent_id = Some(current.id.clone());
    result.run_id = None;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn segment(id: &str, start: u32, end: u32) -> Segment {
        Segment {
            id: id.into(),
            range: ByteRange { start, end },
            kind: SegmentKind::Speech,
            attribution: Attribution::Unknown,
            review: ReviewStatus::Unreviewed,
            evidence: vec![],
            reason: "未知".into(),
        }
    }
    fn version(segments: Vec<Segment>) -> AnalysisVersion {
        AnalysisVersion {
            format_version: 1,
            id: "v".into(),
            parent_id: None,
            run_id: None,
            dependencies: Dependencies {
                source: SourceBinding {
                    project_id: "p".into(),
                    chapter_id: "c".into(),
                    source_id: "s".into(),
                    sha256: "hash".into(),
                    start: 0,
                    end: 9,
                },
                analysis_revision: 1,
                human_revision: 1,
                characters: vec![],
                contexts: vec![],
            },
            segments,
            protections: vec![Protection {
                range: ByteRange { start: 0, end: 3 },
                fields: vec![ProtectedField::Boundary],
            }],
        }
    }
    #[test]
    fn regenerated_ids_do_not_bypass_human_boundaries() {
        let old = version(vec![
            segment("a", 0, 3),
            segment("b", 3, 6),
            segment("c", 6, 9),
        ]);
        let mut candidate = version(vec![segment("new", 0, 6), segment("other", 6, 9)]);
        let groups = differences(&old, &candidate).unwrap();
        assert_eq!(groups.len(), 1);
        assert!(groups[0].conflict);
        assert_eq!(
            merge(&old, &groups, &[], &[]).unwrap().segments,
            old.segments
        );
        assert!(merge(&old, &groups, &[groups[0].id.clone()], &[]).is_err());
        let merged = merge(
            &old,
            &groups,
            &[groups[0].id.clone()],
            &[groups[0].id.clone()],
        )
        .unwrap();
        assert_eq!(merged.segments.len(), 2);
        assert!(merged.protections.is_empty());
        candidate.segments = old.segments.clone();
        for s in &mut candidate.segments {
            s.id.push('x');
        }
        assert!(differences(&old, &candidate).unwrap().is_empty());
    }

    #[test]
    fn partial_adoption_preserves_uncovered_protection_and_later_conflicts() {
        for selected_index in 0..3 {
            let mut old = version(vec![
                segment("a", 0, 3),
                segment("b", 3, 6),
                segment("c", 6, 9),
            ]);
            let fields = vec![ProtectedField::Boundary, ProtectedField::Attribution];
            old.protections = vec![Protection {
                range: ByteRange { start: 0, end: 9 },
                fields: fields.clone(),
            }];
            let mut candidate = old.clone();
            for s in &mut candidate.segments {
                s.kind = SegmentKind::Thought;
            }
            let groups = differences(&old, &candidate).unwrap();
            let selected = vec![groups[selected_index].id.clone()];
            let merged = merge(&old, &groups, &selected, &selected).unwrap();
            let expected: Vec<_> = [
                (0, groups[selected_index].range.start),
                (groups[selected_index].range.end, 9),
            ]
            .into_iter()
            .filter(|(start, end)| start < end)
            .map(|(start, end)| Protection {
                range: ByteRange { start, end },
                fields: fields.clone(),
            })
            .collect();
            assert_eq!(merged.protections, expected);
            for (index, s) in merged.segments.iter().enumerate() {
                assert_eq!(
                    s,
                    if index == selected_index {
                        &candidate.segments[index]
                    } else {
                        &old.segments[index]
                    }
                );
            }
            let later = differences(&merged, &candidate).unwrap();
            assert_eq!(later.len(), 2);
            assert!(later.iter().all(|g| g.conflict));
            let later_selected: Vec<_> = later.iter().map(|g| g.id.clone()).collect();
            assert_eq!(
                merge(&merged, &later, &later_selected, &[]),
                Err(AnalysisError::Conflict)
            );
        }
    }

    #[test]
    fn disjoint_adoptions_preserve_the_protection_between_them() {
        let mut old = version(vec![
            segment("a", 0, 3),
            segment("b", 3, 6),
            segment("c", 6, 9),
        ]);
        old.protections = vec![Protection {
            range: ByteRange { start: 0, end: 9 },
            fields: vec![ProtectedField::Review],
        }];
        let mut candidate = old.clone();
        for s in &mut candidate.segments {
            s.kind = SegmentKind::Thought;
        }
        let groups = differences(&old, &candidate).unwrap();
        let selected = vec![groups[0].id.clone(), groups[2].id.clone()];
        let merged = merge(&old, &groups, &selected, &selected).unwrap();
        assert_eq!(
            merged.protections,
            vec![Protection {
                range: ByteRange { start: 3, end: 6 },
                fields: vec![ProtectedField::Review],
            }]
        );
        assert_eq!(merged.segments[1], old.segments[1]);
        assert!(differences(&merged, &candidate).unwrap()[0].conflict);
    }

    #[test]
    fn adoption_keeps_touching_protections_and_their_distinct_fields() {
        let mut old = version(vec![
            segment("a", 0, 3),
            segment("b", 3, 6),
            segment("c", 6, 9),
        ]);
        old.protections = vec![
            Protection {
                range: ByteRange { start: 0, end: 3 },
                fields: vec![ProtectedField::Kind],
            },
            Protection {
                range: ByteRange { start: 3, end: 6 },
                fields: vec![ProtectedField::Boundary, ProtectedField::Attribution],
            },
            Protection {
                range: ByteRange { start: 6, end: 9 },
                fields: vec![ProtectedField::Review],
            },
        ];
        let mut candidate = old.clone();
        candidate.segments[1].kind = SegmentKind::Thought;
        let groups = differences(&old, &candidate).unwrap();
        let selected = vec![groups[0].id.clone()];
        let merged = merge(&old, &groups, &selected, &selected).unwrap();
        assert_eq!(
            merged.protections,
            vec![old.protections[0].clone(), old.protections[2].clone()]
        );
    }
}
