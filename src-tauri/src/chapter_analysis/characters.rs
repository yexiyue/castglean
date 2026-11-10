//! Stable identities: names are metadata; reuse only rebinds the selected chapter.
use super::{query, store, types::*};
use crate::{
    database::entity::{analysis_edit, analysis_state, character, character_alias},
    project::receipts::{self, CommandResult},
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, QueryFilter,
    Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CharacterEdit {
    Confirm,
    Rename {
        name: String,
        expected_affected_chapters: Vec<String>,
    },
    Alias {
        name: String,
        evidence: Evidence,
        chapter_id: String,
        expected_affected_chapters: Vec<String>,
    },
    Reuse {
        chapter_id: String,
        existing_id: String,
        expected_analysis_revision: u32,
    },
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CharacterUsage {
    pub chapter_id: String,
    pub version_id: String,
    pub segment_ids: Vec<String>,
    pub ranges: Vec<ByteRange>,
}
fn references(a: &Attribution, id: &str) -> bool {
    match a {
        Attribution::Resolved { character_id } => character_id == id,
        Attribution::Ambiguous { character_ids } => character_ids.iter().any(|s| s == id),
        _ => false,
    }
}
pub(crate) async fn usage(
    db: &impl sea_orm::ConnectionTrait,
    project_id: &str,
    character_id: &str,
) -> Result<Vec<CharacterUsage>, AnalysisError> {
    let row = character::Entity::find_by_id(character_id)
        .one(db)
        .await?
        .filter(|c| c.project_id == project_id)
        .ok_or(AnalysisError::NotFound)?;
    let states = analysis_state::Entity::find()
        .filter(analysis_state::Column::ProjectId.eq(&row.project_id))
        .all(db)
        .await?;
    let mut usages = Vec::new();
    for state in states {
        let v = query::version(db, project_id, &state.current_version_id).await?;
        let segment_ids: Vec<_> = v
            .segments
            .iter()
            .filter(|s| references(&s.attribution, character_id))
            .map(|s| s.id.clone())
            .collect();
        if !segment_ids.is_empty() {
            usages.push(CharacterUsage {
                chapter_id: state.id,
                version_id: v.id,
                ranges: v
                    .segments
                    .iter()
                    .filter(|s| references(&s.attribution, character_id))
                    .map(|s| s.range.clone())
                    .collect(),
                segment_ids,
            });
        }
    }
    usages.sort_by_key(|usage| usage.chapter_id.clone());
    Ok(usages)
}

/// Narrator segment usage across current versions; narrator is a segment state,
/// not a character, so this scan lives beside character usage.
pub(crate) async fn narrator_usage(
    db: &impl sea_orm::ConnectionTrait,
    project_id: &str,
) -> Result<Vec<CharacterUsage>, AnalysisError> {
    let states = analysis_state::Entity::find()
        .filter(analysis_state::Column::ProjectId.eq(project_id))
        .all(db)
        .await?;
    let mut usages = Vec::new();
    for state in states {
        let v = query::version(db, project_id, &state.current_version_id).await?;
        let narrator: Vec<&Segment> = v
            .segments
            .iter()
            .filter(|s| s.attribution == Attribution::Narrator)
            .collect();
        if narrator.is_empty() {
            continue;
        }
        usages.push(CharacterUsage {
            chapter_id: state.id,
            version_id: v.id,
            ranges: narrator.iter().map(|s| s.range.clone()).collect(),
            segment_ids: narrator.iter().map(|s| s.id.clone()).collect(),
        });
    }
    usages.sort_by_key(|usage| usage.chapter_id.clone());
    Ok(usages)
}
fn affected_matches(actual: &[CharacterUsage], expected: &[String]) -> bool {
    let mut expected = expected.to_vec();
    expected.sort();
    expected.dedup();
    expected
        == actual
            .iter()
            .map(|u| u.chapter_id.clone())
            .collect::<Vec<_>>()
}
pub(crate) async fn edit(
    db: &DatabaseConnection,
    root: &Path,
    project_id: &str,
    character_id: &str,
    command_id: &str,
    expected_revision: u32,
    edit: CharacterEdit,
) -> Result<CommandResult, AnalysisError> {
    let fingerprint = receipts::fingerprint(
        "chapter_analysis_character",
        &(project_id, character_id, expected_revision, &edit),
    )
    .map_err(|_| AnalysisError::InvalidData)?;
    if let Some(result) =
        receipts::replay(db, command_id, "chapter_analysis_character", &fingerprint)
            .await
            .map_err(|_| AnalysisError::Conflict)?
    {
        return Ok(result);
    }
    let prepared = match &edit {
        CharacterEdit::Alias { chapter_id, .. } | CharacterEdit::Reuse { chapter_id, .. } => {
            Some(query::prepare_text(db, root, project_id, chapter_id).await?)
        }
        CharacterEdit::Confirm | CharacterEdit::Rename { .. } => None,
    };
    let tx = db.begin().await?;
    crate::project::store::lock(&tx, project_id)
        .await
        .map_err(|_| AnalysisError::NotFound)?;
    if let Some(r) = receipts::replay(&tx, command_id, "chapter_analysis_character", &fingerprint)
        .await
        .map_err(|_| AnalysisError::Conflict)?
    {
        return Ok(r);
    }
    let row = character::Entity::find_by_id(character_id)
        .one(&tx)
        .await?
        .filter(|c| c.project_id == project_id)
        .ok_or(AnalysisError::NotFound)?;
    if row.revision as u32 != expected_revision {
        return Err(AnalysisError::Conflict);
    }
    let mut c: Character =
        serde_json::from_value(row.content.clone()).map_err(|_| AnalysisError::InvalidData)?;
    let mut result_id = c.id.clone();
    let revision = match &edit {
        CharacterEdit::Confirm => {
            if c.status != CharacterStatus::Candidate {
                return Err(AnalysisError::Conflict);
            }
            c.status = CharacterStatus::Confirmed;
            c.revision = c
                .revision
                .checked_add(1)
                .ok_or(AnalysisError::CapacityExceeded)?;
            c.revision
        }
        CharacterEdit::Rename {
            name,
            expected_affected_chapters,
        } => {
            if !affected_matches(
                &usage(&tx, project_id, character_id).await?,
                expected_affected_chapters,
            ) {
                return Err(AnalysisError::Conflict);
            }
            if name.trim().is_empty() || name.chars().count() > 120 || name.contains('\0') {
                return Err(AnalysisError::InvalidData);
            }
            c.display_name = name.trim().into();
            c.revision = c
                .revision
                .checked_add(1)
                .ok_or(AnalysisError::CapacityExceeded)?;
            c.revision
        }
        CharacterEdit::Alias {
            name,
            evidence,
            chapter_id,
            expected_affected_chapters,
        } => {
            if !affected_matches(
                &usage(&tx, project_id, character_id).await?,
                expected_affected_chapters,
            ) {
                return Err(AnalysisError::Conflict);
            }
            let binding = query::binding(&tx, project_id, chapter_id).await?;
            let (source, text) = prepared.as_ref().ok_or(AnalysisError::InvalidData)?;
            if *source != binding {
                return Err(AnalysisError::SourceChanged);
            }
            if name.trim().is_empty()
                || name.chars().count() > 120
                || evidence.reason.trim().is_empty()
                || !super::validation::range_valid(text, &binding, &evidence.range)
            {
                return Err(AnalysisError::InvalidData);
            }
            character_alias::ActiveModel{id:Set(uuid::Uuid::new_v4().to_string()),project_id:Set(project_id.into()),character_id:Set(character_id.into()),name:Set(name.clone()),content:Set(serde_json::json!({"formatVersion":1,"source":binding,"evidence":evidence,"confirmed":true}))}.insert(&tx).await.map_err(|_|AnalysisError::WriteFailed)?;
            c.revision = c
                .revision
                .checked_add(1)
                .ok_or(AnalysisError::CapacityExceeded)?;
            c.revision
        }
        CharacterEdit::Reuse {
            chapter_id,
            existing_id,
            expected_analysis_revision,
        } => {
            if c.status != CharacterStatus::Candidate || existing_id == character_id {
                return Err(AnalysisError::InvalidData);
            }
            let existing = character::Entity::find_by_id(existing_id)
                .one(&tx)
                .await?
                .filter(|c| c.project_id == project_id && c.status == "confirmed")
                .ok_or(AnalysisError::InvalidData)?;
            let state = store::state(&tx, project_id, chapter_id)
                .await?
                .filter(|s| s.revision as u32 == *expected_analysis_revision)
                .ok_or(AnalysisError::Conflict)?;
            let old = query::version(&tx, project_id, &state.current_version_id).await?;
            if query::binding(&tx, project_id, chapter_id).await? != old.dependencies.source {
                return Err(AnalysisError::SourceChanged);
            }
            let (source, text) = prepared.as_ref().ok_or(AnalysisError::InvalidData)?;
            if *source != old.dependencies.source {
                return Err(AnalysisError::SourceChanged);
            }
            let mut next = old.clone();
            let mut changed = false;
            for s in &mut next.segments {
                if !references(&s.attribution, character_id) {
                    continue;
                }
                changed = true;
                match &mut s.attribution {
                    Attribution::Resolved { character_id } => *character_id = existing.id.clone(),
                    Attribution::Ambiguous { character_ids } => {
                        for id in character_ids.iter_mut() {
                            if id == character_id {
                                *id = existing.id.clone();
                            }
                        }
                        character_ids.sort();
                        character_ids.dedup();
                        if character_ids.len() == 1 {
                            s.attribution = Attribution::Resolved {
                                character_id: existing.id.clone(),
                            };
                        }
                    }
                    _ => {}
                }
                next.protections.push(Protection {
                    range: s.range.clone(),
                    fields: vec![ProtectedField::Attribution],
                });
            }
            if !changed {
                return Err(AnalysisError::InvalidData);
            }
            next.id = uuid::Uuid::new_v4().to_string();
            next.parent_id = Some(old.id.clone());
            next.run_id = None;
            next.dependencies.analysis_revision = *expected_analysis_revision;
            next.dependencies.human_revision = state.human_revision as u32;
            store::insert_version(&tx, &next, text).await?;
            let revision = store::set_current(
                &tx,
                &next,
                *expected_analysis_revision,
                true,
                Some(command_id.into()),
            )
            .await?;
            analysis_edit::ActiveModel {
                id: Set(command_id.into()),
                project_id: Set(project_id.into()),
                chapter_id: Set(chapter_id.clone()),
                before_version_id: Set(old.id),
                after_version_id: Set(next.id.clone()),
                revision: Set(revision as i32),
                operation: Set("reuse_character".into()),
            }
            .insert(&tx)
            .await
            .map_err(|_| AnalysisError::WriteFailed)?;
            result_id = next.id;
            revision
        }
    };
    if !matches!(edit, CharacterEdit::Reuse { .. }) {
        let mut update = row.into_active_model();
        update.display_name = Set(c.display_name.clone());
        update.revision = Set(c
            .revision
            .try_into()
            .map_err(|_| AnalysisError::CapacityExceeded)?);
        update.status = Set(if c.status == CharacterStatus::Confirmed {
            "confirmed"
        } else {
            "candidate"
        }
        .into());
        update.content = Set(serde_json::to_value(c).map_err(|_| AnalysisError::InvalidData)?);
        update
            .update(&tx)
            .await
            .map_err(|_| AnalysisError::WriteFailed)?;
    }
    let result = CommandResult {
        version: 1,
        project_id: project_id.into(),
        revision,
        result_id: Some(result_id),
    };
    receipts::record(
        &tx,
        command_id,
        "chapter_analysis_character",
        &fingerprint,
        &result,
    )
    .await
    .map_err(|_| AnalysisError::WriteFailed)?;
    tx.commit().await.map_err(|_| AnalysisError::WriteFailed)?;
    Ok(result)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AliasView {
    pub id: String,
    pub name: String,
    pub source: SourceBinding,
    pub evidence: Evidence,
}
pub(crate) async fn aliases(
    db: &impl sea_orm::ConnectionTrait,
    project_id: &str,
    character_id: &str,
) -> Result<Vec<AliasView>, AnalysisError> {
    character::Entity::find_by_id(character_id)
        .one(db)
        .await?
        .filter(|c| c.project_id == project_id)
        .ok_or(AnalysisError::NotFound)?;
    character_alias::Entity::find()
        .filter(character_alias::Column::ProjectId.eq(project_id))
        .filter(character_alias::Column::CharacterId.eq(character_id))
        .all(db)
        .await?
        .into_iter()
        .map(|row| {
            let stored: StoredAlias =
                serde_json::from_value(row.content).map_err(|_| AnalysisError::InvalidData)?;
            if stored.format_version != 1
                || stored.source.project_id != project_id
                || !stored.confirmed
            {
                return Err(AnalysisError::InvalidData);
            }
            Ok(AliasView {
                id: row.id,
                name: row.name,
                source: stored.source,
                evidence: stored.evidence,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::Set;

    /// Two narration segments plus one resolved speech segment in the current
    /// version: narrator usage counts exactly the narration segments.
    #[tokio::test]
    async fn narrator_usage_counts_narration_segments_of_current_versions() {
        let (root, db, project) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        let binding = query::binding(&db, "project", "chapter").await.unwrap();
        let text = query::read_text(root.path(), &binding).unwrap();
        character::Entity::insert(character::ActiveModel {
            id: Set("hero".into()),
            project_id: Set("project".into()),
            display_name: Set("主角".into()),
            status: Set("confirmed".into()),
            revision: Set(1),
            content: Set(serde_json::json!({
                "id": "hero",
                "projectId": "project",
                "displayName": "主角",
                "status": "confirmed",
                "revision": 1,
                "origin": {
                    "projectId": "project", "chapterId": "chapter", "sourceId": "source",
                    "sha256": binding.sha256, "start": binding.start, "end": binding.end
                },
                "evidence": []
            })),
        })
        .exec(&db)
        .await
        .unwrap();
        let boundary = |index| text.char_indices().nth(index).unwrap().0 as u32;
        let full = ByteRange {
            start: binding.start,
            end: binding.end,
        };
        // Three contiguous segments: narration, speech, narration.
        let (a, b) = (boundary(3), boundary(6));
        let ranges = [(full.start, a), (a, b), (b, full.end)];
        let segment = |id: &str, (start, end): (u32, u32), attribution| Segment {
            id: id.into(),
            range: ByteRange { start, end },
            kind: match &attribution {
                Attribution::Narrator => SegmentKind::Narration,
                _ => SegmentKind::Speech,
            },
            attribution,
            review: ReviewStatus::Unreviewed,
            evidence: vec![Evidence {
                range: ByteRange { start, end },
                reason: "公开合成原文".into(),
            }],
            reason: "测试片段".into(),
        };
        let version = AnalysisVersion {
            format_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            parent_id: None,
            run_id: None,
            dependencies: Dependencies {
                source: binding,
                analysis_revision: 0,
                human_revision: 0,
                characters: vec![],
                contexts: vec![],
            },
            segments: vec![
                segment("n1", ranges[0], Attribution::Narrator),
                segment(
                    "s1",
                    ranges[1],
                    Attribution::Resolved {
                        character_id: "hero".into(),
                    },
                ),
                segment("n2", ranges[2], Attribution::Narrator),
            ],
            protections: vec![],
        };
        let tx = db.begin().await.unwrap();
        store::insert_version(&tx, &version, &text).await.unwrap();
        store::set_current(&tx, &version, 0, false, None)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let usages = narrator_usage(&db, "project").await.unwrap();
        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].chapter_id, "chapter");
        assert_eq!(
            usages[0].segment_ids,
            vec!["n1".to_string(), "n2".to_string()]
        );
        // Character usage stays separate and does not include narration.
        let character_usages = usage(&db, "project", "hero").await.unwrap();
        assert_eq!(character_usages.len(), 1);
        assert_eq!(character_usages[0].segment_ids, vec!["s1".to_string()]);
    }
}
