//! Casting suggestion task: freeze, agent execution and one atomic publication.
pub(crate) mod auditions;
mod draft;
mod publication;
mod query;

use publication::publish;
pub(crate) use query::{current_character_digest, suggested_entry, suggestion};

use super::{profile, store, types::*};
use crate::ai::{
    self, AiError, RunFailure,
    hook::{Hook, Policy, ToolOutcome},
    output::Output,
    runs::Lease,
};
use crate::database::entity::{casting_input, character, character_alias};
use rig_agent::agent::AgentBuilder;
use rig_core::{DynModel, completion::Usage, operation::Completion};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DatabaseTransaction, EntityTrait,
    QueryFilter, Set,
};
use std::path::Path;
use tokio_util::sync::CancellationToken;

use self::draft::{SharedDraft, preamble_with, shared};

fn map_analysis_error(error: crate::chapter_analysis::AnalysisError) -> BindingError {
    match error {
        crate::chapter_analysis::AnalysisError::NotFound => BindingError::NotFound,
        crate::chapter_analysis::AnalysisError::ReadFailed => BindingError::ReadFailed,
        _ => BindingError::InvalidData,
    }
}

/// Instructions from the triggering message are part of the frozen input:
/// trimmed, then capped at a documented product bound. The cap is intentional
/// (design D2), not a silent truncation of the frozen data itself.
const INSTRUCTION_LIMIT: usize = 4_000;

fn bounded_instructions(raw: &str) -> String {
    raw.trim().chars().take(INSTRUCTION_LIMIT).collect()
}

/// Recover the original instructions when initial approval was rejected.
pub(crate) async fn rejected_approval_instructions(
    tx: &impl sea_orm::ConnectionTrait,
    request_id: &str,
    previous_run: &str,
) -> Result<Option<String>, AiError> {
    use crate::database::entity::ai_interrupt;
    let interrupts = ai_interrupt::Entity::find()
        .filter(ai_interrupt::Column::ConsumedBy.eq(request_id))
        .all(tx)
        .await?;
    if !interrupts.iter().any(auditions::initial_approval_rejected) {
        return Ok(None);
    }
    let previous = casting_input::Entity::find_by_id(previous_run)
        .one(tx)
        .await?
        .ok_or(AiError::Conflict)?;
    previous.content["instructions"]
        .as_str()
        .map(|instructions| Some(instructions.to_owned()))
        .ok_or(AiError::StorageFailed)
}

/// Freeze the casting input of one run inside the run-creation transaction.
/// On retry the previous frozen input is authoritative and copied verbatim;
/// `instructions` (the triggering message text) only applies to a fresh freeze.
pub(crate) async fn freeze(
    tx: &DatabaseTransaction,
    project_id: &str,
    run_id: &str,
    catalog: Option<CatalogSnapshot>,
    resume: Option<&str>,
    instructions: &str,
) -> Result<(), BindingError> {
    if let Some(previous) = resume
        && let Some(row) = casting_input::Entity::find_by_id(previous)
            .one(tx)
            .await
            .map_err(|_| BindingError::ReadFailed)?
    {
        casting_input::ActiveModel {
            run_id: Set(run_id.to_owned()),
            project_id: Set(project_id.to_owned()),
            content: Set(row.content),
        }
        .insert(tx)
        .await
        .map_err(|_| BindingError::WriteFailed)?;
        return Ok(());
    }
    let catalog = catalog.ok_or(BindingError::InvalidData)?;
    let characters = character::Entity::find()
        .filter(character::Column::ProjectId.eq(project_id))
        .filter(character::Column::Status.is_in(["confirmed", "candidate"]))
        .all(tx)
        .await
        .map_err(|_| BindingError::ReadFailed)?;
    let aliases = character_alias::Entity::find()
        .filter(character_alias::Column::ProjectId.eq(project_id))
        .all(tx)
        .await
        .map_err(|_| BindingError::ReadFailed)?;
    let mut inputs = Vec::new();
    for row in &characters {
        let mut names: Vec<String> = aliases
            .iter()
            .filter(|alias| alias.character_id == row.id)
            .map(|alias| alias.name.clone())
            .collect();
        names.sort();
        inputs.push(CastingCharacterInput {
            character_id: row.id.clone(),
            display_name: row.display_name.clone(),
            aliases: names,
            revision: row.revision as u32,
            evidence: vec![],
        });
    }
    inputs.sort_by(|a, b| a.character_id.cmp(&b.character_id));
    let bindings = store::bindings(tx, project_id)
        .await?
        .into_iter()
        .filter_map(|binding| {
            binding.voice.map(|voice| BindingSnapshot {
                target_key: binding.target.storage_key(),
                voice_key: voice.key(),
            })
        })
        .collect();
    let profiles = profile::profiles(tx, project_id)
        .await?
        .into_iter()
        .filter(|profile| !profile.text.is_empty())
        .map(|profile| ProfileSnapshot {
            target_key: profile.target.storage_key(),
            text: profile.text,
        })
        .collect();
    let digest = character_digest(
        &inputs
            .iter()
            .map(|character| (character.character_id.clone(), character.revision))
            .collect::<Vec<_>>(),
    );
    let evidence_sources = crate::chapter_analysis::freeze_character_evidence(
        tx,
        project_id,
        &inputs
            .iter()
            .map(|input| input.character_id.clone())
            .collect::<Vec<_>>(),
    )
    .await
    .map_err(map_analysis_error)?;
    let input = StoredCastingInput {
        format_version: 1,
        project_id: project_id.to_owned(),
        instructions: bounded_instructions(instructions),
        characters: inputs,
        evidence_sources,
        narrator: true,
        bindings,
        profiles,
        catalog,
        character_digest: digest,
    };
    casting_input::ActiveModel {
        run_id: Set(run_id.to_owned()),
        project_id: Set(project_id.to_owned()),
        content: Set(serde_json::to_value(&input).map_err(|_| BindingError::InvalidData)?),
    }
    .insert(tx)
    .await
    .map_err(|_| BindingError::WriteFailed)?;
    Ok(())
}

