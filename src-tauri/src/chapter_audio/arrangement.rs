//! Revisioned pauses anchored to immutable synthesis units, never source edits.
use super::{ChapterAudioError, store};
use crate::database::entity::{
    chapter_audio_arrangement as arrangement, chapter_audio_run as run, chapter_audio_unit as unit,
    command_receipt as receipt,
};
use sea_orm::{
    ActiveModelTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, IntoActiveModel,
    Set, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Pause {
    pub after_index: u32,
    pub duration_ms: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Arrangement {
    pub run_id: String,
    pub revision: u32,
    pub pauses: Vec<Pause>,
    pub can_undo: bool,
    pub stale: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ChapterPauseEdit {
    Set { after_index: u32, duration_ms: u32 },
    Move { after_index: u32, to_index: u32 },
    Undo,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PauseDocument {
    version: u32,
    pauses: Vec<Pause>,
}
fn encode(pauses: &[Pause]) -> Result<String, ChapterAudioError> {
    serde_json::to_string(&PauseDocument {
        version: 1,
        pauses: pauses.to_vec(),
    })
    .map_err(|_| ChapterAudioError::InvalidData)
}
fn decode(content: &str) -> Result<Vec<Pause>, ChapterAudioError> {
    let doc: PauseDocument =
        serde_json::from_str(content).map_err(|_| ChapterAudioError::InvalidData)?;
    if doc.version != 1
        || doc
            .pauses
            .iter()
            .any(|p| p.duration_ms == 0 || p.duration_ms > 10_000 || p.duration_ms % 10 != 0)
        || doc
            .pauses
            .windows(2)
            .any(|p| p[0].after_index >= p[1].after_index)
    {
        return Err(ChapterAudioError::InvalidData);
    }
    Ok(doc.pauses)
}

pub(crate) async fn read(
    db: &impl ConnectionTrait,
    row: &run::Model,
) -> Result<Arrangement, ChapterAudioError> {
    let saved = arrangement::Entity::find_by_id(&row.id)
        .one(db)
        .await
        .map_err(|_| ChapterAudioError::ReadFailed)?;
    let stale = !valid(db, row).await?;
    match saved {
        None => Ok(Arrangement {
            run_id: row.id.clone(),
            revision: 0,
            pauses: vec![],
            can_undo: false,
            stale,
        }),
        Some(saved) => {
            let pauses = decode(&saved.content)?;
            let units = store::units(db, &row.id).await?;
            if pauses.len() > units.len() || pauses.iter().any(|p| !boundary(&units, p.after_index))
            {
                return Err(ChapterAudioError::InvalidData);
            }
            Ok(Arrangement {
                run_id: row.id.clone(),
                revision: u32::try_from(saved.revision)
                    .map_err(|_| ChapterAudioError::InvalidData)?,
                pauses,
                can_undo: saved.previous_content.is_some(),
                stale,
            })
        }
    }
}

fn boundary(units: &[unit::Model], after: u32) -> bool {
    units
        .iter()
        .position(|u| u.index == after as i32 && u.status != "empty")
        .is_some_and(|i| units[i + 1..].iter().any(|u| u.status != "empty"))
}

fn apply(
    pauses: &mut Vec<Pause>,
    edit: &ChapterPauseEdit,
    units: &[unit::Model],
) -> Result<(), ChapterAudioError> {
    let invalid = ChapterAudioError::InvalidData;
    match *edit {
        ChapterPauseEdit::Set {
            after_index,
            duration_ms,
        } => {
            if !boundary(units, after_index) || duration_ms > 10_000 || duration_ms % 10 != 0 {
                return Err(invalid);
            }
            pauses.retain(|p| p.after_index != after_index);
            if duration_ms > 0 {
                pauses.push(Pause {
                    after_index,
                    duration_ms,
                });
            }
        }
        ChapterPauseEdit::Move {
            after_index,
            to_index,
        } => {
            if !boundary(units, to_index)
                || after_index == to_index
                || pauses.iter().any(|p| p.after_index == to_index)
            {
                return Err(invalid);
            }
            let pause = pauses
                .iter_mut()
                .find(|p| p.after_index == after_index)
                .ok_or(invalid)?;
            pause.after_index = to_index;
        }
        ChapterPauseEdit::Undo => return Err(invalid),
    }
    pauses.sort_by_key(|p| p.after_index);
    Ok(())
}

/// Serializes competing edits before reading both revision and command receipt.
pub(crate) async fn edit(
    db: &DatabaseConnection,
    project_id: &str,
    run_id: &str,
    expected: u32,
    operation_id: &str,
    edit: ChapterPauseEdit,
) -> Result<Arrangement, ChapterAudioError> {
    if operation_id.is_empty() || operation_id.len() > 128 {
        return Err(ChapterAudioError::InvalidData);
    }
    let request = serde_json::to_string(&(project_id, run_id, expected, &edit))
        .map_err(|_| ChapterAudioError::InvalidData)?;
    let request = crate::project::hash(request.as_bytes());
    let tx = db
        .begin()
        .await
        .map_err(|_| ChapterAudioError::WriteFailed)?;
    tx.execute_raw(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE chapter_audio_runs SET id = id WHERE id = ?",
        [run_id.into()],
    ))
    .await
    .map_err(|_| ChapterAudioError::WriteFailed)?;
    let row = store::find(&tx, run_id).await?;
    if row.project_id != project_id {
        return Err(ChapterAudioError::NotFound);
    }
    if let Some(saved) = receipt::Entity::find_by_id(operation_id)
        .one(&tx)
        .await
        .map_err(|_| ChapterAudioError::ReadFailed)?
    {
        if saved.operation != "chapter_audio_edit" || saved.request_hash != request {
            return Err(ChapterAudioError::Conflict);
        }
        return serde_json::from_value(saved.result).map_err(|_| ChapterAudioError::InvalidData);
    }
    if !valid(&tx, &row).await? {
        return Err(ChapterAudioError::Conflict);
    }
    let mut current = read(&tx, &row).await?;
    if current.revision != expected {
        return Err(ChapterAudioError::Conflict);
    }
    let previous = encode(&current.pauses)?;
    let stored = arrangement::Entity::find_by_id(run_id)
        .one(&tx)
        .await
        .map_err(|_| ChapterAudioError::ReadFailed)?;
    let undo = matches!(edit, ChapterPauseEdit::Undo);
    if undo {
        let before = stored
            .as_ref()
            .and_then(|s| s.previous_content.as_ref())
            .ok_or(ChapterAudioError::Conflict)?;
        current.pauses = decode(before)?;
    } else {
        apply(
            &mut current.pauses,
            &edit,
            &store::units(&tx, run_id).await?,
        )?;
    }
    current.revision = current
        .revision
        .checked_add(1)
        .ok_or(ChapterAudioError::InvalidData)?;
    current.can_undo = !undo;
    let content = encode(&current.pauses)?;
    let exists = stored.is_some();
    let mut model = stored
        .map(IntoActiveModel::into_active_model)
        .unwrap_or_default();
    model.id = Set(run_id.to_owned());
    model.revision = Set(current.revision as i32);
    model.content = Set(content);
    model.previous_content = Set((!undo).then_some(previous));
    if exists {
        model.update(&tx).await
    } else {
        model.insert(&tx).await
    }
    .map_err(|_| ChapterAudioError::WriteFailed)?;
    receipt::ActiveModel {
        id: Set(operation_id.to_owned()),
        project_id: Set(project_id.to_owned()),
        operation: Set("chapter_audio_edit".into()),
        request_hash: Set(request),
        result: Set(serde_json::to_value(&current).map_err(|_| ChapterAudioError::InvalidData)?),
    }
    .insert(&tx)
    .await
    .map_err(|_| ChapterAudioError::WriteFailed)?;
    tx.commit()
        .await
        .map_err(|_| ChapterAudioError::WriteFailed)?;
    Ok(current)
}

/// A run is its immutable plan identity; never reattach edits across runs.
pub(crate) async fn valid(
    db: &impl ConnectionTrait,
    row: &run::Model,
) -> Result<bool, ChapterAudioError> {
    let binding =
        crate::chapter_analysis::analysis_binding(db, &row.project_id, &row.chapter_id).await?;
    let state =
        crate::chapter_analysis::analysis_state(db, &row.project_id, &row.chapter_id).await?;
    let units = store::units(db, &row.id).await?;
    let bindings = crate::voice_binding::project_bindings(db, &row.project_id)
        .await
        .map_err(|_| ChapterAudioError::ReadFailed)?;
    let voices_match = units.iter().filter(|u| u.status != "empty").all(|u| bindings.iter().any(|b| {
        b.target.columns() == (u.target_kind.as_str(), u.character_id.as_str()) && matches!(&b.voice,
            Some(crate::voice_binding::VoiceRef::Preset { backend, model, voice }) if backend == &row.backend && model == &row.model && voice == &u.voice)
    }));
    Ok(voices_match
        && state.is_some_and(|s| s.current_version_id == row.analysis_version_id)
        && binding.sha256 == row.source_sha256
        && units
            .first()
            .is_some_and(|u| u.range_start as u32 == binding.start)
        && units
            .last()
            .is_some_and(|u| u.range_end as u32 == binding.end))
}
