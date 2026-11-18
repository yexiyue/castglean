//! Execute approved attempts and resume casting from durable tool facts.
use super::*;

pub(in crate::voice_binding::suggest) enum Resume {
    Rejected(String),
    Approved(Vec<Preview>),
    Waiting,
    Published,
}

pub(in crate::voice_binding::suggest) struct Continuation {
    pub outcome: Resume,
    pub history: Vec<rig_core::message::Message>,
}

async fn continuation(
    db: &sea_orm::DatabaseConnection,
    row: &crate::database::entity::ai_interrupt::Model,
    outcome: Resume,
) -> Result<Continuation, crate::ai::RunFailure> {
    use crate::{
        ai::{RunFailure, messages::MessagePart},
        database::entity::ai_message,
    };
    use rig_core::message::{
        AssistantContent, AssistantMessage, Message, ToolCall, ToolFunction, ToolName,
        ToolResultContent,
    };
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
    let original_run = row.request["metadata"]["originalRunId"]
        .as_str()
        .unwrap_or(&row.run_id);
    let id = row.request["metadata"]["originalToolCallId"]
        .as_str()
        .or_else(|| row.request["toolCallId"].as_str())
        .ok_or(RunFailure::StorageFailed)?;
    let input = ai_message::Entity::find()
        .filter(ai_message::Column::RunId.eq(original_run))
        .all(db)
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .into_iter()
        .find_map(|message| {
            message.parts.parts().iter().find_map(|part| match part {
                MessagePart::Tool {
                    id: call,
                    name,
                    input,
                    ..
                } if id == call && name == "propose_auditions" => Some(input.clone()),
                _ => None,
            })
        })
        .ok_or(RunFailure::StorageFailed)?;
    let tool = ToolName::new("propose_auditions").map_err(|_| RunFailure::StorageFailed)?;
    let call = ToolCall::from_wire(id, ToolFunction::new(tool, input));
    let result = match &outcome {
        Resume::Waiting | Resume::Published => return Err(RunFailure::StorageFailed),
        Resume::Rejected(feedback) => {
            serde_json::json!({"status": "rejected", "feedback": feedback})
        }
        Resume::Approved(items) => {
            serde_json::json!({"status": "complete", "items": items.iter().map(|preview| {
            serde_json::json!({"target": preview.target, "voice": preview.voice, "design": preview.design, "status": preview.status})
        }).collect::<Vec<_>>() })
        }
    };
    let result = call.result(vec![ToolResultContent::json(result)]);
    Ok(Continuation {
        outcome,
        history: vec![
            Message::Assistant(AssistantMessage::new(vec![AssistantContent::ToolCall(
                call,
            )])),
            Message::tool_results(vec![result]),
        ],
    })
}

