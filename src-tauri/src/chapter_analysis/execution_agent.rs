//! Chapter attribution phase checkpoints; publication remains the existing whole-chapter transaction.
use super::{
    Generation,
    agent_core::{CoreCharacter, CoreRange, Draft, ValidatedAnalysis},
    agent_runtime::{self, Persistence},
    checkpoint::{Checkpoint, Identity, WindowRecord, WindowReview},
    execution::failure,
    input, query, store,
    types::*,
    windows,
};
use crate::{
    ai::{
        RunFailure,
        dispatch::ToolDispatch,
        output::Output,
        runs::{self, Lease},
    },
    database::entity::analysis_window,
};
use rig_core::{DynModel, operation::Completion};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, Set, TransactionTrait,
};
use serde_json::json;
use std::{collections::BTreeMap, path::Path};
use tokio_util::sync::CancellationToken;

pub(super) fn implementation_hash() -> String {
    crate::project::hash(
        concat!(
            include_str!("agent_core.rs"),
            include_str!("agent_core/compact.rs"),
            include_str!("agent_core/context.rs"),
            include_str!("agent_core/dto.rs"),
            include_str!("agent_core/checkpoint.rs"),
            include_str!("agent_core/tools.rs"),
            include_str!("agent_core/error.rs"),
            include_str!("agent_core/audit.rs"),
            include_str!("agent_runtime.rs"),
            include_str!("../ai/tool_input.rs"),
            include_str!("../ai/failure.rs"),
            include_str!("../ai/agent.rs"),
            include_str!("../ai/dispatch.rs"),
            include_str!("execution_agent.rs"),
            include_str!("windows.rs"),
            include_str!("checkpoint.rs")
        )
        .as_bytes(),
    )
}
fn roles(input: &input::Input, local: &BTreeMap<String, Character>) -> Vec<CoreCharacter> {
    input
        .characters
        .iter()
        .chain(local.values())
        .map(|c| CoreCharacter {
            id: c.id.clone(),
            name: c.display_name.clone(),
            description: None,
            extra: BTreeMap::from([
                ("origin".into(), json!(c.origin)),
                ("evidence".into(), json!(c.evidence)),
            ]),
        })
        .collect()
}
fn provenance(range: ByteRange) -> Evidence {
    Evidence {
        range,
        reason: "宿主来源定位；不代表模型语义论证".into(),
    }
}
fn offset(range: CoreRange, base: u32) -> Result<ByteRange, RunFailure> {
    Ok(ByteRange {
        start: base
            .checked_add(
                range
                    .start
                    .try_into()
                    .map_err(|_| RunFailure::InvalidResponse)?,
            )
            .ok_or(RunFailure::InvalidResponse)?,
        end: base
            .checked_add(
                range
                    .end
                    .try_into()
                    .map_err(|_| RunFailure::InvalidResponse)?,
            )
            .ok_or(RunFailure::InvalidResponse)?,
    })
}
fn convert(
    analysis: &ValidatedAnalysis,
    binding: &SourceBinding,
    base: u32,
    namespace: &str,
    local: &mut BTreeMap<String, Character>,
) -> Result<Vec<Segment>, RunFailure> {
    let mut map = BTreeMap::new();
    for c in &analysis.new_characters {
        c.id.strip_prefix("candidate:")
            .filter(|s| uuid::Uuid::parse_str(s).is_ok())
            .ok_or(RunFailure::InvalidResponse)?;
        // Core IDs are stable within a source/ref; application identity is scoped to
        // this analysis intent so a reanalysis cannot collide with an existing candidate.
        let digest = crate::project::hash(format!("{namespace}:{}", c.id).as_bytes());
        let id = uuid::Uuid::parse_str(&digest[..32])
            .map_err(|_| RunFailure::InvalidResponse)?
            .to_string();
        map.insert(c.id.clone(), id.clone());
        let character = Character {
            id: id.clone(),
            project_id: binding.project_id.clone(),
            display_name: c.name.clone(),
            status: CharacterStatus::Candidate,
            revision: 1,
            origin: binding.clone(),
            evidence: c
                .evidence
                .iter()
                .map(|r| offset(*r, base).map(provenance))
                .collect::<Result<_, _>>()?,
        };
        if local.insert(id, character).is_some() {
            return Err(RunFailure::InvalidResponse);
        }
    }
    let identity = |s: &String| map.get(s).unwrap_or(s).clone();
    analysis
        .segments
        .iter()
        .map(|s| {
            let kind = match s.kind.as_str() {
                "narration" => SegmentKind::Narration,
                "speech" => SegmentKind::Speech,
                "thought" => SegmentKind::Thought,
                _ => return Err(RunFailure::InvalidResponse),
            };
            let attribution = match s.speaker.as_str() {
                "narrator" => Attribution::Narrator,
                "unknown" if s.candidates.is_empty() => Attribution::Unknown,
                "unknown" => Attribution::Ambiguous {
                    character_ids: s.candidates.iter().map(identity).collect(),
                },
                _ => Attribution::Resolved {
                    character_id: identity(&s.speaker),
                },
            };
            Ok(Segment {
                id: uuid::Uuid::new_v4().to_string(),
                range: offset(
                    CoreRange {
                        start: s.start,
                        end: s.end,
                    },
                    base,
                )?,
                kind,
                attribution,
                review: ReviewStatus::Unreviewed,
                evidence: s
                    .evidence
                    .iter()
                    .map(|r| offset(*r, base).map(provenance))
                    .collect::<Result<_, _>>()?,
                reason: "章节归属建议；证据为宿主来源定位，待人工审阅".into(),
            })
        })
        .collect()
}
#[allow(clippy::too_many_arguments)]
pub(super) async fn execute(
    db: &DatabaseConnection,
    root: &Path,
    lease: &Lease,
    model: DynModel<Completion>,
    context_window: Option<u32>,
    max_output: Option<u32>,
    generation: Option<Generation>,
    token: &CancellationToken,
    input: &input::Input,
    text: &str,
) -> Result<(), RunFailure> {
    let binding = &input.dependencies.source;
    let context = json!({"characters":input.characters,"aliases":input.aliases});
    let plans = windows::plan(
        text,
        binding,
        context_window,
        max_output,
        context.to_string().len(),
    )
    .map_err(failure)?;
    let origin = input.resume_input_id.as_deref().unwrap_or(lease.run_id());
    let existing = analysis_window::Entity::find()
        .filter(analysis_window::Column::InputId.eq(origin))
        .order_by_asc(analysis_window::Column::Ordinal)
        .all(db)
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    // Old format-4 JSON rows remain intact and are never interpreted as chapter attribution.
    if existing.iter().any(|r| !r.content.validate()) {
        return Err(RunFailure::StaleProject);
    }
    // Persist all planned windows before paid work. Unstarted rows hold only plan identity.
    if !existing.is_empty() && existing.len() != plans.len() {
        return Err(RunFailure::StaleProject);
    }
    if existing.is_empty() {
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
        for (ordinal, plan) in plans.iter().enumerate() {
            analysis_window::ActiveModel {
                id: Set(format!("{origin}:{}", plan.id)),
                input_id: Set(origin.into()),
                ordinal: Set(ordinal as i32),
                content: Set(WindowRecord::planned(
                    windows::identity(plan).map_err(failure)?,
                )),
                status: Set("pending".into()),
            }
            .insert(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        }
        runs::commit(tx, lease)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
    }
    let output = Output::resume(db.clone(), lease.clone())
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    let mut local = BTreeMap::new();
    let mut segments = vec![];
    let implementation = implementation_hash();
    for plan in &plans {
        if token.is_cancelled() {
            return Err(RunFailure::Cancelled);
        }
        let source = text
            .get(plan.owned.start as usize..plan.owned.end as usize)
            .ok_or(RunFailure::InvalidResponse)?;
        let aliases = json!({"confirmedAliases":input.aliases,"readOnlyBefore":text.get(plan.context.start as usize..plan.owned.start as usize),"readOnlyAfter":text.get(plan.owned.end as usize..plan.context.end as usize)});
        let known = roles(input, &local);
        let identity = Identity {
            plan: windows::identity(plan).map_err(failure)?,
            implementation_hash: implementation.clone(),
            context_hash: crate::project::hash(
                &serde_json::to_vec(&(&known, &aliases))
                    .map_err(|_| RunFailure::InvalidResponse)?,
            ),
            configuration_hash: crate::project::hash(
                &serde_json::to_vec(&(
                    &input.configuration,
                    context_window,
                    max_output,
                    &generation,
                ))
                .map_err(|_| RunFailure::InvalidResponse)?,
            ),
        };
        let id = format!("{origin}:{}", plan.id);
        let row = analysis_window::Entity::find_by_id(&id)
            .one(db)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .ok_or(RunFailure::StorageFailed)?;
        let mut checkpoint = if let Some(c) = row.content.checkpoint.clone() {
            if c.identity != identity {
                return Err(RunFailure::StaleProject);
            }
            c
        } else {
            if row.content.plan != identity.plan {
                return Err(RunFailure::StaleProject);
            }
            let c = Checkpoint {
                identity,
                analysis: None,
                local: local.clone(),
                segments: vec![],
                review: None,
                generation: generation.clone(),
            };
            let tx = db.begin().await.map_err(|_| RunFailure::StorageFailed)?;
            runs::lock(&tx, lease, false)
                .await
                .map_err(|_| RunFailure::Cancelled)?;
            let mut row = row.into_active_model();
            let mut record = row.content.clone().unwrap();
            record.checkpoint = Some(c.clone());
            row.content = Set(record);
            row.update(&tx)
                .await
                .map_err(|_| RunFailure::StorageFailed)?;
            runs::commit(tx, lease)
                .await
                .map_err(|_| RunFailure::StorageFailed)?;
            c
        };
        let persistence = Persistence {
            db: db.clone(),
            lease: lease.clone(),
            dependencies: input.dependencies.clone(),
            window_id: id.clone(),
            output: output.clone(),
            dispatch: ToolDispatch::new(db.clone(), lease.clone()),
        };
        if let Some(analysis) = &mut checkpoint.analysis {
            // Read-only overlap is reconstructed from authoritative source; never checkpoint it.
            if let Some(saved) = analysis.aliases.as_object_mut() {
                saved.insert("readOnlyBefore".into(), aliases["readOnlyBefore"].clone());
                saved.insert("readOnlyAfter".into(), aliases["readOnlyAfter"].clone());
            }
            Draft::restore_analysis(source, analysis.clone())
                .map_err(|_| RunFailure::InvalidResponse)?;
            if analysis.aliases != aliases
                || known.iter().any(|c| !analysis.characters.contains(c))
                || analysis.characters.len() != known.len() + analysis.new_characters.len()
            {
                return Err(RunFailure::StaleProject);
            }
            // Rebuild application DTOs from the revalidated core boundary, not saved derived fields.
            checkpoint.segments = convert(analysis, binding, plan.owned.start, &id, &mut local)?;
            checkpoint.local = local.clone();
        } else {
            let draft =
                Draft::analysis(source, known, aliases).map_err(|_| RunFailure::InvalidResponse)?;
            let (result, _) = agent_runtime::run(
                model.clone(),
                draft.clone(),
                max_output,
                token,
                Some(persistence.clone()),
                "analysis",
            )
            .await;
            result?;
            let analysis = draft
                .lock()
                .map_err(|_| RunFailure::InvalidResponse)?
                .result()
                .map_err(|_| RunFailure::InvalidResponse)?;
            checkpoint.segments = convert(&analysis, binding, plan.owned.start, &id, &mut local)?;
            checkpoint.local = local.clone();
            checkpoint.analysis = Some(analysis);
            // Preserve request facts written by hooks while updating phase data.
            let mut stored = checkpoint
                .analysis
                .clone()
                .ok_or(RunFailure::InvalidResponse)?;
            if let Some(aliases) = stored.aliases.as_object_mut() {
                aliases.remove("readOnlyBefore");
                aliases.remove("readOnlyAfter");
            }
            persistence
                .save_analysis(
                    stored,
                    checkpoint.local.clone(),
                    checkpoint.segments.clone(),
                )
                .await?;
        }
        if let Some(review) = &checkpoint.review {
            Draft::validate_saved_review(
                source,
                checkpoint
                    .analysis
                    .clone()
                    .ok_or(RunFailure::InvalidResponse)?,
                &review.result,
            )
            .map_err(|_| RunFailure::InvalidResponse)?;
        }
        if checkpoint.review.is_none() {
            let draft = Draft::review(
                source,
                checkpoint
                    .analysis
                    .clone()
                    .ok_or(RunFailure::InvalidResponse)?,
            )
            .map_err(|_| RunFailure::InvalidResponse)?;
            let (result, _) = agent_runtime::run(
                model.clone(),
                draft.clone(),
                max_output,
                token,
                Some(persistence.clone()),
                "review",
            )
            .await;
            result?;
            let review = draft
                .lock()
                .map_err(|_| RunFailure::InvalidResponse)?
                .review_result()
                .ok_or(RunFailure::InvalidResponse)?;
            let review = WindowReview {
                source_offset: plan.owned.start,
                result: review,
            };
            persistence.save_review(review.clone()).await?;
            checkpoint.review = Some(review);
        }
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
        let row = analysis_window::Entity::find_by_id(&id)
            .one(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .ok_or(RunFailure::StorageFailed)?;
        let mut row = row.into_active_model();
        row.status = Set("completed".into());
        row.update(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::commit(tx, lease)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        segments.extend(checkpoint.segments);
    }
    let path = root.to_owned();
    let source = binding.clone();
    let latest = tauri::async_runtime::spawn_blocking(move || query::read_text(&path, &source))
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .map_err(failure)?;
    if latest != text {
        return Err(RunFailure::StaleProject);
    }
    super::publication::publish(
        db,
        lease,
        input,
        segments,
        local.into_values().collect(),
        text,
        &output,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn application_candidates_are_stable_on_resume_and_isolated_between_runs() {
        let source = "“好。”";
        let draft = Draft::analysis(source, vec![], json!({})).unwrap();
        let mut d = draft.lock().unwrap();
        let end = d.input()["pieceCount"].as_u64().unwrap() - 1;
        assert_eq!(d.call("finish_analysis",json!({"operationId":"finish","expectedRevision":0,"characters":[{"ref":"new:a","name":"甲","evidence":["p0"]}],"runs":[{"end":end,"kind":"s","speaker":"new:a"}]}))["ok"],true);
        let analysis = d.result().unwrap();
        let binding = SourceBinding {
            project_id: "p".into(),
            chapter_id: "c".into(),
            source_id: "s".into(),
            sha256: crate::project::hash(source.as_bytes()),
            start: 0,
            end: source.len() as u32,
        };
        let mut one = BTreeMap::new();
        let mut resumed = BTreeMap::new();
        let mut other = BTreeMap::new();
        let first = convert(&analysis, &binding, 0, "run1:w0", &mut one).unwrap();
        let second = convert(&analysis, &binding, 0, "run1:w0", &mut resumed).unwrap();
        let third = convert(&analysis, &binding, 0, "run2:w0", &mut other).unwrap();
        assert_eq!(one, resumed);
        assert_ne!(one, other);
        assert_eq!(first[0].attribution, second[0].attribution);
        assert_ne!(first[0].attribution, third[0].attribution);
        assert_eq!(first[0].range.end, source.len() as u32);
        assert!(first[0].evidence[0].reason.contains("不代表模型语义论证"));
    }
}
