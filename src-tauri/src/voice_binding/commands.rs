//! Thin IPC boundary: binding queries and commands, composed with the live catalog.
use super::{
    catalog::{self, CatalogView},
    query, store,
    types::*,
};
use crate::project::receipts::CommandResult;
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Manual binding command payload; suggestion adoption is a separate command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ManualBindingEdit {
    Bind { voice: VoiceRef },
    Unbind,
}

/// A binding with its live validity against the current catalog.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindingStateView {
    pub binding_id: String,
    pub target: BindingTarget,
    pub revision: u32,
    pub voice: Option<VoiceRef>,
    pub origin: Option<BindingOrigin>,
    pub updated_at: String,
    pub validity: super::catalog::VoiceValidity,
}

/// One chapter's usage of a target.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageChapterView {
    pub chapter_id: String,
    pub version_id: String,
    pub segment_ids: Vec<String>,
    pub ranges: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TargetUsageView {
    pub target: BindingTarget,
    pub chapters: Vec<UsageChapterView>,
    pub total_segments: u32,
}

fn map_usage_error(error: crate::chapter_analysis::AnalysisError) -> BindingError {
    match error {
        crate::chapter_analysis::AnalysisError::NotFound => BindingError::NotFound,
        crate::chapter_analysis::AnalysisError::ReadFailed => BindingError::ReadFailed,
        _ => BindingError::InvalidData,
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_binding_bindings(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<BindingStateView>, BindingError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    let view = CatalogView::from_snapshot(&catalog::read(app.clone()).await?);
    let bindings = store::bindings(&db, &project_id).await?;
    Ok(bindings
        .into_iter()
        .map(|binding| {
            let validity = binding
                .voice
                .as_ref()
                .map(|voice| view.evaluate(voice))
                .unwrap_or(super::catalog::VoiceValidity::Valid);
            BindingStateView {
                binding_id: binding.binding_id,
                target: binding.target,
                revision: binding.revision,
                voice: binding.voice,
                origin: binding.origin,
                updated_at: binding.updated_at,
                validity,
            }
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_binding_edit(
    app: tauri::AppHandle,
    project_id: String,
    target: BindingTarget,
    command_id: String,
    expected_project_revision: u32,
    expected_binding_revision: u32,
    edit: ManualBindingEdit,
) -> Result<CommandResult, BindingError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    let voices = app.state::<crate::voices::VoiceState>();
    let _guard = voices.binding_changes.lock().await;
    let catalog = CatalogView::from_snapshot(&catalog::read(app.clone()).await?);
    let edit = match edit {
        ManualBindingEdit::Bind { voice } => store::BindingEdit::Bind {
            voice,
            origin: BindingOrigin::Manual,
        },
        ManualBindingEdit::Unbind => store::BindingEdit::Unbind {
            origin: BindingOrigin::Manual,
        },
    };
    store::apply(
        &db,
        &project_id,
        &target,
        &command_id,
        expected_project_revision,
        expected_binding_revision,
        &catalog,
        edit,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_binding_usage(
    app: tauri::AppHandle,
    project_id: String,
    target: BindingTarget,
) -> Result<TargetUsageView, BindingError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    let usages = match &target {
        BindingTarget::Narrator => crate::chapter_analysis::narrator_usage(&db, &project_id)
            .await
            .map_err(map_usage_error)?,
        BindingTarget::Character { character_id } => {
            crate::chapter_analysis::character_usage(&db, &project_id, character_id)
                .await
                .map_err(map_usage_error)?
        }
    };
    let total_segments: u32 = usages
        .iter()
        .map(|usage| usage.segment_ids.len() as u32)
        .sum();
    Ok(TargetUsageView {
        target,
        chapters: usages
            .into_iter()
            .map(|usage| UsageChapterView {
                chapter_id: usage.chapter_id,
                version_id: usage.version_id,
                segment_ids: usage.segment_ids,
                ranges: usage
                    .ranges
                    .into_iter()
                    .map(|range| (range.start, range.end))
                    .collect(),
            })
            .collect(),
        total_segments,
    })
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_binding_references(
    app: tauri::AppHandle,
    voice: VoiceRef,
) -> Result<Vec<query::VoiceReferenceView>, BindingError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    query::references_with_titles(&db, &voice).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_binding_profiles(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<super::profile::ProfileView>, BindingError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    super::profile::profiles(&db, &project_id).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_binding_profile_set(
    app: tauri::AppHandle,
    project_id: String,
    target: BindingTarget,
    command_id: String,
    expected_project_revision: u32,
    expected_profile_revision: u32,
    text: String,
) -> Result<CommandResult, BindingError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    super::profile::set(
        &db,
        &project_id,
        &target,
        &command_id,
        expected_project_revision,
        expected_profile_revision,
        &text,
        ProfileProvenance::Human,
    )
    .await
}

/// A suggested voice candidate with its live catalog validity.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuggestedVoiceView {
    pub voice: VoiceRef,
    pub label: String,
    pub reason: String,
    pub validity: super::catalog::VoiceValidity,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuggestionTargetView {
    pub target: BindingTarget,
    pub profile: Option<String>,
    pub voice_candidates: Vec<SuggestedVoiceView>,
    pub design: Option<DesignDraft>,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuggestionView {
    pub run_id: String,
    pub created_at: String,
    pub characters_stale: bool,
    pub catalog_stale: bool,
    pub targets: Vec<SuggestionTargetView>,
    pub rejected: Vec<RejectedEntry>,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_binding_suggestion(
    app: tauri::AppHandle,
    project_id: String,
    run_id: Option<String>,
) -> Result<Option<SuggestionView>, BindingError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    let catalog = catalog::read(app.clone()).await?;
    let characters = super::suggest::current_character_digest(&db, &project_id).await?;
    let Some(snapshot) = super::suggest::suggestion(
        &db,
        &project_id,
        run_id.as_deref(),
        &characters,
        &catalog.digest(),
    )
    .await?
    else {
        return Ok(None);
    };
    let view = CatalogView::from_snapshot(&catalog);
    Ok(Some(SuggestionView {
        run_id: snapshot.run_id,
        created_at: snapshot.created_at,
        characters_stale: snapshot.characters_stale,
        catalog_stale: snapshot.catalog_stale,
        targets: snapshot
            .suggestion
            .targets
            .into_iter()
            .map(|entry| SuggestionTargetView {
                target: entry.target,
                profile: entry.profile,
                voice_candidates: entry
                    .voice_candidates
                    .into_iter()
                    .map(|candidate| SuggestedVoiceView {
                        validity: view.evaluate(&candidate.voice),
                        voice: candidate.voice,
                        label: candidate.label,
                        reason: candidate.reason,
                    })
                    .collect(),
                design: entry.design,
            })
            .collect(),
        rejected: snapshot.suggestion.rejected,
    }))
}

#[expect(
    clippy::too_many_arguments,
    reason = "IPC surface mirrors the explicit adoption contract"
)]
#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_binding_adopt_binding(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    target: BindingTarget,
    voice: VoiceRef,
    command_id: String,
    expected_project_revision: u32,
    expected_binding_revision: u32,
) -> Result<CommandResult, BindingError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    let voices = app.state::<crate::voices::VoiceState>();
    let _guard = voices.binding_changes.lock().await;
    let catalog = catalog::read(app.clone()).await?;
    let characters = super::suggest::current_character_digest(&db, &project_id).await?;
    let snapshot = super::suggest::suggestion(
        &db,
        &project_id,
        Some(&run_id),
        &characters,
        &catalog.digest(),
    )
    .await?
    .ok_or(BindingError::NotFound)?;
    let entry =
        super::suggest::suggested_entry(&snapshot, &target).ok_or(BindingError::NotFound)?;
    if !entry
        .voice_candidates
        .iter()
        .any(|candidate| candidate.voice == voice)
    {
        return Err(BindingError::InvalidData);
    }
    let run = snapshot.run_id.clone();
    store::apply(
        &db,
        &project_id,
        &target,
        &command_id,
        expected_project_revision,
        expected_binding_revision,
        &CatalogView::from_snapshot(&catalog),
        store::BindingEdit::Bind {
            voice,
            origin: BindingOrigin::Suggestion { run_id: run },
        },
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_binding_adopt_profile(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    target: BindingTarget,
    command_id: String,
    expected_project_revision: u32,
    expected_profile_revision: u32,
) -> Result<CommandResult, BindingError> {
    let db = app.state::<DatabaseConnection>().inner().clone();
    let catalog = catalog::read(app.clone()).await?;
    let characters = super::suggest::current_character_digest(&db, &project_id).await?;
    let snapshot = super::suggest::suggestion(
        &db,
        &project_id,
        Some(&run_id),
        &characters,
        &catalog.digest(),
    )
    .await?
    .ok_or(BindingError::NotFound)?;
    let entry =
        super::suggest::suggested_entry(&snapshot, &target).ok_or(BindingError::NotFound)?;
    let text = entry.profile.clone().ok_or(BindingError::InvalidData)?;
    let run = snapshot.run_id.clone();
    super::profile::set(
        &db,
        &project_id,
        &target,
        &command_id,
        expected_project_revision,
        expected_profile_revision,
        &text,
        ProfileProvenance::Suggestion { run_id: run },
    )
    .await
}