pub(in crate::voice_binding::suggest) async fn resume(
    app: Option<&tauri::AppHandle>,
    db: &sea_orm::DatabaseConnection,
    lease: &crate::ai::runs::Lease,
    output: &crate::ai::output::Output,
    token: &tokio_util::sync::CancellationToken,
) -> Result<Option<Continuation>, crate::ai::RunFailure> {
    use crate::{
        ai::RunFailure,
        database::entity::{ai_interrupt, ai_run},
    };
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
    let Some(app) = app else { return Ok(None) };
    let mut origin = lease.run_id().to_owned();
    let row = loop {
        let found = ai_interrupt::Entity::find()
            .filter(ai_interrupt::Column::ConsumedBy.eq(&origin))
            .filter(ai_interrupt::Column::SessionId.eq(lease.session_id()))
            .all(db)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .into_iter()
            .find(|row| {
                row.request["reason"] == APPROVAL_REASON
                    && row
                        .response
                        .as_ref()
                        .is_some_and(|response| !response["castingReceipt"].is_null())
            });
        if let Some(row) = found {
            break row;
        }
        let Some(previous) = ai_run::Entity::find_by_id(&origin)
            .one(db)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .filter(|run| run.session_id == lease.session_id())
            .and_then(|run| run.retry_of)
        else {
            return Ok(None);
        };
        origin = previous;
    };
    let retry = origin != lease.run_id();
    let plan: Plan = serde_json::from_value(row.request["metadata"]["castingAuditionPlan"].clone())
        .map_err(|_| RunFailure::StorageFailed)?;
    let mut response = row.response.clone().ok_or(RunFailure::StorageFailed)?;
    if response["castingPublished"].is_string() {
        return Ok(Some(Continuation {
            outcome: Resume::Published,
            history: vec![],
        }));
    }
    let receipt: Receipt = serde_json::from_value(response["castingReceipt"].clone())
        .map_err(|_| RunFailure::StorageFailed)?;
    let retained: Vec<Preview> = if row.request["metadata"]["retainedPreviews"].is_array() {
        serde_json::from_value(row.request["metadata"]["retainedPreviews"].clone())
            .map_err(|_| RunFailure::StorageFailed)?
    } else {
        vec![]
    };
    let attempts = match receipt {
        Receipt::Rejected { feedback } if retained.is_empty() => {
            return continuation(db, &row, Resume::Rejected(feedback))
                .await
                .map(Some);
        }
        Receipt::Rejected { .. } => vec![],
        Receipt::Approved { attempts } => attempts,
    };
    let mut previews: Vec<Preview> = if response["castingPreviews"].is_null() {
        let mut previews = retained;
        for item in &plan.items {
            if let Some(attempt) = attempts.iter().find(|attempt| attempt.item == item.id) {
                previews.retain(|previous| previous.target != item.target);
                previews.push(preview(item, attempt.id.clone(), PreviewStatus::Pending));
            } else if !previews
                .iter()
                .any(|previous| previous.target == item.target)
            {
                previews.push(preview(item, item.id.clone(), PreviewStatus::Unapproved));
            }
        }
        previews
    } else {
        serde_json::from_value(response["castingPreviews"].clone())
            .map_err(|_| RunFailure::StorageFailed)?
    };

    if retry {
        for item in &mut previews {
            if matches!(item.status, PreviewStatus::Running | PreviewStatus::Pending) {
                item.status = PreviewStatus::Interrupted;
            }
        }
    }
    save_previews(db, lease, &row.id, &mut response, &previews).await?;

    let cast = crate::database::entity::casting_input::Entity::find_by_id(lease.run_id())
        .one(db)
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .ok_or(RunFailure::StorageFailed)?;
    for attempt in &attempts {
        if token.is_cancelled() {
            return Err(RunFailure::Cancelled);
        }
        let index = previews
            .iter()
            .position(|preview| preview.id == attempt.id)
            .ok_or(RunFailure::StorageFailed)?;
        match previews[index].status {
            PreviewStatus::Pending => {}
            PreviewStatus::Running => {
                previews[index].status = PreviewStatus::Interrupted;
                save_previews(db, lease, &row.id, &mut response, &previews).await?;
                continue;
            }
            _ => continue,
        }
        let text = match &attempt.request {
            StudioRequest::Audition { text, .. } | StudioRequest::Design { text, .. } => text,
            StudioRequest::PrepareDesign { .. } => return Err(RunFailure::InvalidResponse),
        };
        let digest = super::super::current_character_digest(db, &cast.project_id)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        let ApprovalInventory {
            models,
            designers,
            catalog,
        } = read_inventory(app)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        let valid = plan.approved_requests(
            &[Selection {
                id: attempt.item.clone(),
                text: text.clone(),
            }],
            &Inventory {
                character_digest: &digest,
                catalog: &catalog,
                models: &models,
                designers: &designers,
            },
        );
        if !valid.is_ok_and(|requests| requests[0].1 == attempt.request) {
            previews[index].status = PreviewStatus::Failed;
            save_previews(db, lease, &row.id, &mut response, &previews).await?;
            continue;
        }
        previews[index].status = PreviewStatus::Running;
        save_previews(db, lease, &row.id, &mut response, &previews).await?;
        let path = audio_path(app, &attempt.id).map_err(|_| RunFailure::StorageFailed)?;
        let preview = &mut previews[index];
        match crate::voices::studio::casting::generate(
            app,
            &attempt.id,
            attempt.request.clone(),
            &path,
            token,
        )
        .await
        {
            Ok(candidate) => {
                preview.candidate = candidate;
                preview.status = PreviewStatus::Available;
            }
            Err(_) => {
                preview.status = if token.is_cancelled() {
                    PreviewStatus::Interrupted
                } else {
                    PreviewStatus::Failed
                }
            }
        }
        save_previews(db, lease, &row.id, &mut response, &previews).await?;
    }
    let mut retry_items = Vec::new();
    for attempt in attempts {
        if !previews.iter().any(|preview| {
            preview.id == attempt.id
                && matches!(
                    preview.status,
                    PreviewStatus::Failed | PreviewStatus::Interrupted
                )
        }) {
            continue;
        }
        let mut item = plan
            .items
            .iter()
            .find(|item| item.id == attempt.item)
            .cloned()
            .ok_or(RunFailure::StorageFailed)?;
        item.text = match attempt.request {
            StudioRequest::Audition { text, .. } | StudioRequest::Design { text, .. } => text,
            StudioRequest::PrepareDesign { .. } => return Err(RunFailure::InvalidResponse),
        };
        retry_items.push(item);
    }
    if !retry_items.is_empty() {
        use crate::ai::{interrupts, runs};
        use sea_orm::TransactionTrait;
        let call = row.request["metadata"]["originalToolCallId"]
            .as_str()
            .or_else(|| row.request["toolCallId"].as_str())
            .ok_or(RunFailure::StorageFailed)?;
        let id = uuid::Uuid::new_v4().to_string();
        let retry_plan = Plan {
            items: retry_items,
            ..plan
        };
        let original_run = row.request["metadata"]["originalRunId"]
            .as_str()
            .unwrap_or(&row.run_id);
        let mut gate = serde_json::to_value(
            interrupt(&id, call, &retry_plan).map_err(|_| RunFailure::StorageFailed)?,
        )
        .map_err(|_| RunFailure::StorageFailed)?;
        if let Some(object) = gate.as_object_mut() {
            object.remove("toolCallId");
        }
        gate["metadata"]["originalToolCallId"] = serde_json::json!(call);
        gate["metadata"]["originalRunId"] = serde_json::json!(original_run);
        gate["metadata"]["retainedPreviews"] =
            serde_json::to_value(&previews).map_err(|_| RunFailure::StorageFailed)?;
        gate["metadata"]["retry"] = serde_json::json!(true);
        output
            .text("试听未完成，等待选择重试的条目。")
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        output
            .complete()
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        let tx = db.begin().await.map_err(|_| RunFailure::StorageFailed)?;
        interrupts::persist(
            &tx,
            lease,
            serde_json::from_value(gate).map_err(|_| RunFailure::StorageFailed)?,
        )
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
        runs::commit(tx, lease)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        return Ok(Some(Continuation {
            outcome: Resume::Waiting,
            history: vec![],
        }));
    }
    continuation(db, &row, Resume::Approved(previews))
        .await
        .map(Some)
}

async fn save_previews(
    db: &sea_orm::DatabaseConnection,
    lease: &crate::ai::runs::Lease,
    id: &str,
    response: &mut serde_json::Value,
    previews: &[Preview],
) -> Result<(), crate::ai::RunFailure> {
    use crate::{
        ai::{RunFailure, runs},
        database::entity::ai_interrupt,
    };
    use sea_orm::{ActiveModelTrait, ActiveValue::Set, TransactionTrait};
    response["castingPreviews"] =
        serde_json::to_value(previews).map_err(|_| RunFailure::StorageFailed)?;
    let tx = db.begin().await.map_err(|_| RunFailure::StorageFailed)?;
    runs::lock(&tx, lease, false)
        .await
        .map_err(|_| RunFailure::Cancelled)?;
    ai_interrupt::ActiveModel {
        id: Set(id.to_owned()),
        response: Set(Some(response.clone())),
        ..Default::default()
    }
    .update(&tx)
    .await
    .map_err(|_| RunFailure::StorageFailed)?;
    runs::commit(tx, lease)
        .await
        .map_err(|_| RunFailure::StorageFailed)
}