#[derive(Clone)]
struct CastingPolicy {
    draft: SharedDraft,
}

impl Policy for CastingPolicy {
    fn count_request(&self) -> bool {
        // Casting charges its bounded, frozen input once at task entry.
        false
    }

    fn terminal(&self) -> bool {
        self.draft.lock().map_or(true, |draft| draft.terminal())
    }

    fn tool_name<'a>(&self, name: &'a str) -> Option<&'a str> {
        // Final suggestions are published by the domain with their result reference.
        (name == "propose_auditions").then_some(name)
    }

    async fn completion(&self, _: Usage, invalid: bool) {
        if invalid && let Ok(mut draft) = self.draft.lock() {
            draft.invalidate();
        }
    }

    async fn tool_result(&self, outcome: &ToolOutcome<'_>) -> (serde_json::Value, bool) {
        (
            outcome.value.clone(),
            outcome.failed || outcome.value["ok"] != true,
        )
    }

    async fn recorded(
        &self,
        tool: Option<&ToolOutcome<'_>>,
    ) -> Result<Option<&'static str>, RunFailure> {
        Ok(tool
            .filter(|tool| tool.value["ok"] == true && tool.value["status"] == "waiting")
            .map(|_| "casting_audition_approval"))
    }
}

pub(crate) async fn execute(
    app: Option<&tauri::AppHandle>,
    db: &DatabaseConnection,
    root: &Path,
    lease: &Lease,
    model: DynModel<Completion>,
    max_output: Option<u32>,
    token: &CancellationToken,
) -> Result<(), RunFailure> {
    let row = casting_input::Entity::find_by_id(lease.run_id())
        .one(db)
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .ok_or(RunFailure::StorageFailed)?;
    let mut input: StoredCastingInput =
        serde_json::from_value(row.content).map_err(|_| RunFailure::InvalidResponse)?;
    if input.format_version != 1 || input.project_id != row.project_id {
        return Err(RunFailure::InvalidResponse);
    }
    let source_root = root.to_owned();
    input = tauri::async_runtime::spawn_blocking(move || {
        let mut excerpts =
            crate::chapter_analysis::read_frozen_evidence(&source_root, &input.evidence_sources)
                .map_err(|_| RunFailure::StaleProject)?;
        for character in &mut input.characters {
            character.evidence = excerpts
                .remove(&character.character_id)
                .unwrap_or_default()
                .into_iter()
                .map(|excerpt| CastingEvidence {
                    kind: "segment_sample".into(),
                    excerpt,
                })
                .collect();
        }
        Ok::<_, RunFailure>(input)
    })
    .await
    .map_err(|_| RunFailure::StorageFailed)??;
    let output = Output::resume(db.clone(), lease.clone())
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    let payload_bytes = serde_json::to_vec(&input)
        .map_err(|_| RunFailure::InvalidResponse)?
        .len();
    // Single-request scope for now: an input beyond this bound fails honestly
    // instead of silently truncating characters or the catalog.
    const CASTING_INPUT_LIMIT: usize = 400_000;
    if payload_bytes > CASTING_INPUT_LIMIT {
        return Err(RunFailure::InvalidResponse);
    }
    output
        .start(
            payload_bytes
                .try_into()
                .map_err(|_| RunFailure::BudgetExhausted)?,
        )
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    let mut preamble = preamble_with(&input.instructions);
    let resume = auditions::resume(app, db, lease, &output, token).await?;
    let draft = shared(input);
    let mut payload = draft.lock().map_err(|_| RunFailure::ToolFailed)?.payload();
    let mut allow_proposal = true;
    let mut history = vec![];
    if let Some(resume) = resume {
        history = resume.history;
        match resume.outcome {
            auditions::Resume::Waiting | auditions::Resume::Published => return Ok(()),
            auditions::Resume::Approved(previews) => {
                draft
                    .lock()
                    .map_err(|_| RunFailure::ToolFailed)?
                    .set_previews(previews);
                allow_proposal = false;
                preamble.push_str("\n宿主已处理本批试听，保留同一目标的试听首选音色或设计描述，完成 finish_casting。");
            }
            auditions::Resume::Rejected(feedback) => {
                payload["auditionRejection"] = serde_json::Value::String(feedback);
            }
        }
    }
    if allow_proposal && app.is_some() {
        preamble.push_str("\n有可试听的首选或设计草稿时，先单独调用 propose_auditions 并等待审批与试听结果，再调用 finish_casting 一次提交全部建议。无需试听时直接调用 finish_casting。");
    } else if allow_proposal {
        preamble.push_str("\n调用 finish_casting 一次提交全部建议。");
    }
    let dispatch = ai::dispatch::ToolDispatch::new(db.clone(), lease.clone());
    let hook = Hook::new(
        CastingPolicy {
            draft: draft.clone(),
        },
        Some((output.clone(), dispatch.clone())),
        token.clone(),
    );
    let builder = AgentBuilder::new(model)
        .preamble(preamble)
        .add_hook(hook.clone());
    let builder = auditions::register(
        builder,
        app.filter(|_| allow_proposal),
        db,
        lease,
        &draft,
        &dispatch,
    );
    let builder =
        draft::register_tools(builder, draft.clone()).map_err(|_| RunFailure::ToolFailed)?;
    let agent = ai::agent::Subagent::new(builder, ai::agent::Role::Casting, max_output);
    let outcome = agent
        .run_with_history(payload.to_string(), history, token)
        .await;
    if let Some(error) = hook.failure() {
        return Err(error);
    }
    if crate::ai::interrupts::pending(db, lease.session_id())
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .iter()
        .any(|row| row.invocation_id.as_deref() == lease.invocation())
    {
        return if token.is_cancelled() {
            Err(RunFailure::Cancelled)
        } else {
            Ok(())
        };
    }
    let suggestion = match draft.lock() {
        Ok(guard) => match guard.result().cloned() {
            Some(suggestion) => suggestion,
            None => return outcome.and(Err(RunFailure::InvalidResponse)),
        },
        Err(_) => return Err(RunFailure::ToolFailed),
    };
    publish(db, lease, &suggestion, &output).await
}

#[cfg(test)]
mod instruction_tests {
    use super::*;

    #[test]
    fn instructions_are_trimmed_and_capped() {
        assert_eq!(bounded_instructions("  只配主角  "), "只配主角");
        assert!(bounded_instructions("").is_empty());
        let long = "长".repeat(INSTRUCTION_LIMIT + 10);
        assert_eq!(
            bounded_instructions(&long).chars().count(),
            INSTRUCTION_LIMIT
        );
    }

    #[test]
    fn pre_field_frozen_rows_fail_honestly() {
        // Rows frozen before `instructions` existed deserialize with an error
        // instead of silently running with an invented empty requirement.
        let content = serde_json::json!({
            "formatVersion": 1,
            "projectId": "project",
            "characters": [],
            "narrator": true,
            "bindings": [],
            "profiles": [],
            "catalog": {"library": [], "presets": []},
            "characterDigest": "d"
        });
        assert!(serde_json::from_value::<StoredCastingInput>(content).is_err());
    }
}
