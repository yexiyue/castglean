//! Thin IPC boundary: semantic identities in, views out; no paths cross IPC.
use super::{
    store::{self, ChapterAudioState},
    types::*,
};
use sea_orm::DatabaseConnection;
use tauri::Manager;
use tauri_specta::Event;

fn db(app: &tauri::AppHandle) -> Result<DatabaseConnection, ChapterAudioError> {
    Ok(app
        .try_state::<DatabaseConnection>()
        .ok_or(ChapterAudioError::ReadFailed)?
        .inner()
        .clone())
}

fn sources(app: &tauri::AppHandle) -> Result<std::path::PathBuf, ChapterAudioError> {
    Ok(store::sources_root(&crate::storage::data(app)))
}

async fn emit(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, ChapterAudioState>,
    db: &DatabaseConnection,
    row: &crate::database::entity::chapter_audio_run::Model,
) {
    if let Ok(view) = store::run_view(db, state, row).await {
        let _ = ChapterAudioUpdate(view).emit(app);
    }
}

/// 生成前检查：只读，不产生任务；阻塞带定位信息。
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_check(
    app: tauri::AppHandle,
    project_id: String,
    chapter_id: String,
) -> Result<ChapterAudioCheck, ChapterAudioError> {
    let db = db(&app)?;
    let root = sources(&app)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let engine = app.state::<crate::engine::EngineState>();
        tauri::async_runtime::block_on(super::plan::build(
            &db,
            &root,
            &engine,
            &project_id,
            &chapter_id,
        ))
    })
    .await
    .map_err(|_| ChapterAudioError::ReadFailed)??;
    Ok(match outcome {
        super::plan::Outcome::Blocked(blockers) => ChapterAudioCheck {
            ready: false,
            blockers,
            plan: None,
        },
        super::plan::Outcome::Ready(plan) => ChapterAudioCheck {
            ready: true,
            blockers: vec![],
            plan: Some(plan.summary()),
        },
    })
}

/// 发起生成：全局至多一个活动任务；阻塞时不落任何任务记录。
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_start(
    app: tauri::AppHandle,
    project_id: String,
    chapter_id: String,
    restart: bool,
) -> Result<ChapterAudioStatusView, ChapterAudioError> {
    let state = app.state::<ChapterAudioState>();
    let db = db(&app)?;
    let root = sources(&app)?;
    // 串行化“检查活动任务 → 写入新任务”，同一时间只允许一个启动路径。
    let _starting = state.starting.lock().await;
    let busy = ChapterAudioError::Busy;
    if state.active() || store::any_active(&db).await? {
        return Err(busy);
    }
    if app.state::<crate::voices::studio::StudioState>().active()
        || app
            .state::<crate::engine::EngineState>()
            .active_preparations()
            .map_err(|_| ChapterAudioError::ReadFailed)?
            > 0
    {
        return Err(busy);
    }
    let plan = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let db = db.clone();
        let (project_id, chapter_id) = (project_id.clone(), chapter_id.clone());
        move || {
            let engine = app.state::<crate::engine::EngineState>();
            tauri::async_runtime::block_on(super::plan::build(
                &db,
                &root,
                &engine,
                &project_id,
                &chapter_id,
            ))
        }
    })
    .await
    .map_err(|_| ChapterAudioError::ReadFailed)??;
    let plan = match plan {
        super::plan::Outcome::Blocked(blockers) => {
            return Err(ChapterAudioError::Blocked { blockers });
        }
        super::plan::Outcome::Ready(plan) => plan,
    };
    // 同一冻结输入的终态任务直接续跑：已完成单元与音频保留，不从头再来。
    let resume = match store::latest_for_chapter(&db, &project_id, &chapter_id).await? {
        Some(row) if row.completed_units > 0 && row.status != "succeeded" && !restart => {
            let units = store::units(&db, &row.id).await?;
            if !store::resumable(&row, &plan, &units) {
                return Err(ChapterAudioError::Conflict);
            }
            Some(row.id.clone())
        }
        _ => None,
    };
    let run_id = match resume {
        Some(run_id) => {
            let row = store::resume(&db, &run_id).await?;
            state.begin(&run_id);
            emit(&app, &state, &db, &row).await;
            run_id
        }
        None => {
            let run_id = uuid::Uuid::new_v4().to_string();
            store::insert(&db, &run_id, &project_id, &chapter_id, &plan).await?;
            tracing::info!(
                event = "chapter_audio_started",
                run_id,
                project_id,
                chapter_id,
                units = plan.units.len(),
                backend = %plan.backend,
                model = %plan.model,
            );
            state.begin(&run_id);
            let row = store::find(&db, &run_id).await?;
            emit(&app, &state, &db, &row).await;
            run_id
        }
    };
    if app
        .state::<crate::engine::resources::EngineThread>()
        .chapter_audio(run_id.clone())
        .await
        .is_err()
    {
        state.finish(&run_id);
        let row = store::finish(
            &db,
            &run_id,
            store::Finish {
                status: ChapterAudioStatus::Failed,
                error: Some(super::execution::code::ENGINE),
                detail: Some("engine thread unavailable".into()),
                failed: None,
                product: None,
                settled: None,
            },
        )
        .await?;
        emit(&app, &state, &db, &row).await;
    }
    let row = store::find(&db, &run_id).await?;
    store::status_view(&db, &state, &row).await
}

