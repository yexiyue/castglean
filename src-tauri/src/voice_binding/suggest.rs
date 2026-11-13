//! Casting suggestion task: freeze, agent execution and one atomic publication.
mod draft;
mod publication;
mod query;

use publication::publish;
pub(crate) use query::{current_character_digest, suggested_entry, suggestion};

use super::{profile, store, types::*};
use crate::ai::{self, RunFailure, output::Output, runs::Lease};
use crate::database::entity::{casting_input, character, character_alias};
use rig_agent::agent::{AgentBuilder, AgentHook, HookContext, OutcomeAction, OutcomeEvent};
use rig_core::{DynModel, operation::Completion};
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

/// Usage accounting and stop conditions for the casting agent loop. Tool facts
/// live in the suggestion record and result reference; no dispatch layer.
#[derive(Clone)]
struct Hook {
    draft: SharedDraft,
    output: Output,
    failure: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl AgentHook for Hook {
    async fn on_outcome(&self, _: &HookContext, event: OutcomeEvent<'_>) -> OutcomeAction {
        if let Some(response) = event.completion() {
            let failed = !ai::agent::valid_response(response);
            if self.output.usage(&response.usage).await.is_err() || failed {
                self.failure
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
            if failed && let Ok(mut draft) = self.draft.lock() {
                draft.invalidate();
            }
        }
        let terminal = self
            .draft
            .lock()
            .map(|draft| draft.terminal())
            .unwrap_or(true);
        if terminal {
            OutcomeAction::stop("casting_terminal")
        } else {
            OutcomeAction::proceed()
        }
    }
}

pub(crate) async fn execute(
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
    let preamble = preamble_with(&input.instructions);
    let draft = shared(input);
    let payload = draft
        .lock()
        .map_err(|_| RunFailure::ToolFailed)?
        .payload()
        .to_string();
    let hook = Hook {
        draft: draft.clone(),
        output: output.clone(),
        failure: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    };
    let builder = AgentBuilder::new(model)
        .preamble(preamble)
        .add_hook(hook.clone());
    let builder =
        draft::register_tools(builder, draft.clone()).map_err(|_| RunFailure::ToolFailed)?;
    let agent = ai::agent::Subagent::new(builder, ai::agent::Role::Casting, max_output);
    let outcome = agent.run(payload, token).await;
    if hook.failure.load(std::sync::atomic::Ordering::Relaxed) {
        return outcome.and(Err(RunFailure::InvalidResponse));
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
