//! Binding persistence: explicit commands, expected revisions, receipts and audit.
use super::{
    catalog::{CatalogView, VoiceValidity},
    types::*,
};
use crate::{
    database::entity::{character, voice_binding, voice_binding_edit},
    project::receipts::{self, CommandResult},
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction,
    EntityTrait, IntoActiveModel, QueryFilter, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};

/// One explicit binding command. `origin` states how the decision was made;
/// suggestion adoption reuses the same transaction path with its run reference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) enum BindingEdit {
    Bind {
        voice: VoiceRef,
        origin: BindingOrigin,
    },
    Unbind {
        origin: BindingOrigin,
    },
}

/// Binding row projection for reads and command snapshots.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindingView {
    pub binding_id: String,
    pub target: BindingTarget,
    pub revision: u32,
    pub voice: Option<VoiceRef>,
    pub origin: Option<BindingOrigin>,
    pub updated_at: String,
}

fn row_view(row: &voice_binding::Model) -> Result<BindingView, BindingError> {
    let target = BindingTarget::from_columns(&row.target_kind, &row.character_id)
        .ok_or(BindingError::InvalidData)?;
    let stored: StoredBinding =
        serde_json::from_value(row.content.clone()).map_err(|_| BindingError::InvalidData)?;
    if stored.format_version != 1 {
        return Err(BindingError::InvalidData);
    }
    Ok(BindingView {
        binding_id: row.id.clone(),
        target,
        revision: row.revision as u32,
        voice: stored.voice,
        origin: stored.origin,
        updated_at: stored.updated_at,
    })
}

async fn find_row(
    db: &impl ConnectionTrait,
    project_id: &str,
    target: &BindingTarget,
) -> Result<Option<voice_binding::Model>, BindingError> {
    let (kind, character_id) = target.columns();
    voice_binding::Entity::find()
        .filter(voice_binding::Column::ProjectId.eq(project_id))
        .filter(voice_binding::Column::TargetKind.eq(kind))
        .filter(voice_binding::Column::CharacterId.eq(character_id))
        .one(db)
        .await
        .map_err(|_| BindingError::ReadFailed)
}

/// Confirm the target is bindable now: character targets must reference an
/// existing confirmed identity of this project; narrator always binds.
pub(super) async fn ensure_target(
    tx: &DatabaseTransaction,
    project_id: &str,
    target: &BindingTarget,
) -> Result<(), BindingError> {
    if let Some(character_id) = target.character_id() {
        let row = character::Entity::find_by_id(character_id)
            .one(tx)
            .await
            .map_err(|_| BindingError::ReadFailed)?
            .filter(|row| row.project_id == project_id)
            .ok_or(BindingError::InvalidTarget)?;
        if row.status != "confirmed" {
            return Err(BindingError::InvalidTarget);
        }
    }
    Ok(())
}

pub(crate) async fn bindings(
    db: &impl ConnectionTrait,
    project_id: &str,
) -> Result<Vec<BindingView>, BindingError> {
    let rows = voice_binding::Entity::find()
        .filter(voice_binding::Column::ProjectId.eq(project_id))
        .all(db)
        .await
        .map_err(|_| BindingError::ReadFailed)?;
    let mut views: Vec<BindingView> = rows.iter().map(row_view).collect::<Result<_, _>>()?;
    views.sort_by_key(|view| view.target.storage_key());
    Ok(views)
}

/// A project target currently bound to a given voice, across all projects.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceReference {
    pub project_id: String,
    pub target: BindingTarget,
}

/// Reverse lookup across every project: which targets reference this voice.
/// Used for reverse references in the voice detail page and delete protection.
pub(crate) async fn references(
    db: &impl ConnectionTrait,
    voice: &VoiceRef,
) -> Result<Vec<VoiceReference>, BindingError> {
    let rows = voice_binding::Entity::find()
        .all(db)
        .await
        .map_err(|_| BindingError::ReadFailed)?;
    let voice_key = voice.key();
    let mut found = Vec::new();
    for row in rows {
        let stored: StoredBinding =
            serde_json::from_value(row.content.clone()).map_err(|_| BindingError::InvalidData)?;
        if stored
            .voice
            .as_ref()
            .is_some_and(|voice| voice.key() == voice_key)
            && let Some(target) = BindingTarget::from_columns(&row.target_kind, &row.character_id)
        {
            found.push(VoiceReference {
                project_id: row.project_id,
                target,
            });
        }
    }
    found.sort_by(|a, b| {
        (&a.project_id, a.target.storage_key()).cmp(&(&b.project_id, b.target.storage_key()))
    });
    Ok(found)
}

