//! Reclaim preview files before the worker and WebView start.
use super::*;

/// Runs before the worker and WebView can acquire a preview reference.
pub(crate) async fn recover_assets(
    app: &tauri::AppHandle,
    db: &sea_orm::DatabaseConnection,
) -> Result<(), crate::ai::AiError> {
    use crate::{
        ai::AiError,
        database::entity::{ai_interrupt, casting_suggestion},
    };
    use sea_orm::{EntityTrait, QueryOrder};
    let mut live = BTreeSet::new();
    let mut projects = BTreeSet::new();
    for row in casting_suggestion::Entity::find()
        .order_by_desc(casting_suggestion::Column::CreatedAt)
        .order_by_desc(casting_suggestion::Column::RunId)
        .all(db)
        .await?
    {
        if projects.insert(row.project_id) {
            let suggestion: StoredCastingSuggestion =
                serde_json::from_value(row.content).map_err(|_| AiError::StorageFailed)?;
            live.extend(suggestion.previews.into_iter().map(|preview| preview.id));
        }
    }
    // Unpublished plans remain recoverable after an interrupted run.
    for row in ai_interrupt::Entity::find().all(db).await? {
        let Some(response) = row.response else {
            continue;
        };
        if row.request["reason"] != APPROVAL_REASON
            || response["castingPublished"].is_string()
            || response["castingPreviews"].is_null()
        {
            continue;
        }
        let previews: Vec<Preview> = serde_json::from_value(response["castingPreviews"].clone())
            .map_err(|_| AiError::StorageFailed)?;
        live.extend(
            previews
                .into_iter()
                .filter(|preview| preview.status == PreviewStatus::Available)
                .map(|preview| preview.id),
        );
    }
    let path = crate::storage::data(app).join("casting-previews");
    tauri::async_runtime::spawn_blocking(move || reap(&path, &live))
        .await
        .map_err(|_| AiError::StorageFailed)?
        .map_err(|_| AiError::StorageFailed)
}

fn reap(path: &std::path::Path, live: &BTreeSet<String>) -> std::io::Result<()> {
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".wav")) else {
            continue;
        };
        if entry.file_type()?.is_file() && uuid::Uuid::parse_str(id).is_ok() && !live.contains(id) {
            std::fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

pub(in crate::voice_binding::suggest) async fn mark_published(
    tx: &sea_orm::DatabaseTransaction,
    lease: &crate::ai::runs::Lease,
    previews: &[Preview],
) -> Result<(), crate::ai::RunFailure> {
    use crate::{ai::RunFailure, database::entity::ai_interrupt};
    use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
    if previews.is_empty() {
        return Ok(());
    }
    let rows = ai_interrupt::Entity::find()
        .filter(ai_interrupt::Column::SessionId.eq(lease.session_id()))
        .all(tx)
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    let mut original_run = None;
    for row in &rows {
        let Some(response) = row.response.as_ref() else {
            continue;
        };
        if response["castingPreviews"].is_null() {
            continue;
        }
        let stored: Vec<Preview> = serde_json::from_value(response["castingPreviews"].clone())
            .map_err(|_| RunFailure::StorageFailed)?;
        if stored == previews {
            original_run = Some(
                row.request["metadata"]["originalRunId"]
                    .as_str()
                    .unwrap_or(&row.run_id)
                    .to_owned(),
            );
            break;
        }
    }
    let original_run = original_run.ok_or(RunFailure::StorageFailed)?;
    for row in rows {
        let Some(mut response) = row.response else {
            continue;
        };
        if row.request["reason"] == APPROVAL_REASON
            && row.request["metadata"]["originalRunId"]
                .as_str()
                .unwrap_or(&row.run_id)
                == original_run
        {
            response["castingPublished"] = serde_json::json!(lease.run_id());
            ai_interrupt::ActiveModel {
                id: Set(row.id),
                response: Set(Some(response)),
                ..Default::default()
            }
            .update(tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        }
    }
    Ok(())
}

#[cfg(test)]
#[test]
fn reaper_preserves_live_and_unrelated_files() {
    let root = tempfile::tempdir().unwrap();
    let live = uuid::Uuid::new_v4().to_string();
    let superseded = uuid::Uuid::new_v4().to_string();
    let current = root.path().join(format!("{live}.wav"));
    let previous = root.path().join(format!("{superseded}.wav"));
    let unrelated = root.path().join("unrelated.wav");
    for path in [&current, &previous, &unrelated] {
        std::fs::write(path, b"fixture").unwrap();
    }
    reap(root.path(), &BTreeSet::from([live])).unwrap();
    assert!(current.is_file());
    assert!(unrelated.is_file());
    assert!(!previous.exists());
}
