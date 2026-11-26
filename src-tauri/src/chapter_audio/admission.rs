//! Choose and persist the run to dispatch after the host admits chapter synthesis.
use super::{
    plan::Plan,
    store::{self, ChapterAudioState},
    types::*,
};
use crate::database::entity::chapter_audio_run as run;
use sea_orm::DatabaseConnection;
use tauri::Manager;

/// 沿用或重录的来源必须是同一章的终态任务；不存在或不属于本章按未找到处理。
async fn chapter_source(
    db: &DatabaseConnection,
    project_id: &str,
    chapter_id: &str,
    run_id: &str,
) -> Result<run::Model, ChapterAudioError> {
    let row = store::find(db, run_id).await?;
    if row.project_id != project_id
        || row.chapter_id != chapter_id
        || ChapterAudioStatus::parse(&row.status).is_some_and(ChapterAudioStatus::active)
    {
        return Err(ChapterAudioError::NotFound);
    }
    Ok(row)
}

pub(super) async fn persist(
    app: &tauri::AppHandle,
    db: &DatabaseConnection,
    state: &ChapterAudioState,
    project_id: String,
    chapter_id: String,
    plan: Plan,
    request: ChapterAudioStart,
) -> Result<run::Model, ChapterAudioError> {
    // 派生任务在阻塞池上准备沿用副本并提交；沿用单元的文件写入不占用异步工作线程。
    let derive = |source: run::Model, scope: store::RedoScope, kind: ChapterAudioKind| {
        let (app, db, project_id, chapter_id) = (
            app.clone(),
            db.clone(),
            project_id.clone(),
            chapter_id.clone(),
        );
        let run_id = uuid::Uuid::new_v4().to_string();
        let plan = plan.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<ChapterAudioState>();
            tauri::async_runtime::block_on(store::derive(
                &db,
                &state,
                store::Derivation {
                    run_id: &run_id,
                    project_id: &project_id,
                    chapter_id: &chapter_id,
                    plan: &plan,
                    parent: &source,
                    kind,
                },
                &scope,
            ))
        })
    };
    let row = match request {
        ChapterAudioStart::Resume { run_id } => {
            let source = chapter_source(db, &project_id, &chapter_id, &run_id).await?;
            let units = store::units(db, &source.id).await?;
            if !store::resumable(&source, &plan, &units) {
                return Err(ChapterAudioError::Conflict);
            }
            store::resume(db, &source.id).await?
        }
        ChapterAudioStart::Fresh { inherit_from } => {
            let source = match inherit_from {
                Some(id) => Some(chapter_source(db, &project_id, &chapter_id, &id).await?),
                None => None,
            };
            let derived = match source {
                Some(source) if store::same_inputs(&source, &plan) => {
                    let units = store::units(db, &source.id).await?;
                    let scope = store::redo_scope(
                        &units,
                        &plan,
                        |unit: &crate::database::entity::chapter_audio_unit::Model| {
                            unit.media_id
                                .as_deref()
                                .and_then(|id| state.media_path(id))
                                .is_some()
                        },
                    );
                    // 与来源完全一致且来源已完整时没有可做的工作，不建立空任务。
                    if scope.redo_indexes.is_empty()
                        && source.status == "succeeded"
                        && store::plan_matches(&source, &plan, &units)
                        && store::complete(db, state, &source).await?
                    {
                        return Err(ChapterAudioError::Conflict);
                    }
                    Some((source, scope))
                }
                _ => None,
            };
            let row = match derived {
                Some((source, scope)) => derive(source, scope, ChapterAudioKind::Redo)
                    .await
                    .map_err(|_| ChapterAudioError::WriteFailed)??,
                None => {
                    let run_id = uuid::Uuid::new_v4().to_string();
                    store::insert(db, &run_id, &project_id, &chapter_id, &plan).await?
                }
            };
            tracing::info!(
                event = "chapter_audio_started",
                run_id = row.id,
                project_id,
                chapter_id,
                units = plan.units.len(),
                inherited = row.inherited_units,
                backend = %plan.backend,
                model = %plan.model,
            );
            row
        }
        ChapterAudioStart::Retake { run_id, units } => {
            let source = chapter_source(db, &project_id, &chapter_id, &run_id).await?;
            let source_units = store::units(db, &source.id).await?;
            // 重录只针对完整、与当前计划一致的当前采用版本。
            if source.status != "succeeded"
                || source.adoption != ChapterAudioAdoption::Adopted.as_str()
                || !store::plan_matches(&source, &plan, &source_units)
                || !store::complete(db, state, &source).await?
            {
                return Err(ChapterAudioError::Conflict);
            }
            let scope = store::retake_scope(&source_units, &units)?;
            let source_id = source.id.clone();
            let row = derive(source, scope, ChapterAudioKind::Retake)
                .await
                .map_err(|_| ChapterAudioError::WriteFailed)??;
            tracing::info!(
                event = "chapter_audio_retake",
                run_id = row.id,
                source = source_id,
                units = units
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(","),
                inherited = row.inherited_units,
            );
            row
        }
    };
    Ok(row)
}
