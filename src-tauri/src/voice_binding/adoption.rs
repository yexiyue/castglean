//! Design audition adoption and its independent save and binding results.
use super::{
    catalog::{self, CatalogView},
    store,
    types::*,
};
use crate::project::receipts::CommandResult;
use sea_orm::DatabaseConnection;
use serde::Serialize;
use tauri::Manager;

pub(super) async fn read_casting_preview(
    db: &DatabaseConnection,
    project_id: &str,
    run_id: &str,
    preview_id: &str,
) -> Result<super::suggest::auditions::Preview, BindingError> {
    use crate::database::entity::casting_suggestion;
    use sea_orm::EntityTrait;
    let row = casting_suggestion::Entity::find_by_id(run_id)
        .one(db)
        .await
        .map_err(|_| BindingError::ReadFailed)?
        .filter(|row| row.project_id == project_id)
        .ok_or(BindingError::NotFound)?;
    let suggestion: StoredCastingSuggestion =
        serde_json::from_value(row.content).map_err(|_| BindingError::InvalidData)?;
    suggestion
        .previews
        .into_iter()
        .find(|preview| {
            preview.id == preview_id
                && preview.status == super::suggest::auditions::PreviewStatus::Available
        })
        .ok_or(BindingError::NotFound)
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CastingAdoption {
    pub voice_id: String,
    pub binding: Result<CommandResult, BindingError>,
}

pub(super) async fn adopt_design(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    preview_id: String,
    command_id: String,
    expected_project_revision: u32,
    expected_binding_revision: u32,
) -> Result<CastingAdoption, BindingError> {
    use sea_orm::EntityTrait;
    let db = app.state::<DatabaseConnection>();
    let preview = read_casting_preview(db.inner(), &project_id, &run_id, &preview_id).await?;
    let candidate = preview.candidate.ok_or(BindingError::InvalidData)?;
    let voices = app.state::<crate::voices::VoiceState>();
    let _guard = voices.binding_changes.lock().await;
    let target = preview.target;
    let voice = VoiceRef::Library {
        id: candidate.id.clone(),
    };
    let edit = store::BindingEdit::Bind {
        voice,
        origin: BindingOrigin::Suggestion {
            run_id: run_id.clone(),
        },
    };
    if let Some(binding) = store::replay_binding(
        db.inner(),
        &project_id,
        &target,
        &command_id,
        expected_project_revision,
        expected_binding_revision,
        &edit,
    )
    .await?
    {
        return Ok(CastingAdoption {
            voice_id: candidate.id,
            binding: Ok(binding),
        });
    }
    let catalog = catalog::read(app.clone()).await?;
    let characters = super::suggest::current_character_digest(db.inner(), &project_id).await?;
    let snapshot = super::suggest::suggestion(
        db.inner(),
        &project_id,
        None,
        &characters,
        &catalog.digest(),
    )
    .await?
    .ok_or(BindingError::NotFound)?;
    if snapshot.run_id != run_id
        || snapshot.characters_stale
        || !super::suggest::suggested_entry(&snapshot, &target)
            .is_some_and(|entry| entry.design == preview.design && entry.design.is_some())
    {
        return Err(BindingError::Conflict);
    }
    let project = crate::database::entity::project::Entity::find_by_id(&project_id)
        .one(db.inner())
        .await
        .map_err(|_| BindingError::ReadFailed)?
        .ok_or(BindingError::NotFound)?;
    let revision = store::bindings(db.inner(), &project_id)
        .await?
        .into_iter()
        .find(|row| row.target == target)
        .map_or(0, |row| row.revision);
    if project.revision as u32 != expected_project_revision || revision != expected_binding_revision
    {
        return Err(BindingError::Conflict);
    }
    let path = super::suggest::auditions::audio_path(&app, &preview_id)?;
    let voice_id = candidate.id.clone();
    let save_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::voices::studio::casting::save(&save_app, &path, &candidate)
    })
    .await
    .map_err(|_| BindingError::WriteFailed)?
    .map_err(|_| BindingError::WriteFailed)?;
    let binding = async {
        let current = catalog::read(app.clone()).await?;
        store::apply(
            db.inner(),
            &project_id,
            &target,
            &command_id,
            expected_project_revision,
            expected_binding_revision,
            &CatalogView::from_snapshot(&current),
            edit,
        )
        .await
    }
    .await;
    Ok(CastingAdoption { voice_id, binding })
}