/// 当前章节最近一次任务（任意状态）与其单元。
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_status(
    app: tauri::AppHandle,
    project_id: String,
    chapter_id: String,
) -> Result<Option<ChapterAudioStatusView>, ChapterAudioError> {
    let state = app.state::<ChapterAudioState>();
    let db = db(&app)?;
    match store::latest_for_chapter(&db, &project_id, &chapter_id).await? {
        Some(row) => Ok(Some(store::status_view(&db, &state, &row).await?)),
        None => Ok(None),
    }
}

/// 工程内在途任务（供跨章指示）；没有时返回 null。
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_active(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Option<ChapterAudioRunView>, ChapterAudioError> {
    let state = app.state::<ChapterAudioState>();
    let db = db(&app)?;
    match store::active_in_project(&db, &project_id).await? {
        Some(row) => Ok(Some(store::run_view(&db, &state, &row).await?)),
        None => Ok(None),
    }
}

/// 取消：先持久化意图；终态任务幂等返回当前状态。
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_cancel(
    app: tauri::AppHandle,
    run_id: String,
) -> Result<ChapterAudioRunView, ChapterAudioError> {
    let state = app.state::<ChapterAudioState>();
    let db = db(&app)?;
    let row = store::request_cancel(&db, &run_id).await?;
    state.request_cancel(&run_id);
    emit(&app, &state, &db, &row).await;
    store::run_view(&db, &state, &row).await
}

/// 停顿编排只修改独立制作设置，不调用语音引擎。
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_arrangement_edit(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    expected_revision: u32,
    operation_id: String,
    edit: super::arrangement::ChapterPauseEdit,
) -> Result<super::arrangement::Arrangement, ChapterAudioError> {
    super::arrangement::edit(
        &db(&app)?,
        &project_id,
        &run_id,
        expected_revision,
        &operation_id,
        edit,
    )
    .await
}

/// 冻结可播连续区间与停顿修订，缺口不被过滤或跨过。
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_playback(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    from_index: u32,
) -> Result<super::playback::Playback, ChapterAudioError> {
    tauri::async_runtime::spawn_blocking(move || {
        let database = db(&app)?;
        let state = app.state::<ChapterAudioState>();
        tauri::async_runtime::block_on(super::playback::prepare(
            &database,
            &state,
            &project_id,
            &run_id,
            from_index,
        ))
    })
    .await
    .map_err(|_| ChapterAudioError::ReadFailed)?
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnitSummary {
    index: u32,
    text: String,
}

/// Only the visible bounded window is returned; full source stays in the host.
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_summaries(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    from_index: u32,
    count: u32,
) -> Result<Vec<UnitSummary>, ChapterAudioError> {
    if count > 128 {
        return Err(ChapterAudioError::InvalidData);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let database = db(&app)?;
        tauri::async_runtime::block_on(async {
            let row = store::find(&database, &run_id).await?;
            if row.project_id != project_id {
                return Err(ChapterAudioError::NotFound);
            }
            super::playback::summaries(
                &sources(&app)?,
                &row.source_sha256,
                store::units(&database, &run_id).await?,
                from_index,
                count,
            )
            .map(|items| {
                items
                    .into_iter()
                    .map(|(index, text)| UnitSummary { index, text })
                    .collect()
            })
        })
    })
    .await
    .map_err(|_| ChapterAudioError::ReadFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_export(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
) -> Result<Option<super::export::ChapterExportView>, ChapterAudioError> {
    tauri::async_runtime::spawn_blocking(move || super::export::start(app, project_id, run_id))
        .await
        .map_err(|_| ChapterAudioError::WriteFailed)?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_export_status(
    app: tauri::AppHandle,
    id: String,
) -> Result<super::export::ChapterExportView, ChapterAudioError> {
    app.state::<super::export::ExportState>().view(&id)
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_audio_export_cancel(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), ChapterAudioError> {
    app.state::<super::export::ExportState>().cancel(&id)
}