/// Apply one binding command atomically: replay-safe, guarded by the expected
/// project revision and the binding row's own revision, with an audit trail.
#[expect(
    clippy::too_many_arguments,
    reason = "Revision-guarded binding command and authoritative catalog"
)]
pub(crate) async fn apply(
    db: &DatabaseConnection,
    project_id: &str,
    target: &BindingTarget,
    command_id: &str,
    expected_project_revision: u32,
    expected_binding_revision: u32,
    catalog: &CatalogView,
    edit: BindingEdit,
) -> Result<CommandResult, BindingError> {
    validate_binding_target(target)?;
    if let BindingEdit::Bind { voice, .. } = &edit {
        validate_voice_ref(voice)?;
    }
    let fingerprint = receipts::fingerprint(
        "voice_binding",
        &(
            project_id,
            target.storage_key(),
            expected_project_revision,
            expected_binding_revision,
            &edit,
        ),
    )
    .map_err(|_| BindingError::InvalidData)?;
    if let Some(result) = receipts::replay(db, command_id, "voice_binding", &fingerprint)
        .await
        .map_err(|_| BindingError::Conflict)?
    {
        return Ok(result);
    }
    let tx = db.begin().await.map_err(|_| BindingError::WriteFailed)?;
    let project_revision = crate::project::store::lock(&tx, project_id)
        .await
        .map_err(|_| BindingError::NotFound)?;
    if project_revision != expected_project_revision {
        return Err(BindingError::Conflict);
    }
    if let Some(result) = receipts::replay(&tx, command_id, "voice_binding", &fingerprint)
        .await
        .map_err(|_| BindingError::Conflict)?
    {
        return Ok(result);
    }
    if let BindingEdit::Bind { voice, .. } = &edit
        && catalog.evaluate(voice) != VoiceValidity::Valid
    {
        return Err(BindingError::InvalidVoiceRef);
    }
    ensure_target(&tx, project_id, target).await?;
    let row = find_row(&tx, project_id, target).await?;
    let (before, binding_id, revision) = match &row {
        None => {
            let BindingEdit::Bind { .. } = &edit else {
                return Err(BindingError::Conflict);
            };
            if expected_binding_revision != 0 {
                return Err(BindingError::Conflict);
            }
            (None, uuid::Uuid::new_v4().to_string(), 1)
        }
        Some(existing) => {
            if existing.revision as u32 != expected_binding_revision {
                return Err(BindingError::Conflict);
            }
            let before = row_view(existing)?;
            if matches!(edit, BindingEdit::Unbind { .. }) && before.voice.is_none() {
                return Err(BindingError::Conflict);
            }
            (
                before.voice.clone(),
                existing.id.clone(),
                existing
                    .revision
                    .checked_add(1)
                    .ok_or(BindingError::InvalidData)? as u32,
            )
        }
    };
    let (voice, origin) = match &edit {
        BindingEdit::Bind { voice, origin } => (Some(voice.clone()), origin.clone()),
        BindingEdit::Unbind { origin } => (None, origin.clone()),
    };
    let stored = StoredBinding {
        format_version: 1,
        voice,
        origin: Some(origin),
        updated_at: crate::timestamp::unix_seconds(),
    };
    let content = serde_json::to_value(&stored).map_err(|_| BindingError::InvalidData)?;
    match row {
        Some(existing) => {
            let mut update = existing.into_active_model();
            update.revision = Set(revision as i32);
            update.content = Set(content);
            update
                .update(&tx)
                .await
                .map_err(|_| BindingError::WriteFailed)?;
        }
        None => {
            let (kind, character_id) = target.columns();
            voice_binding::ActiveModel {
                id: Set(binding_id.clone()),
                project_id: Set(project_id.to_owned()),
                target_kind: Set(kind.to_owned()),
                character_id: Set(character_id.to_owned()),
                revision: Set(revision as i32),
                content: Set(content),
            }
            .insert(&tx)
            .await
            .map_err(|_| BindingError::WriteFailed)?;
        }
    }
    let operation = match (&before, &edit) {
        (None, BindingEdit::Bind { .. }) => "bind",
        (Some(_), BindingEdit::Bind { .. }) => "rebind",
        (Some(_), BindingEdit::Unbind { .. }) => "unbind",
        (None, BindingEdit::Unbind { .. }) => unreachable!("rejected above"),
    };
    let before_value = before
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| BindingError::InvalidData)?;
    let after_value = stored
        .voice
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| BindingError::InvalidData)?;
    voice_binding_edit::ActiveModel {
        id: Set(command_id.to_owned()),
        project_id: Set(project_id.to_owned()),
        binding_id: Set(binding_id.clone()),
        operation: Set(operation.to_owned()),
        revision: Set(revision as i32),
        before: Set(before_value),
        after: Set(after_value),
    }
    .insert(&tx)
    .await
    .map_err(|_| BindingError::WriteFailed)?;
    let result = CommandResult {
        version: 1,
        project_id: project_id.to_owned(),
        revision,
        result_id: Some(binding_id),
    };
    receipts::record(&tx, command_id, "voice_binding", &fingerprint, &result)
        .await
        .map_err(|_| BindingError::WriteFailed)?;
    tx.commit().await.map_err(|_| BindingError::WriteFailed)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::ColumnTrait;

    async fn fixture_with_character(status: &str) -> (tempfile::TempDir, DatabaseConnection) {
        let (root, db, project) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        character::Entity::insert(character::ActiveModel {
            id: Set("hero".into()),
            project_id: Set("project".into()),
            display_name: Set("主角".into()),
            status: Set(status.into()),
            revision: Set(1),
            content: Set(serde_json::json!({
                "formatVersion": 1,
                "id": "hero",
                "projectId": "project",
                "displayName": "主角",
                "status": if status == "confirmed" { "confirmed" } else { "candidate" },
                "revision": 1,
                "origin": {
                    "projectId": "project", "chapterId": "chapter", "sourceId": "source",
                    "sha256": "0".repeat(64), "start": 0, "end": 4
                },
                "evidence": []
            })),
        })
        .exec(&db)
        .await
        .unwrap();
        (root, db)
    }

    fn library_voice() -> VoiceRef {
        VoiceRef::Library {
            id: "voice-abc_1".to_owned(),
        }
    }

    fn catalog() -> CatalogView {
        CatalogView::from_parts(
            ["voice-abc_1".into()],
            [("cpu".into(), "kokoro-zh".into(), "zf_1".into())],
        )
    }

    #[tokio::test]
    async fn missing_catalog_entries_are_rejected_but_receipts_survive_catalog_changes() {
        let (_root, db) = fixture_with_character("confirmed").await;
        let target = BindingTarget::Narrator;
        let empty = CatalogView::default();
        for voice in [
            library_voice(),
            VoiceRef::Preset {
                backend: "cpu".into(),
                model: "kokoro-zh".into(),
                voice: "zf_1".into(),
            },
        ] {
            assert_eq!(
                apply(
                    &db,
                    "project",
                    &target,
                    &uuid::Uuid::new_v4().to_string(),
                    1,
                    0,
                    &empty,
                    BindingEdit::Bind {
                        voice,
                        origin: BindingOrigin::Manual
                    }
                )
                .await
                .unwrap_err(),
                BindingError::InvalidVoiceRef
            );
        }
        assert!(bindings(&db, "project").await.unwrap().is_empty());
        assert!(
            voice_binding_edit::Entity::find()
                .all(&db)
                .await
                .unwrap()
                .is_empty()
        );
        let command = uuid::Uuid::new_v4().to_string();
        let edit = BindingEdit::Bind {
            voice: library_voice(),
            origin: BindingOrigin::Manual,
        };
        let first = apply(
            &db,
            "project",
            &target,
            &command,
            1,
            0,
            &catalog(),
            edit.clone(),
        )
        .await
        .unwrap();
        let replay = apply(&db, "project", &target, &command, 1, 0, &empty, edit)
            .await
            .unwrap();
        assert_eq!(first, replay);
    }

    #[tokio::test]
    async fn bind_unbind_rebind_with_revisions_audit_and_replay() {
        let (_root, db) = fixture_with_character("confirmed").await;
        let target = BindingTarget::Character {
            character_id: "hero".into(),
        };
        let first = apply(
            &db,
            "project",
            &target,
            &uuid::Uuid::new_v4().to_string(),
            1,
            0,
            &catalog(),
            BindingEdit::Bind {
                voice: library_voice(),
                origin: BindingOrigin::Manual,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.revision, 1);
        let bound = bindings(&db, "project").await.unwrap();
        assert_eq!(bound.len(), 1);
        assert_eq!(bound[0].target, target);
        assert_eq!(bound[0].voice, Some(library_voice()));
        // Wrong expected binding revision is rejected without changes.
        let stale = apply(
            &db,
            "project",
            &target,
            &uuid::Uuid::new_v4().to_string(),
            1,
            0,
            &catalog(),
            BindingEdit::Bind {
                voice: library_voice(),
                origin: BindingOrigin::Manual,
            },
        )
        .await;
        assert_eq!(stale.unwrap_err(), BindingError::Conflict);
        // Rebind advances the revision and keeps the audit trail.
        let second = apply(
            &db,
            "project",
            &target,
            &uuid::Uuid::new_v4().to_string(),
            1,
            1,
            &catalog(),
            BindingEdit::Bind {
                voice: VoiceRef::Preset {
                    backend: "cpu".into(),
                    model: "kokoro-zh".into(),
                    voice: "zf_1".into(),
                },
                origin: BindingOrigin::Manual,
            },
        )
        .await
        .unwrap();
        assert_eq!(second.revision, 2);
        let unbind = apply(
            &db,
            "project",
            &target,
            &uuid::Uuid::new_v4().to_string(),
            1,
            2,
            &catalog(),
            BindingEdit::Unbind {
                origin: BindingOrigin::Manual,
            },
        )
        .await
        .unwrap();
        assert_eq!(unbind.revision, 3);
        let bound = bindings(&db, "project").await.unwrap();
        assert_eq!(bound[0].voice, None);
        // The row survives unbinding; another unbind is a conflict.
        assert_eq!(
            apply(
                &db,
                "project",
                &target,
                &uuid::Uuid::new_v4().to_string(),
                1,
                3,
                &catalog(),
                BindingEdit::Unbind {
                    origin: BindingOrigin::Manual
                }
            )
            .await
            .unwrap_err(),
            BindingError::Conflict
        );
        let audits = voice_binding_edit::Entity::find()
            .filter(voice_binding_edit::Column::ProjectId.eq("project"))
            .all(&db)
            .await
            .unwrap();
        let operations: Vec<&str> = audits.iter().map(|a| a.operation.as_str()).collect();
        assert_eq!(operations, vec!["bind", "rebind", "unbind"]);
        assert!(audits[0].before.is_none() && audits[1].before.is_some());
    }

    #[tokio::test]
    async fn command_replay_returns_original_receipt_once() {
        let (_root, db) = fixture_with_character("confirmed").await;
        let target = BindingTarget::Narrator;
        let command_id = uuid::Uuid::new_v4().to_string();
        let first = apply(
            &db,
            "project",
            &target,
            &command_id,
            1,
            0,
            &catalog(),
            BindingEdit::Bind {
                voice: library_voice(),
                origin: BindingOrigin::Manual,
            },
        )
        .await
        .unwrap();
        let replayed = apply(
            &db,
            "project",
            &target,
            &command_id,
            1,
            0,
            &catalog(),
            BindingEdit::Bind {
                voice: library_voice(),
                origin: BindingOrigin::Manual,
            },
        )
        .await
        .unwrap();
        assert_eq!(first, replayed);
        assert_eq!(bindings(&db, "project").await.unwrap()[0].revision, 1);
        // Same command id with different content is a conflict.
        assert_eq!(
            apply(
                &db,
                "project",
                &target,
                &command_id,
                1,
                0,
                &catalog(),
                BindingEdit::Bind {
                    voice: VoiceRef::Library {
                        id: "voice-other".into()
                    },
                    origin: BindingOrigin::Manual
                }
            )
            .await
            .unwrap_err(),
            BindingError::Conflict
        );
    }

    #[tokio::test]
    async fn project_revision_and_target_guards_reject_stale_commands() {
        let (root, db, project) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        // Stale project revision.
        assert_eq!(
            apply(
                &db,
                "project",
                &BindingTarget::Narrator,
                &uuid::Uuid::new_v4().to_string(),
                7,
                0,
                &catalog(),
                BindingEdit::Bind {
                    voice: library_voice(),
                    origin: BindingOrigin::Manual
                }
            )
            .await
            .unwrap_err(),
            BindingError::Conflict
        );
        // Candidate characters cannot bind; narrator always can.
        character::Entity::insert(character::ActiveModel {
            id: Set("cand".into()),
            project_id: Set("project".into()),
            display_name: Set("候选".into()),
            status: Set("candidate".into()),
            revision: Set(1),
            content: Set(serde_json::json!({})),
        })
        .exec(&db)
        .await
        .unwrap();
        assert_eq!(
            apply(
                &db,
                "project",
                &BindingTarget::Character {
                    character_id: "cand".into()
                },
                &uuid::Uuid::new_v4().to_string(),
                1,
                0,
                &catalog(),
                BindingEdit::Bind {
                    voice: library_voice(),
                    origin: BindingOrigin::Manual
                }
            )
            .await
            .unwrap_err(),
            BindingError::InvalidTarget
        );
        assert_eq!(
            apply(
                &db,
                "project",
                &BindingTarget::Character {
                    character_id: "missing".into()
                },
                &uuid::Uuid::new_v4().to_string(),
                1,
                0,
                &catalog(),
                BindingEdit::Bind {
                    voice: library_voice(),
                    origin: BindingOrigin::Manual
                }
            )
            .await
            .unwrap_err(),
            BindingError::InvalidTarget
        );
        apply(
            &db,
            "project",
            &BindingTarget::Narrator,
            &uuid::Uuid::new_v4().to_string(),
            1,
            0,
            &catalog(),
            BindingEdit::Bind {
                voice: library_voice(),
                origin: BindingOrigin::Manual,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn invalid_voice_refs_are_rejected_before_any_write() {
        let (root, db, project) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        assert_eq!(
            apply(
                &db,
                "project",
                &BindingTarget::Narrator,
                &uuid::Uuid::new_v4().to_string(),
                1,
                0,
                &catalog(),
                BindingEdit::Bind {
                    voice: VoiceRef::Library { id: String::new() },
                    origin: BindingOrigin::Manual
                }
            )
            .await
            .unwrap_err(),
            BindingError::InvalidVoiceRef
        );
        assert!(bindings(&db, "project").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn references_span_projects_and_match_exact_voices() {
        let (root, db, project) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        // A second project row binds the same voice through a character target.
        crate::database::entity::project::Entity::insert(
            crate::database::entity::project::ActiveModel {
                id: Set("p2".into()),
                title: Set("第二工程".into()),
                description: Set(String::new()),
                revision: Set(1),
                stage: Set("importing".into()),
                created_at: Set("1".into()),
                updated_at: Set("1".into()),
            },
        )
        .exec(&db)
        .await
        .unwrap();
        character::Entity::insert(character::ActiveModel {
            id: Set("hero2".into()),
            project_id: Set("p2".into()),
            display_name: Set("主角二".into()),
            status: Set("confirmed".into()),
            revision: Set(1),
            content: Set(serde_json::json!({})),
        })
        .exec(&db)
        .await
        .unwrap();
        let voice = library_voice();
        for (project_id, target) in [
            ("project", BindingTarget::Narrator),
            (
                "p2",
                BindingTarget::Character {
                    character_id: "hero2".into(),
                },
            ),
        ] {
            apply(
                &db,
                project_id,
                &target,
                &uuid::Uuid::new_v4().to_string(),
                1,
                0,
                &catalog(),
                BindingEdit::Bind {
                    voice: voice.clone(),
                    origin: BindingOrigin::Manual,
                },
            )
            .await
            .unwrap();
        }
        let found = references(&db, &voice).await.unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].project_id, "p2");
        assert_eq!(
            found[0].target,
            BindingTarget::Character {
                character_id: "hero2".into()
            }
        );
        assert_eq!(found[1].project_id, "project");
        assert_eq!(found[1].target, BindingTarget::Narrator);
        // A different library voice and unbound rows are not referenced.
        assert!(
            references(
                &db,
                &VoiceRef::Library {
                    id: "voice-other".into()
                }
            )
            .await
            .unwrap()
            .is_empty()
        );
        apply(
            &db,
            "project",
            &BindingTarget::Narrator,
            &uuid::Uuid::new_v4().to_string(),
            1,
            1,
            &catalog(),
            BindingEdit::Unbind {
                origin: BindingOrigin::Manual,
            },
        )
        .await
        .unwrap();
        let after_unbind = references(&db, &voice).await.unwrap();
        assert_eq!(after_unbind.len(), 1);
        assert_eq!(after_unbind[0].project_id, "p2");
    }
}
