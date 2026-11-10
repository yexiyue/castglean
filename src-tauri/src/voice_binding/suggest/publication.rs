//! Atomic suggestion and conversation-result publication.
use super::super::types::*;
use crate::ai::{
    RunFailure,
    messages::{MessagePart, MessageParts, ResultReference},
    output::Output,
    runs::{self, Lease, MessageState},
};
use crate::database::entity::casting_suggestion;
use sea_orm::{
    ActiveModelTrait, DatabaseConnection, DatabaseTransaction, EntityTrait, IntoActiveModel, Set,
    TransactionTrait,
};

pub(super) async fn publish(
    db: &DatabaseConnection,
    lease: &Lease,
    suggestion: &StoredCastingSuggestion,
    output: &Output,
) -> Result<(), RunFailure> {
    let run_id = lease.run_id().to_owned();
    let tx = db.begin().await.map_err(|_| RunFailure::StorageFailed)?;
    runs::lock(&tx, lease, false)
        .await
        .map_err(|_| RunFailure::Cancelled)?;
    let project_id = lease_project(&tx, &run_id).await?;
    casting_suggestion::ActiveModel {
        run_id: Set(run_id.clone()),
        project_id: Set(project_id.clone()),
        content: Set(serde_json::to_value(suggestion).map_err(|_| RunFailure::StorageFailed)?),
        created_at: Set(crate::timestamp::unix_seconds()),
    }
    .insert(&tx)
    .await
    .map_err(|_| RunFailure::StorageFailed)?;
    let message_id = match output.id().await {
        Ok(id) => id,
        Err(_) => uuid::Uuid::new_v4().to_string(),
    };
    let row = crate::database::entity::ai_message::Entity::find_by_id(&message_id)
        .one(&tx)
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    let mut parts = row.as_ref().map_or(vec![], |m| m.parts.parts().to_vec());
    parts.push(MessagePart::Result {
        reference: ResultReference {
            kind: "casting_suggestion".into(),
            id: run_id.clone(),
            summary: "选角建议已生成，等待人工逐项采用。".into(),
        },
    });
    runs::message(
        &tx,
        lease,
        &message_id,
        row.map(|r| r.version as u32),
        MessageParts::new(parts).map_err(|_| RunFailure::StorageFailed)?,
        MessageState::Complete,
    )
    .await
    .map_err(|_| RunFailure::StorageFailed)?;
    let fingerprint = crate::project::receipts::fingerprint(
        "casting_publish",
        &(
            run_id.as_str(),
            &suggestion.character_digest,
            &suggestion.catalog_digest,
        ),
    )
    .map_err(|_| RunFailure::StorageFailed)?;
    crate::project::receipts::record(
        &tx,
        &run_id,
        "casting_publish",
        &fingerprint,
        &crate::project::receipts::CommandResult {
            version: 1,
            project_id,
            revision: 1,
            result_id: Some(run_id.clone()),
        },
    )
    .await
    .map_err(|_| RunFailure::StorageFailed)?;
    terminal(tx, lease).await
}

async fn lease_project(tx: &DatabaseTransaction, run_id: &str) -> Result<String, RunFailure> {
    let row = crate::database::entity::ai_run::Entity::find_by_id(run_id)
        .one(tx)
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .ok_or(RunFailure::StorageFailed)?;
    let session = crate::database::entity::ai_session::Entity::find_by_id(&row.session_id)
        .one(tx)
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .ok_or(RunFailure::StorageFailed)?;
    Ok(session.project_id)
}

async fn terminal(tx: sea_orm::DatabaseTransaction, lease: &Lease) -> Result<(), RunFailure> {
    let row = runs::lock(&tx, lease, false)
        .await
        .map_err(|_| RunFailure::Cancelled)?;
    let mut update = row.into_active_model();
    update.status = Set("waiting_for_input".into());
    update.finished_at = Set(Some(crate::timestamp::unix_seconds()));
    update
        .update(&tx)
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    runs::bump(&tx, lease.session_id())
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    tx.commit().await.map_err(|_| RunFailure::StorageFailed)?;
    lease.notify_committed().await;
    Ok(())
}
