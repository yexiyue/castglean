//! Casting approval validates the exact inputs later passed to Studio.
mod execution;
mod retention;

pub(super) use retention::mark_published;
pub(crate) use retention::recover_assets;

pub(crate) use execution::approval_for_run;
pub(super) use execution::{Resume, resume};

use super::super::{catalog::CatalogView, types::*};
use crate::engine::{InferenceDevice, ModelEntry, ResourceState, designs::DesignEngineEntry};
use crate::voices::studio::{StudioRequest, VoiceSelection, commands::validate_text};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use tauri::Manager;

const MAX_ITEMS: usize = 32;
const MAX_TEXT_CHARS: usize = 500;
const PROPOSAL_DESCRIPTION: &str = "Request approval to preview the first voice candidate or design per target. Each voiceCandidates element is an object with a nested voice copied from the catalog. Supply fallbackText keyed by target for targets without dialogue. Call this alone and wait for the decision and results before finish_casting.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Plan {
    pub character_digest: String,
    pub catalog_digest: String,
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Item {
    pub id: String,
    pub target: BindingTarget,
    pub target_name: String,
    pub source: Source,
    pub text: String,
    pub resource: ResourceState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum Source {
    Directory {
        voice: VoiceRef,
        label: String,
        backend: String,
        model: String,
        device: InferenceDevice,
    },
    Design {
        engine: String,
        description: String,
        device: InferenceDevice,
    },
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Selection {
    pub id: String,
    pub text: String,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub(super) enum InvalidPlan {
    #[error("invalid_audition_plan")]
    Plan,
    #[error("unknown_audition_item")]
    Item,
    #[error("stale_audition_plan")]
    Stale,
    #[error("audition_resource_unavailable")]
    Resource,
    #[error("invalid_audition_input")]
    Input,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Proposal {
    /// Up to 32 distinct targets. The host uses the first candidate or, when there are no candidates, the design draft.
    #[schemars(length(min = 1, max = MAX_ITEMS))]
    pub targets: Vec<super::draft::FinishTarget>,
    /// Short audition lines keyed by the exact target string. Required for an audition target without supplied dialogue evidence, including narrator.
    #[serde(default)]
    pub fallback_text: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(tag = "decision", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum Decision {
    Approve { items: Vec<Selection> },
    Reject { feedback: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum Receipt {
    Approved { attempts: Vec<Attempt> },
    Rejected { feedback: String },
}

pub(super) fn initial_approval_rejected(
    row: &crate::database::entity::ai_interrupt::Model,
) -> bool {
    row.request["reason"] == APPROVAL_REASON
        && row.request["metadata"]["retry"] != true
        && row.response.as_ref().is_some_and(|response| {
            matches!(
                serde_json::from_value::<Receipt>(response["castingReceipt"].clone()),
                Ok(Receipt::Rejected { .. })
            )
        })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Attempt {
    pub id: String,
    pub item: String,
    pub request: StudioRequest,
}

pub(super) struct Inventory<'a> {
    pub character_digest: &'a str,
    pub catalog: &'a CatalogSnapshot,
    pub models: &'a [ModelEntry],
    pub designers: &'a [DesignEngineEntry],
}

pub(super) fn interrupt(
    id: &str,
    tool_call: &str,
    plan: &Plan,
) -> Result<ag_ui::Interrupt, crate::ai::AiError> {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "reason": APPROVAL_REASON,
        "toolCallId": tool_call,
        "responseSchema": schemars::schema_for!(Decision),
        "metadata": {"castingAuditionPlan": plan},
    }))
    .map_err(|_| crate::ai::AiError::StorageFailed)
}

impl Proposal {
    pub(super) fn prepare(
        &self,
        input: &StoredCastingInput,
        suggestion: &StoredCastingSuggestion,
        inventory: &Inventory<'_>,
    ) -> Result<Plan, InvalidPlan> {
        if suggestion.targets.len() > MAX_ITEMS {
            return Err(InvalidPlan::Plan);
        }
        prepare(input, suggestion, &self.fallback_text, inventory)
    }
}

impl Plan {
    pub(super) fn authorize(
        &self,
        decision: Decision,
        current: &Inventory<'_>,
    ) -> Result<Receipt, InvalidPlan> {
        match decision {
            Decision::Approve { items } => {
                let attempts = self
                    .approved_requests(&items, current)?
                    .into_iter()
                    .map(|(item, request)| Attempt {
                        id: uuid::Uuid::new_v4().to_string(),
                        item,
                        request,
                    })
                    .collect();
                Ok(Receipt::Approved { attempts })
            }
            Decision::Reject { feedback } => {
                let feedback = feedback.trim();
                if feedback.len() > 4096 || feedback.contains('\0') {
                    return Err(InvalidPlan::Input);
                }
                Ok(Receipt::Rejected {
                    feedback: feedback.to_owned(),
                })
            }
        }
    }

    pub(super) fn approved_requests(
        &self,
        selected: &[Selection],
        current: &Inventory<'_>,
    ) -> Result<Vec<(String, StudioRequest)>, InvalidPlan> {
        if self.character_digest != current.character_digest
            || self.catalog_digest != current.catalog.digest()
        {
            return Err(InvalidPlan::Stale);
        }
        if selected.is_empty() || selected.len() > self.items.len() {
            return Err(InvalidPlan::Plan);
        }
        let mut seen = BTreeSet::new();
        let catalog = CatalogView::from_snapshot(current.catalog);
        selected
            .iter()
            .map(|selection| {
                let item = self
                    .items
                    .iter()
                    .find(|item| item.id == selection.id && seen.insert(&item.id))
                    .ok_or(InvalidPlan::Item)?;
                let (request, resource) = item.request(selection.text.trim(), current, &catalog)?;
                if resource != ResourceState::Ready {
                    return Err(InvalidPlan::Resource);
                }
                Ok((item.id.clone(), request))
            })
            .collect()
    }
}

impl Item {
    fn request(
        &self,
        text: &str,
        inventory: &Inventory<'_>,
        catalog: &CatalogView,
    ) -> Result<(StudioRequest, ResourceState), InvalidPlan> {
        validate_text(text).map_err(|_| InvalidPlan::Input)?;
        match &self.source {
            Source::Directory {
                voice,
                backend,
                model,
                device,
                ..
            } => {
                use super::super::catalog::VoiceValidity;
                if catalog.evaluate(voice) != VoiceValidity::Valid {
                    return Err(InvalidPlan::Stale);
                }
                let entry = inventory
                    .models
                    .iter()
                    .find(|entry| entry.backend == *backend && entry.model == *model)
                    .filter(|entry| entry.available_devices.contains(device))
                    .ok_or(InvalidPlan::Resource)?;
                let voice = match voice {
                    VoiceRef::Library { id } if entry.capabilities.reference_cloning => {
                        VoiceSelection::Library { id: id.clone() }
                    }
                    VoiceRef::Preset {
                        backend: b,
                        model: m,
                        voice,
                    } if b == backend && m == model => VoiceSelection::Preset {
                        voice: voice.clone(),
                    },
                    _ => return Err(InvalidPlan::Stale),
                };
                Ok((
                    StudioRequest::Audition {
                        backend: backend.clone(),
                        model: model.clone(),
                        device: *device,
                        voice,
                        text: text.to_owned(),
                        style: None,
                    },
                    entry.resource.clone(),
                ))
            }
            Source::Design {
                engine,
                description,
                device,
            } => {
                let entry = inventory
                    .designers
                    .iter()
                    .find(|entry| entry.id == *engine && entry.devices.contains(device))
                    .ok_or(InvalidPlan::Resource)?;
                validate_design_prompt(description).map_err(|_| InvalidPlan::Input)?;
                if text.chars().count() > entry.text_max_chars as usize
                    || description.contains('\0')
                    || description.len() > entry.description_max_bytes as usize
                    || entry
                        .description_max_chars
                        .is_some_and(|max| description.chars().count() > max as usize)
                    || entry.forbid_parentheses && description.contains(['(', ')', '（', '）'])
                {
                    return Err(InvalidPlan::Input);
                }
                Ok((
                    StudioRequest::Design {
                        engine: engine.clone(),
                        description: description.clone(),
                        name: self.target_name.chars().take(64).collect(),
                        device: *device,
                        text: text.to_owned(),
                        seed: None,
                    },
                    entry.resource.clone(),
                ))
            }
        }
    }
}

fn prepare(
    input: &StoredCastingInput,
    suggestion: &StoredCastingSuggestion,
    fallback_text: &std::collections::BTreeMap<String, String>,
    inventory: &Inventory<'_>,
) -> Result<Plan, InvalidPlan> {
    if input.character_digest != inventory.character_digest
        || input.catalog.digest() != inventory.catalog.digest()
    {
        return Err(InvalidPlan::Stale);
    }
    let catalog = CatalogView::from_snapshot(inventory.catalog);
    let mut items = Vec::new();
    for entry in &suggestion.targets {
        let target = &entry.target;
        let (name, excerpt) = match target {
            BindingTarget::Narrator if input.narrator => ("旁白", None),
            BindingTarget::Character { character_id } => {
                let character = input
                    .characters
                    .iter()
                    .find(|character| &character.character_id == character_id)
                    .ok_or(InvalidPlan::Item)?;
                let excerpt = character
                    .evidence
                    .iter()
                    .map(|evidence| evidence.excerpt.trim())
                    .find(|excerpt| !excerpt.is_empty());
                (character.display_name.as_str(), excerpt)
            }
            _ => return Err(InvalidPlan::Item),
        };
        let source = if let Some(candidate) = entry.voice_candidates.first() {
            let eligible = inventory.models.iter().filter(|model| {
                !model.available_devices.is_empty()
                    && match &candidate.voice {
                        VoiceRef::Library { .. } => model.capabilities.reference_cloning,
                        VoiceRef::Preset {
                            backend,
                            model: name,
                            ..
                        } => model.backend == *backend && model.model == *name,
                    }
            });
            let model = eligible
                .min_by_key(|model| {
                    (
                        model.resource != ResourceState::Ready,
                        &model.backend,
                        &model.model,
                    )
                })
                .ok_or(InvalidPlan::Resource)?;
            Source::Directory {
                voice: candidate.voice.clone(),
                label: candidate.label.clone(),
                backend: model.backend.clone(),
                model: model.model.clone(),
                device: model.available_devices[0],
            }
        } else if let Some(design) = &entry.design {
            let selected = inventory
                .designers
                .iter()
                .filter(|entry| {
                    !entry.devices.is_empty()
                        && design
                            .engine
                            .as_ref()
                            .is_none_or(|engine| *engine == entry.id)
                })
                .min_by_key(|entry| (!entry.ready, &entry.id))
                .ok_or(InvalidPlan::Resource)?;
            Source::Design {
                engine: selected.id.clone(),
                description: design.prompt.clone(),
                device: selected.devices[0],
            }
        } else {
            continue;
        };
        let max_chars = match &source {
            Source::Directory { .. } => MAX_TEXT_CHARS,
            Source::Design { engine, .. } => inventory
                .designers
                .iter()
                .find(|entry| &entry.id == engine)
                .ok_or(InvalidPlan::Resource)?
                .text_max_chars
                .min(MAX_TEXT_CHARS as u32) as usize,
        };
        let text = match excerpt {
            Some(excerpt) => excerpt.chars().take(max_chars).collect(),
            None => fallback_text
                .get(&target.storage_key())
                .ok_or(InvalidPlan::Input)?
                .trim()
                .to_owned(),
        };
        let mut item = Item {
            id: uuid::Uuid::new_v4().to_string(),
            target: target.clone(),
            target_name: name.to_owned(),
            source,
            text,
            resource: ResourceState::Ready,
        };
        item.resource = item.request(&item.text, inventory, &catalog)?.1;
        items.push(item);
    }
    if items.is_empty() {
        return Err(InvalidPlan::Plan);
    }
    Ok(Plan {
        character_digest: input.character_digest.clone(),
        catalog_digest: input.catalog.digest(),
        items,
    })
}

#[cfg(test)]
mod tests;

pub(crate) const APPROVAL_REASON: &str = "casting_audition_approval";

fn approval_plan(request: &serde_json::Value) -> Result<Plan, crate::ai::AiError> {
    serde_json::from_value(request["metadata"]["castingAuditionPlan"].clone())
        .map_err(|_| crate::ai::AiError::StorageFailed)
}

fn approval_decision(answer: &ag_ui::ResumeEntry) -> Result<Decision, crate::ai::AiError> {
    use crate::ai::AiError;
    if answer.status != ag_ui::ResumeStatus::Resolved {
        return Err(AiError::InvalidRequest);
    }
    serde_json::from_value(answer.payload.clone().ok_or(AiError::InvalidRequest)?)
        .map_err(|_| AiError::InvalidRequest)
}

pub(crate) async fn approval_receipt(
    resources: &ApprovalInventory,
    tx: &impl sea_orm::ConnectionTrait,
    interrupt: &crate::database::entity::ai_interrupt::Model,
    answer: &ag_ui::ResumeEntry,
) -> Result<serde_json::Value, crate::ai::AiError> {
    use crate::ai::AiError;
    use sea_orm::EntityTrait;
    let plan = approval_plan(&interrupt.request)?;
    let decision = approval_decision(answer)?;
    let cast = crate::database::entity::casting_input::Entity::find_by_id(&interrupt.run_id)
        .one(tx)
        .await?
        .ok_or(AiError::Conflict)?;
    let digest = super::current_character_digest(tx, &cast.project_id)
        .await
        .map_err(|_| AiError::StorageFailed)?;
    let receipt = plan
        .authorize(
            decision,
            &Inventory {
                character_digest: &digest,
                catalog: &resources.catalog,
                models: &resources.models,
                designers: &resources.designers,
            },
        )
        .map_err(|error| match error {
            InvalidPlan::Stale => AiError::Conflict,
            InvalidPlan::Resource => AiError::ConfigurationUnavailable,
            _ => AiError::InvalidRequest,
        })?;
    serde_json::to_value(receipt).map_err(|_| AiError::StorageFailed)
}

pub(crate) struct ApprovalInventory {
    pub models: Vec<ModelEntry>,
    pub designers: Vec<DesignEngineEntry>,
    pub catalog: CatalogSnapshot,
}

pub(crate) async fn read_approval_inventory(
    app: &tauri::AppHandle,
    answers: &[ag_ui::ResumeEntry],
    pending: &[crate::database::entity::ai_interrupt::Model],
) -> Result<Option<ApprovalInventory>, crate::ai::AiError> {
    let mut sources = Vec::new();
    let mut casting = false;
    for row in pending
        .iter()
        .filter(|row| row.request["reason"] == APPROVAL_REASON)
    {
        let Some(answer) = answers.iter().find(|answer| answer.interrupt_id == row.id) else {
            continue;
        };
        casting = true;
        if let Decision::Approve { items } = approval_decision(answer)? {
            let plan = approval_plan(&row.request)?;
            sources.extend(plan.items.into_iter().filter_map(|item| {
                items
                    .iter()
                    .any(|selection| selection.id == item.id)
                    .then_some(item.source)
            }));
        }
    }
    if casting {
        Ok(Some(read_selected_inventory(app, sources.iter()).await?))
    } else {
        Ok(None)
    }
}

async fn read_selected_inventory(
    app: &tauri::AppHandle,
    sources: impl IntoIterator<Item = &Source>,
) -> Result<ApprovalInventory, crate::ai::AiError> {
    use crate::ai::AiError;
    let mut keys = BTreeSet::new();
    let mut needs_design = false;
    for source in sources {
        match source {
            Source::Directory { backend, model, .. } => {
                keys.insert((backend.clone(), model.clone()));
            }
            Source::Design { .. } => needs_design = true,
        }
    }
    let app_for_models = app.clone();
    let models = async move {
        if keys.is_empty() {
            return Ok(vec![]);
        }
        tauri::async_runtime::spawn_blocking(move || {
            let state = app_for_models.state::<crate::engine::EngineState>();
            tauri::async_runtime::block_on(crate::engine::catalog::list_matching_models(
                &state,
                |backend, model| keys.iter().any(|(b, m)| b == backend && m == model),
            ))
        })
        .await
        .map_err(|_| AiError::StorageFailed)?
        .map_err(|_| AiError::StorageFailed)
    };
    let designers = async {
        if needs_design {
            crate::engine::designs::list_design_engines(app.clone())
                .await
                .map_err(|_| AiError::StorageFailed)
        } else {
            Ok(vec![])
        }
    };
    let (models, designers, catalog) =
        tokio::join!(models, designers, super::super::catalog::read(app.clone()),);
    Ok(ApprovalInventory {
        models: models?,
        designers: designers?,
        catalog: catalog.map_err(|_| AiError::StorageFailed)?,
    })
}

pub(crate) async fn read_inventory(
    app: &tauri::AppHandle,
) -> Result<ApprovalInventory, crate::ai::AiError> {
    use crate::ai::AiError;
    let (models, designers, catalog) = tokio::join!(
        crate::engine::commands::list_models(app.clone()),
        crate::engine::designs::list_design_engines(app.clone()),
        super::super::catalog::read(app.clone()),
    );
    Ok(ApprovalInventory {
        models: models.map_err(|_| AiError::StorageFailed)?,
        designers: designers.map_err(|_| AiError::StorageFailed)?,
        catalog: catalog.map_err(|_| AiError::StorageFailed)?,
    })
}

#[derive(Clone)]
pub(super) struct ApprovalTool {
    app: Option<tauri::AppHandle>,
    db: sea_orm::DatabaseConnection,
    lease: crate::ai::runs::Lease,
    draft: super::draft::SharedDraft,
    dispatch: crate::ai::dispatch::ToolDispatch,
}

pub(super) fn register(
    builder: rig_agent::agent::AgentBuilder,
    app: Option<&tauri::AppHandle>,
    db: &sea_orm::DatabaseConnection,
    lease: &crate::ai::runs::Lease,
    draft: &super::draft::SharedDraft,
    dispatch: &crate::ai::dispatch::ToolDispatch,
) -> rig_agent::agent::AgentBuilder {
    match app {
        Some(app) => builder.tool(ApprovalTool {
            app: Some(app.clone()),
            db: db.clone(),
            lease: lease.clone(),
            draft: draft.clone(),
            dispatch: dispatch.clone(),
        }),
        None => builder,
    }
}

impl rig_core::tool::Tool for ApprovalTool {
    const NAME: &'static str = "propose_auditions";
    type Args = crate::ai::tool_input::Invocation<Proposal>;
    type Output = serde_json::Value;
    type Error = crate::ai::AiError;

    fn description(&self) -> String {
        PROPOSAL_DESCRIPTION.into()
    }

    fn parameters(&self) -> serde_json::Value {
        rig_core::tool::args_schema::<Proposal>()
    }

    async fn call(
        &self,
        _: &mut rig_core::tool::ToolContext,
        input: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        use crate::ai::AiError;
        use sea_orm::EntityTrait;
        let call = self.dispatch.accepted(Self::NAME, &input.raw).await?;
        let proposal = match input.arguments {
            Ok(proposal) => proposal,
            Err(()) => {
                let mut draft = self.draft.lock().map_err(|_| AiError::StorageFailed)?;
                return Ok(draft.reject_arguments(
                    "invalid_audition_plan",
                    &input.raw,
                    self.parameters(),
                ));
            }
        };
        use sea_orm::{ColumnTrait, QueryFilter};
        let rejected = crate::database::entity::ai_interrupt::Entity::find()
            .filter(
                crate::database::entity::ai_interrupt::Column::InvocationId
                    .eq(self.lease.invocation()),
            )
            .all(&self.db)
            .await?
            .into_iter()
            .filter(initial_approval_rejected)
            .count();
        if rejected >= super::draft::MAX_REJECTIONS as usize {
            self.draft
                .lock()
                .map_err(|_| AiError::StorageFailed)?
                .invalidate();
            return Ok(serde_json::json!({"ok": false, "error": "audition_rejection_limit"}));
        }
        let ApprovalInventory {
            models,
            designers,
            catalog,
        } = read_inventory(self.app.as_ref().ok_or(AiError::ConfigurationUnavailable)?).await?;
        let cast = crate::database::entity::casting_input::Entity::find_by_id(self.lease.run_id())
            .one(&self.db)
            .await?
            .ok_or(AiError::StorageFailed)?;
        let digest = super::current_character_digest(&self.db, &cast.project_id)
            .await
            .map_err(|_| AiError::StorageFailed)?;
        let inventory = Inventory {
            character_digest: &digest,
            catalog: &catalog,
            models: &models,
            designers: &designers,
        };
        let plan = self
            .draft
            .lock()
            .map_err(|_| AiError::StorageFailed)?
            .plan_auditions(proposal, &inventory);
        let plan = match plan {
            Ok(plan) => plan,
            Err(feedback) => return Ok(feedback),
        };
        persist_proposal(&self.db, &self.lease, &call, &plan).await
    }
}

async fn persist_proposal(
    db: &sea_orm::DatabaseConnection,
    lease: &crate::ai::runs::Lease,
    call: &crate::ai::dispatch::Call,
    plan: &Plan,
) -> Result<serde_json::Value, crate::ai::AiError> {
    use crate::ai::{AiError, interrupts, runs, tools};
    use sea_orm::TransactionTrait;
    let id = uuid::Uuid::new_v4().to_string();
    let output = serde_json::json!({"ok": true, "status": "waiting", "interruptId": id});
    let tx = db.begin().await?;
    interrupts::persist(&tx, lease, interrupt(&id, &call.id, plan)?).await?;
    if !tools::complete(
        &tx,
        lease,
        &call.message_id,
        &call.id,
        output.clone(),
        false,
        None,
    )
    .await?
    {
        return Err(AiError::Conflict);
    }
    runs::commit(tx, lease).await?;
    Ok(output)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    pub id: String,
    pub target: BindingTarget,
    pub voice: Option<VoiceRef>,
    pub design: Option<DesignDraft>,
    pub candidate: Option<crate::voices::LibraryVoice>,
    pub status: PreviewStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PreviewStatus {
    Pending,
    Running,
    Interrupted,
    Unapproved,
    Available,
    Failed,
}

fn preview(item: &Item, id: String, status: PreviewStatus) -> Preview {
    let (voice, design) = match &item.source {
        Source::Directory { voice, .. } => (Some(voice.clone()), None),
        Source::Design {
            engine,
            description,
            ..
        } => (
            None,
            Some(DesignDraft {
                engine: Some(engine.clone()),
                prompt: description.clone(),
            }),
        ),
    };
    Preview {
        id,
        target: item.target.clone(),
        voice,
        design,
        candidate: None,
        status,
    }
}

pub(crate) fn audio_path(
    app: &tauri::AppHandle,
    id: &str,
) -> Result<std::path::PathBuf, BindingError> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| BindingError::InvalidData)?;
    Ok(crate::storage::data(app)
        .join("casting-previews")
        .join(format!("{id}.wav")))
}
