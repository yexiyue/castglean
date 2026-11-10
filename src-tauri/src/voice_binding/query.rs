//! Cross-project reference projections, independent of the IPC adapter.
use super::{
    store,
    types::{BindingError, BindingTarget, VoiceRef},
};
use crate::database::entity::project;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect};
use serde::Serialize;
use std::collections::BTreeMap;

/// A cross-project reference to one voice, with the project title for display.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceReferenceView {
    pub project_id: String,
    pub project_title: String,
    pub target: BindingTarget,
}

/// Resolve all project titles in one bounded projection rather than one query
/// per target. Missing projects retain an empty title for diagnostic display.
pub(crate) async fn references_with_titles(
    db: &impl ConnectionTrait,
    voice: &VoiceRef,
) -> Result<Vec<VoiceReferenceView>, BindingError> {
    let references = store::references(db, voice).await?;
    if references.is_empty() {
        return Ok(vec![]);
    }
    let project_ids: std::collections::BTreeSet<_> = references
        .iter()
        .map(|reference| reference.project_id.clone())
        .collect();
    let titles: BTreeMap<String, String> = project::Entity::find()
        .select_only()
        .columns([project::Column::Id, project::Column::Title])
        .filter(project::Column::Id.is_in(project_ids))
        .into_tuple::<(String, String)>()
        .all(db)
        .await
        .map_err(|_| BindingError::ReadFailed)?
        .into_iter()
        .collect();
    Ok(references
        .into_iter()
        .map(|reference| VoiceReferenceView {
            project_title: titles
                .get(&reference.project_id)
                .cloned()
                .unwrap_or_default(),
            project_id: reference.project_id,
            target: reference.target,
        })
        .collect())
}
