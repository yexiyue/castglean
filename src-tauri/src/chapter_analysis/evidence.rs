//! Freeze annotation-selected source coordinates; read immutable bytes later.
use super::{query, types::*};
use crate::database::entity::analysis_state;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FrozenExcerpt {
    pub source: SourceBinding,
    pub range: ByteRange,
}

/// Capture at most four segments from two chapters per identity and 600 overall.
/// Reads only annotation metadata, so acceptance never reads files under a writer.
pub(crate) async fn freeze_character_evidence(
    db: &impl ConnectionTrait,
    project_id: &str,
    characters: &[String],
) -> Result<BTreeMap<String, Vec<FrozenExcerpt>>, AnalysisError> {
    let mut result: BTreeMap<_, Vec<_>> =
        characters.iter().cloned().map(|id| (id, vec![])).collect();
    if result.is_empty() {
        return Ok(result);
    }
    let states = analysis_state::Entity::find()
        .filter(analysis_state::Column::ProjectId.eq(project_id))
        .order_by_asc(analysis_state::Column::Id)
        .all(db)
        .await?;
    let mut chapters: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut remaining = 600;
    for state in states {
        if remaining == 0 || result.values().all(|items| items.len() == 4) {
            break;
        }
        let version = query::version(db, project_id, &state.current_version_id).await?;
        for segment in &version.segments {
            let ids: &[String] = match &segment.attribution {
                Attribution::Resolved { character_id } => std::slice::from_ref(character_id),
                Attribution::Ambiguous { character_ids } => character_ids,
                _ => continue,
            };
            for id in ids {
                let Some(items) = result.get_mut(id) else {
                    continue;
                };
                let used = chapters.entry(id.clone()).or_default();
                if remaining == 0
                    || items.len() == 4
                    || (used.len() == 2 && !used.contains(&state.id))
                {
                    continue;
                }
                used.insert(state.id.clone());
                items.push(FrozenExcerpt {
                    source: version.dependencies.source.clone(),
                    range: segment.range.clone(),
                });
                remaining -= 1;
            }
        }
    }
    Ok(result)
}

/// Materialize only the frozen coordinates, without consulting current analysis.
pub(crate) fn read_frozen_evidence(
    root: &Path,
    frozen: &BTreeMap<String, Vec<FrozenExcerpt>>,
) -> Result<BTreeMap<String, Vec<String>>, AnalysisError> {
    let mut cached_hash = String::new();
    let mut text = String::new();
    frozen
        .iter()
        .map(|(id, excerpts)| {
            let samples = excerpts
                .iter()
                .map(|excerpt| {
                    if cached_hash != excerpt.source.sha256 {
                        text.clear();
                        text = query::read_text(root, &excerpt.source)?;
                        cached_hash.clone_from(&excerpt.source.sha256);
                    }
                    if !super::validation::range_valid(&text, &excerpt.source, &excerpt.range) {
                        return Err(AnalysisError::InvalidData);
                    }
                    let slice = text
                        .get(excerpt.range.start as usize..excerpt.range.end as usize)
                        .ok_or(AnalysisError::InvalidData)?;
                    Ok(slice.chars().take(160).collect())
                })
                .collect::<Result<Vec<String>, AnalysisError>>()?;
            Ok((id.clone(), samples))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ActiveModelTrait, Set, TransactionTrait};

    #[tokio::test]
    async fn frozen_coordinates_survive_changes_to_current_attribution() {
        let (root, db, project) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        let source = query::binding(&db, "project", "chapter").await.unwrap();
        let text = query::read_text(root.path(), &source).unwrap();
        let character = Character {
            id: "hero".into(),
            project_id: "project".into(),
            display_name: "主角".into(),
            status: CharacterStatus::Confirmed,
            revision: 1,
            origin: source.clone(),
            evidence: vec![],
        };
        crate::database::entity::character::ActiveModel {
            id: Set(character.id.clone()),
            project_id: Set(character.project_id.clone()),
            display_name: Set(character.display_name.clone()),
            status: Set("confirmed".into()),
            revision: Set(1),
            content: Set(serde_json::to_value(character).unwrap()),
        }
        .insert(&db)
        .await
        .unwrap();
        let range = ByteRange {
            start: source.start,
            end: source.end,
        };
        let version = AnalysisVersion {
            format_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            parent_id: None,
            run_id: None,
            dependencies: Dependencies {
                source,
                analysis_revision: 0,
                human_revision: 0,
                characters: vec![],
                contexts: vec![],
            },
            segments: vec![Segment {
                id: "s1".into(),
                range: range.clone(),
                kind: SegmentKind::Speech,
                attribution: Attribution::Resolved {
                    character_id: "hero".into(),
                },
                review: ReviewStatus::Unreviewed,
                evidence: vec![Evidence {
                    range,
                    reason: "公开合成原文".into(),
                }],
                reason: "测试片段".into(),
            }],
            protections: vec![],
        };
        let tx = db.begin().await.unwrap();
        super::super::store::insert_version(&tx, &version, &text)
            .await
            .unwrap();
        super::super::store::set_current(&tx, &version, 0, false, None)
            .await
            .unwrap();
        let frozen = freeze_character_evidence(&tx, "project", &["hero".into()])
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let frozen: BTreeMap<String, Vec<FrozenExcerpt>> =
            serde_json::from_slice(&serde_json::to_vec(&frozen).unwrap()).unwrap();
        analysis_state::Entity::delete_by_id("chapter")
            .exec(&db)
            .await
            .unwrap();
        assert!(
            freeze_character_evidence(&db, "project", &["hero".into()])
                .await
                .unwrap()["hero"]
                .is_empty()
        );
        let samples = read_frozen_evidence(root.path(), &frozen).unwrap();
        assert_eq!(
            samples["hero"],
            vec![text.chars().take(160).collect::<String>()]
        );
        let mut invalid = frozen;
        invalid.get_mut("hero").unwrap()[0].range.start = 1;
        assert!(read_frozen_evidence(root.path(), &invalid).is_err());
    }
}
