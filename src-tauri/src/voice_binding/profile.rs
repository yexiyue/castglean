//! Voice profiles: a per-target advice layer, persisted and human-editable.
//! Suggestions never write here directly; only explicit commands do.
use super::types::*;
use crate::{
    database::entity::character_voice_profile,
    project::receipts::{self, CommandResult},
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, QueryFilter, Set, TransactionTrait,
};
use serde::Serialize;

/// Profile row projection for reads and command snapshots.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileView {
    pub target: BindingTarget,
    pub revision: u32,
    pub text: String,
    pub provenance: Option<ProfileProvenance>,
    pub updated_at: String,
}

fn row_view(row: &character_voice_profile::Model) -> Result<ProfileView, BindingError> {
    let target = BindingTarget::from_columns(&row.target_kind, &row.character_id)
        .ok_or(BindingError::InvalidData)?;
    let stored: StoredProfile =
        serde_json::from_value(row.content.clone()).map_err(|_| BindingError::InvalidData)?;
    if stored.format_version != 1 {
        return Err(BindingError::InvalidData);
    }
    Ok(ProfileView {
        target,
        revision: row.revision as u32,
        text: stored.text,
        provenance: stored.provenance,
        updated_at: stored.updated_at,
    })
}

async fn find_row(
    db: &impl ConnectionTrait,
    project_id: &str,
    target: &BindingTarget,
) -> Result<Option<character_voice_profile::Model>, BindingError> {
    let (kind, character_id) = target.columns();
    character_voice_profile::Entity::find()
        .filter(character_voice_profile::Column::ProjectId.eq(project_id))
        .filter(character_voice_profile::Column::TargetKind.eq(kind))
        .filter(character_voice_profile::Column::CharacterId.eq(character_id))
        .one(db)
        .await
        .map_err(|_| BindingError::ReadFailed)
}

pub(crate) async fn profiles(
    db: &impl ConnectionTrait,
    project_id: &str,
) -> Result<Vec<ProfileView>, BindingError> {
    let rows = character_voice_profile::Entity::find()
        .filter(character_voice_profile::Column::ProjectId.eq(project_id))
        .all(db)
        .await
        .map_err(|_| BindingError::ReadFailed)?;
    let mut views: Vec<ProfileView> = rows.iter().map(row_view).collect::<Result<Vec<_>, _>>()?;
    views.sort_by_key(|view| view.target.storage_key());
    Ok(views)
}

