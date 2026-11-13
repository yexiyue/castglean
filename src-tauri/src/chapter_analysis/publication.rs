//! Atomic publication of validated chapter results; no model or tool execution.
use super::{input, query, review, store, types::*};
use crate::{
    ai::{
        RunFailure,
        messages::{MessagePart, MessageParts, ResultReference},
        output::Output,
        runs::{self, Lease, MessageState},
    },
    database::entity::{ai_message, analysis_candidate, analysis_edit, character},
};
use sea_orm::{
    ActiveModelTrait, DatabaseConnection, EntityTrait, IntoActiveModel, Set, TransactionTrait,
};

use super::execution::failure;

pub(super) async fn publish(
    db: &DatabaseConnection,
    lease: &Lease,
    input: &input::Input,
    segments: Vec<Segment>,
    new_characters: Vec<Character>,
    text: &str,
    output: &Output,
) -> Result<(), RunFailure> {
    let tx = db.begin().await.map_err(|_| RunFailure::StorageFailed)?;
    runs::lock(&tx, lease, false)
        .await
        .map_err(|_| RunFailure::Cancelled)?;
    store::check_dependencies(
        &tx,
        &input.dependencies,
        input.dependencies.analysis_revision != 0,
    )
    .await
    .map_err(failure)?;
    let b = &input.dependencies.source;
    for c in new_characters {
        character::ActiveModel {
            id: Set(c.id.clone()),
            project_id: Set(c.project_id.clone()),
            display_name: Set(c.display_name.clone()),
            status: Set("candidate".into()),
            revision: Set(1),
            content: Set(serde_json::to_value(c).map_err(|_| RunFailure::StorageFailed)?),
        }
        .insert(&tx)
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    }
    let current = store::state(&tx, &b.project_id, &b.chapter_id)
        .await
        .map_err(failure)?;
    let version = AnalysisVersion {
        format_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        parent_id: current.as_ref().map(|s| s.current_version_id.clone()),
        run_id: Some(lease.run_id().into()),
        dependencies: input.dependencies.clone(),
        segments,
        protections: vec![],
    };
    store::insert_version(&tx, &version, text)
        .await
        .map_err(failure)?;
    let mut published_revision = current.as_ref().map_or(1, |s| s.revision as u32);
    let result_id = if let Some(state) = current {
        let old = query::version(&tx, &b.project_id, &state.current_version_id)
            .await
            .map_err(failure)?;
        let differences = if old.dependencies.source == version.dependencies.source {
            review::differences(&old, &version).map_err(failure)?
        } else {
            // A changed chapter range cannot be compared or merged piecewise. Keep the
            // old version intact and require explicit adoption of the whole new range.
            vec![review::Difference {
                id: format!("source:{}:{}", b.start, b.end),
                range: ByteRange {
                    start: b.start,
                    end: b.end,
                },
                current: old.segments.clone(),
                suggested: version.segments.clone(),
                conflict: true,
            }]
        };
        if old.dependencies.source == version.dependencies.source {
            let selected: Vec<_> = differences
                .iter()
                .filter(|g| !g.conflict)
                .map(|g| g.id.clone())
                .collect();
            let mut merged = review::merge(&old, &differences, &selected, &[]).map_err(failure)?;
            merged.dependencies = version.dependencies.clone();
            // The raw version owns the unique model run reference.
            merged.run_id = None;
            store::insert_version(&tx, &merged, text)
                .await
                .map_err(failure)?;
            let edit_id = uuid::Uuid::new_v4().to_string();
            published_revision = store::set_current(
                &tx,
                &merged,
                state.revision as u32,
                false,
                Some(edit_id.clone()),
            )
            .await
            .map_err(failure)?;
            analysis_edit::ActiveModel {
                id: Set(edit_id),
                project_id: Set(b.project_id.clone()),
                chapter_id: Set(b.chapter_id.clone()),
                before_version_id: Set(old.id.clone()),
                after_version_id: Set(merged.id.clone()),
                revision: Set(published_revision as i32),
                operation: Set("auto_analysis".into()),
            }
            .insert(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
            merged.id
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            analysis_candidate::ActiveModel {
                id: Set(id.clone()),
                project_id: Set(b.project_id.clone()),
                chapter_id: Set(b.chapter_id.clone()),
                version_id: Set(version.id.clone()),
                base_version_id: Set(Some(old.id)),
                base_revision: Set(state.revision),
                content: Set(
                    serde_json::to_value(differences).map_err(|_| RunFailure::StorageFailed)?
                ),
                status: Set("pending".into()),
            }
            .insert(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
            id
        }
    } else {
        store::set_current(&tx, &version, 0, false, None)
            .await
            .map_err(failure)?;
        version.id.clone()
    };
    let message_id = match output.id().await {
        Ok(id) => id,
        Err(_) => uuid::Uuid::new_v4().to_string(),
    };
    let row = ai_message::Entity::find_by_id(&message_id)
        .one(&tx)
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    let mut parts = row.as_ref().map_or(vec![], |m| m.parts.parts().to_vec());
    parts.push(MessagePart::Result {
        reference: ResultReference {
            kind: "chapter_analysis".into(),
            id: result_id.clone(),
            summary: "章节分析已保存，可直接修改归属和设置声音。".into(),
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
        "chapter_analysis_publish",
        &(lease.run_id(), &input.dependencies),
    )
    .map_err(|_| RunFailure::StorageFailed)?;
    crate::project::receipts::record(
        &tx,
        lease.run_id(),
        "chapter_analysis_publish",
        &fingerprint,
        &crate::project::receipts::CommandResult {
            version: 1,
            project_id: b.project_id.clone(),
            revision: published_revision,
            result_id: Some(result_id),
        },
    )
    .await
    .map_err(|_| RunFailure::StorageFailed)?;
    terminal(tx, lease).await
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