/// Set a profile through an explicit command. `provenance` distinguishes human
/// edits from adopted suggestions; suggestion runs themselves never call this
/// without an explicit user command carrying the expected revisions.
#[expect(
    clippy::too_many_arguments,
    reason = "Explicit adoption contract with expected revisions"
)]
pub(crate) async fn set(
    db: &DatabaseConnection,
    project_id: &str,
    target: &BindingTarget,
    command_id: &str,
    expected_project_revision: u32,
    expected_profile_revision: u32,
    text: &str,
    provenance: ProfileProvenance,
) -> Result<CommandResult, BindingError> {
    validate_binding_target(target)?;
    validate_profile_text(text)?;
    let fingerprint = receipts::fingerprint(
        "voice_binding_profile",
        &(
            project_id,
            target.storage_key(),
            expected_project_revision,
            expected_profile_revision,
            text,
            &provenance,
        ),
    )
    .map_err(|_| BindingError::InvalidData)?;
    if let Some(result) = receipts::replay(db, command_id, "voice_binding_profile", &fingerprint)
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
    if let Some(result) = receipts::replay(&tx, command_id, "voice_binding_profile", &fingerprint)
        .await
        .map_err(|_| BindingError::Conflict)?
    {
        return Ok(result);
    }
    super::store::ensure_target(&tx, project_id, target).await?;
    let existing = find_row(&tx, project_id, target).await?;
    let profile_id = match &existing {
        None => {
            if expected_profile_revision != 0 {
                return Err(BindingError::Conflict);
            }
            uuid::Uuid::new_v4().to_string()
        }
        Some(row) => {
            if row.revision as u32 != expected_profile_revision {
                return Err(BindingError::Conflict);
            }
            row.id.clone()
        }
    };
    let revision = match &existing {
        None => 1,
        Some(row) => row
            .revision
            .checked_add(1)
            .ok_or(BindingError::InvalidData)? as u32,
    };
    let stored = StoredProfile {
        format_version: 1,
        text: text.trim().to_owned(),
        provenance: Some(provenance),
        updated_at: crate::timestamp::unix_seconds(),
    };
    let content = serde_json::to_value(&stored).map_err(|_| BindingError::InvalidData)?;
    match existing {
        Some(row) => {
            let mut update = row.into_active_model();
            update.revision = Set(revision as i32);
            update.content = Set(content);
            update
                .update(&tx)
                .await
                .map_err(|_| BindingError::WriteFailed)?;
        }
        None => {
            let (kind, character_id) = target.columns();
            character_voice_profile::ActiveModel {
                id: Set(profile_id.clone()),
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
    let result = CommandResult {
        version: 1,
        project_id: project_id.to_owned(),
        revision,
        result_id: Some(profile_id),
    };
    receipts::record(
        &tx,
        command_id,
        "voice_binding_profile",
        &fingerprint,
        &result,
    )
    .await
    .map_err(|_| BindingError::WriteFailed)?;
    tx.commit().await.map_err(|_| BindingError::WriteFailed)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture() -> (tempfile::TempDir, DatabaseConnection) {
        let (root, db, project) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        (root, db)
    }

    #[tokio::test]
    async fn profiles_reject_missing_foreign_and_candidate_characters() {
        let (_root, db) = fixture().await;
        for (id, owner, status) in [
            ("candidate", "project", "candidate"),
            ("foreign", "other", "confirmed"),
        ] {
            if owner == "other" {
                let mut project = crate::database::entity::project::Entity::find_by_id("project")
                    .one(&db)
                    .await
                    .unwrap()
                    .unwrap()
                    .into_active_model();
                project.id = Set("other".into());
                project.insert(&db).await.unwrap();
            }
            crate::database::entity::character::ActiveModel {
                id: Set(id.into()),
                project_id: Set(owner.into()),
                display_name: Set(id.into()),
                status: Set(status.into()),
                revision: Set(1),
                content: Set(serde_json::json!({})),
            }
            .insert(&db)
            .await
            .unwrap();
        }
        for id in ["missing", "foreign", "candidate"] {
            let result = set(
                &db,
                "project",
                &BindingTarget::Character {
                    character_id: id.into(),
                },
                &uuid::Uuid::new_v4().to_string(),
                1,
                0,
                "画像",
                ProfileProvenance::Human,
            )
            .await;
            assert_eq!(result.unwrap_err(), BindingError::InvalidTarget);
        }
        assert!(profiles(&db, "project").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn human_edit_is_persisted_replay_safe_and_revision_guarded() {
        let (_root, db) = fixture().await;
        let target = BindingTarget::Narrator;
        let command_id = uuid::Uuid::new_v4().to_string();
        let first = set(
            &db,
            "project",
            &target,
            &command_id,
            1,
            0,
            "  沉稳的中年男声，语速偏慢  ",
            ProfileProvenance::Human,
        )
        .await
        .unwrap();
        assert_eq!(first.revision, 1);
        let view = profiles(&db, "project")
            .await
            .unwrap()
            .into_iter()
            .find(|view| view.target == target)
            .unwrap();
        assert_eq!(view.text, "沉稳的中年男声，语速偏慢");
        assert_eq!(view.provenance, Some(ProfileProvenance::Human));
        // Replay must carry the identical request, including untrimmed text.
        let replayed = set(
            &db,
            "project",
            &target,
            &command_id,
            1,
            0,
            "  沉稳的中年男声，语速偏慢  ",
            ProfileProvenance::Human,
        )
        .await
        .unwrap();
        assert_eq!(first, replayed);
        // Stale expected revision is rejected.
        assert_eq!(
            set(
                &db,
                "project",
                &target,
                &uuid::Uuid::new_v4().to_string(),
                1,
                0,
                "新的描述",
                ProfileProvenance::Human
            )
            .await
            .unwrap_err(),
            BindingError::Conflict
        );
        // Adopting a suggestion is an explicit command with its own provenance;
        // it advances the revision like any other explicit edit.
        let adopted = set(
            &db,
            "project",
            &target,
            &uuid::Uuid::new_v4().to_string(),
            1,
            1,
            "建议的青年男声",
            ProfileProvenance::Suggestion {
                run_id: "run-1".into(),
            },
        )
        .await
        .unwrap();
        assert_eq!(adopted.revision, 2);
        let view = profiles(&db, "project")
            .await
            .unwrap()
            .into_iter()
            .find(|view| view.target == target)
            .unwrap();
        assert_eq!(
            view.provenance,
            Some(ProfileProvenance::Suggestion {
                run_id: "run-1".into()
            })
        );
    }

    #[tokio::test]
    async fn profiles_allow_clearing_and_bound_text_limits() {
        let (_root, db) = fixture().await;
        let target = BindingTarget::Narrator;
        set(
            &db,
            "project",
            &target,
            &uuid::Uuid::new_v4().to_string(),
            1,
            0,
            "有描述",
            ProfileProvenance::Human,
        )
        .await
        .unwrap();
        let cleared = set(
            &db,
            "project",
            &target,
            &uuid::Uuid::new_v4().to_string(),
            1,
            1,
            "",
            ProfileProvenance::Human,
        )
        .await
        .unwrap();
        assert_eq!(cleared.revision, 2);
        let view = profiles(&db, "project")
            .await
            .unwrap()
            .into_iter()
            .find(|view| view.target == target)
            .unwrap();
        assert_eq!(view.text, "");
        assert!(
            set(
                &db,
                "project",
                &target,
                &uuid::Uuid::new_v4().to_string(),
                1,
                2,
                &"长".repeat(PROFILE_TEXT_MAX + 1),
                ProfileProvenance::Human
            )
            .await
            .is_err()
        );
        // Empty profiles never touch bindings or characters.
        assert!(
            super::super::store::bindings(&db, "project")
                .await
                .unwrap()
                .is_empty()
        );
    }
}
