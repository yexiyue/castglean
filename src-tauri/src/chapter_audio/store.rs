//! Run/unit persistence, product files, media registry and startup recovery.
//!
//! 数据库是任务与单元事实的权威；内存里只保留在途任务的取消信号与媒体
//! 身份到文件的映射（启动时从数据库重建）。
use super::{plan::Plan, types::*};
use crate::chapter_analysis::ByteRange;
use crate::database::entity::{chapter, chapter_audio_run as run, chapter_audio_unit as unit};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait,
    IntoActiveModel, PaginatorTrait, QueryFilter, QueryOrder, Set, Statement, TransactionTrait,
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tokio::sync::watch;

const ACTIVE: [&str; 3] = ["queued", "running", "cancelling"];

pub(crate) struct ChapterAudioState {
    root: PathBuf,
    /// 串行化启动：检查活动任务与写入新任务之间不可插入另一个启动。
    pub(crate) starting: tokio::sync::Mutex<()>,
    cancels: Mutex<HashMap<String, watch::Sender<bool>>>,
    media: Mutex<HashMap<String, PathBuf>>,
}

impl ChapterAudioState {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self {
            root,
            starting: tokio::sync::Mutex::new(()),
            cancels: Mutex::new(HashMap::new()),
            media: Mutex::new(HashMap::new()),
        }
    }

    /// 是否有在途生成任务占用引擎；锁不可用时保守视为占用。
    pub(crate) fn active(&self) -> bool {
        self.cancels.lock().map_or(true, |jobs| !jobs.is_empty())
    }

    pub(crate) fn begin(&self, run_id: &str) {
        if let Ok(mut jobs) = self.cancels.lock() {
            jobs.insert(run_id.to_owned(), watch::channel(false).0);
        }
    }

    pub(crate) fn cancellation(&self, run_id: &str) -> Option<watch::Receiver<bool>> {
        self.cancels
            .lock()
            .ok()?
            .get(run_id)
            .map(watch::Sender::subscribe)
    }

    pub(crate) fn request_cancel(&self, run_id: &str) {
        if let Ok(jobs) = self.cancels.lock()
            && let Some(cancel) = jobs.get(run_id)
        {
            cancel.send_replace(true);
        }
    }

    pub(crate) fn finish(&self, run_id: &str) {
        if let Ok(mut jobs) = self.cancels.lock() {
            jobs.remove(run_id);
        }
    }

    pub(crate) fn run_dir(&self, run_id: &str) -> PathBuf {
        self.root.join(run_id)
    }

    pub(crate) fn unit_path(&self, run_id: &str, index: u32) -> PathBuf {
        self.run_dir(run_id).join(format!("unit-{index:04}.wav"))
    }

    pub(crate) fn final_path(&self, run_id: &str) -> PathBuf {
        self.run_dir(run_id).join("chapter.wav")
    }

    /// 只登记已完整落盘的文件；缺失文件不获得可播放身份。
    pub(crate) fn publish_media(&self, id: &str, path: PathBuf) -> bool {
        if !path.is_file() {
            return false;
        }
        self.media
            .lock()
            .map(|mut media| media.insert(id.to_owned(), path))
            .is_ok()
    }

    pub(crate) fn media_path(&self, id: &str) -> Option<PathBuf> {
        self.media
            .lock()
            .ok()?
            .get(id)
            .filter(|path| path.is_file())
            .cloned()
    }
}

fn write_failed(_: sea_orm::DbErr) -> ChapterAudioError {
    ChapterAudioError::WriteFailed
}

fn read_failed(_: sea_orm::DbErr) -> ChapterAudioError {
    ChapterAudioError::ReadFailed
}

/// 启动恢复：上次进程遗留的在途任务标记为中断，单元状态原样保留；
/// 随后从数据库重建媒体身份映射。不自动重新生成。
pub(crate) async fn recover(
    db: &DatabaseConnection,
    state: &ChapterAudioState,
) -> Result<(), ChapterAudioError> {
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE chapter_audio_runs SET status = 'interrupted', finished_at = ?, \
         error = COALESCE(error, 'interrupted') \
         WHERE status IN ('queued', 'running', 'cancelling')",
        [crate::timestamp::unix_seconds().into()],
    ))
    .await
    .map_err(write_failed)?;
    for row in run::Entity::find().all(db).await.map_err(read_failed)? {
        if row.status == "interrupted" {
            tracing::warn!(
                event = "run_interrupted",
                run_id = %row.id,
                completed_units = row.completed_units,
            );
        }
        if let Some(id) = &row.final_media_id {
            state.publish_media(id, state.final_path(&row.id));
        }
    }
    for row in unit::Entity::find()
        .filter(unit::Column::MediaId.is_not_null())
        .all(db)
        .await
        .map_err(read_failed)?
    {
        if let (Some(id), Ok(index)) = (&row.media_id, u32::try_from(row.index)) {
            state.publish_media(id, state.unit_path(&row.run_id, index));
        }
    }
    Ok(())
}

pub(crate) async fn any_active(db: &impl ConnectionTrait) -> Result<bool, ChapterAudioError> {
    Ok(run::Entity::find()
        .filter(run::Column::Status.is_in(ACTIVE))
        .one(db)
        .await
        .map_err(read_failed)?
        .is_some())
}

pub(crate) async fn find(
    db: &impl ConnectionTrait,
    run_id: &str,
) -> Result<run::Model, ChapterAudioError> {
    run::Entity::find_by_id(run_id)
        .one(db)
        .await
        .map_err(read_failed)?
        .ok_or(ChapterAudioError::NotFound)
}

pub(crate) async fn latest_for_chapter(
    db: &impl ConnectionTrait,
    project_id: &str,
    chapter_id: &str,
) -> Result<Option<run::Model>, ChapterAudioError> {
    run::Entity::find()
        .filter(run::Column::ProjectId.eq(project_id))
        .filter(run::Column::ChapterId.eq(chapter_id))
        .order_by_desc(run::Column::CreatedAt)
        .order_by_desc(run::Column::Id)
        .one(db)
        .await
        .map_err(read_failed)
}

pub(crate) async fn active_in_project(
    db: &impl ConnectionTrait,
    project_id: &str,
) -> Result<Option<run::Model>, ChapterAudioError> {
    run::Entity::find()
        .filter(run::Column::ProjectId.eq(project_id))
        .filter(run::Column::Status.is_in(ACTIVE))
        .one(db)
        .await
        .map_err(read_failed)
}

pub(crate) async fn units(
    db: &impl ConnectionTrait,
    run_id: &str,
) -> Result<Vec<unit::Model>, ChapterAudioError> {
    unit::Entity::find()
        .filter(unit::Column::RunId.eq(run_id))
        .order_by_asc(unit::Column::Index)
        .all(db)
        .await
        .map_err(read_failed)
}

/// 单事务写入任务与全部单元；全局单活动任务由部分唯一索引兜底。
pub(crate) async fn insert(
    db: &DatabaseConnection,
    run_id: &str,
    project_id: &str,
    chapter_id: &str,
    plan: &Plan,
) -> Result<(), ChapterAudioError> {
    let transaction = db.begin().await.map_err(write_failed)?;
    run::ActiveModel {
        id: Set(run_id.to_owned()),
        project_id: Set(project_id.to_owned()),
        chapter_id: Set(chapter_id.to_owned()),
        analysis_version_id: Set(plan.version_id.clone()),
        source_sha256: Set(plan.source_sha256.clone()),
        backend: Set(plan.backend.clone()),
        model: Set(plan.model.clone()),
        device: Set("cpu".into()),
        status: Set("queued".into()),
        stage: Set("queued".into()),
        unit_count: Set(plan.units.len() as i32),
        completed_units: Set(0),
        failed_index: Set(None),
        error: Set(None),
        error_detail: Set(None),
        final_media_id: Set(None),
        final_duration_ms: Set(None),
        created_at: Set(crate::timestamp::unix_seconds()),
        finished_at: Set(None),
    }
    .insert(&transaction)
    .await
    .map_err(|_| ChapterAudioError::Busy)?;
    for (index, planned) in plan.units.iter().enumerate() {
        let (target_kind, character_id) = planned.target.columns();
        unit::ActiveModel {
            id: Set(uuid::Uuid::new_v4().to_string()),
            run_id: Set(run_id.to_owned()),
            index: Set(index as i32),
            segment_id: Set(planned.segment_id.clone()),
            range_start: Set(planned.range.start as i32),
            range_end: Set(planned.range.end as i32),
            line: Set(planned.line as i32),
            target_kind: Set(target_kind.to_owned()),
            character_id: Set(character_id.to_owned()),
            voice: Set(planned.voice.clone()),
            status: Set(if planned.empty { "empty" } else { "pending" }.into()),
            media_id: Set(None),
            duration_ms: Set(None),
            error: Set(None),
            error_detail: Set(None),
        }
        .insert(&transaction)
        .await
        .map_err(write_failed)?;
    }
    transaction.commit().await.map_err(write_failed)
}

pub(crate) async fn set_stage(
    db: &impl ConnectionTrait,
    run_id: &str,
    status: ChapterAudioStatus,
    stage: &str,
) -> Result<run::Model, ChapterAudioError> {
    run::Entity::update_many()
        .col_expr(
            run::Column::Status,
            sea_orm::sea_query::Expr::val(status_name(status)),
        )
        .col_expr(run::Column::Stage, sea_orm::sea_query::Expr::val(stage))
        .filter(run::Column::Id.eq(run_id))
        .filter(run::Column::Status.is_in(["queued", "running"]))
        .exec(db)
        .await
        .map_err(write_failed)?;
    find(db, run_id).await
}

/// 单元完成：产物引用、时长与任务计数同事务提交。`media` 为空表示空白单元。
pub(crate) async fn complete_unit(
    db: &DatabaseConnection,
    run_id: &str,
    unit_id: &str,
    media: Option<(&str, f64)>,
) -> Result<run::Model, ChapterAudioError> {
    let transaction = db.begin().await.map_err(write_failed)?;
    if let Some((media_id, duration_ms)) = media {
        let mut row = unit::Entity::find_by_id(unit_id)
            .one(&transaction)
            .await
            .map_err(read_failed)?
            .ok_or(ChapterAudioError::NotFound)?
            .into_active_model();
        row.status = Set("done".into());
        row.media_id = Set(Some(media_id.to_owned()));
        row.duration_ms = Set(Some(duration_ms));
        row.update(&transaction).await.map_err(write_failed)?;
    }
    let current = find(&transaction, run_id).await?;
    let completed = current.completed_units + 1;
    let mut row = current.into_active_model();
    row.completed_units = Set(completed);
    let updated = row.update(&transaction).await.map_err(write_failed)?;
    transaction.commit().await.map_err(write_failed)?;
    Ok(updated)
}

/// 终态提交。失败时可同时记录失败单元与诊断详情；已完成单元与产物保持不变。
pub(crate) struct Finish<'a> {
    pub status: ChapterAudioStatus,
    pub error: Option<&'a str>,
    /// 引擎/IO 的原始错误（已截断），仅用于诊断，不进入界面文案。
    pub detail: Option<String>,
    pub failed: Option<(&'a str, u32)>,
    pub product: Option<(&'a str, f64)>,
    /// 终态时已定单元（done + empty）的精确计数；None 表示保持现状。
    pub settled: Option<u32>,
}

pub(crate) async fn finish(
    db: &DatabaseConnection,
    run_id: &str,
    finish: Finish<'_>,
) -> Result<run::Model, ChapterAudioError> {
    let transaction = db.begin().await.map_err(write_failed)?;
    // 先取得 SQLite 写锁，再读取状态，避免并发取消时读事务升级失败。
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE chapter_audio_runs SET stage = stage WHERE id = ?",
            [run_id.into()],
        ))
        .await
        .map_err(write_failed)?;
    if let Some((unit_id, _)) = finish.failed {
        let mut row = unit::Entity::find_by_id(unit_id)
            .one(&transaction)
            .await
            .map_err(read_failed)?
            .ok_or(ChapterAudioError::NotFound)?
            .into_active_model();
        row.status = Set("failed".into());
        row.error = Set(finish.error.map(str::to_owned));
        row.error_detail = Set(finish.detail.clone());
        row.update(&transaction).await.map_err(write_failed)?;
    }
    let current = find(&transaction, run_id).await?;
    // 取消在最后一次检查与终态提交之间到达时，不能将它覆盖为成功。
    let status = if current.status == "cancelling" && finish.status == ChapterAudioStatus::Succeeded
    {
        ChapterAudioStatus::Cancelled
    } else {
        finish.status
    };
    let mut row = current.into_active_model();
    row.status = Set(status_name(status).into());
    row.stage = Set("finished".into());
    row.error = Set(finish.error.map(str::to_owned));
    row.error_detail = Set(finish.detail.clone());
    row.failed_index = Set(finish.failed.map(|(_, index)| index as i32));
    row.finished_at = Set(Some(crate::timestamp::unix_seconds()));
    if let Some(settled) = finish.settled {
        row.completed_units = Set(settled as i32);
    }
    if status == ChapterAudioStatus::Succeeded
        && let Some((media_id, duration_ms)) = finish.product
    {
        row.final_media_id = Set(Some(media_id.to_owned()));
        row.final_duration_ms = Set(Some(duration_ms));
    }
    let updated = row.update(&transaction).await.map_err(write_failed)?;
    transaction.commit().await.map_err(write_failed)?;
    tracing::info!(
        event = "chapter_audio_finished",
        run_id,
        status = status_name(status),
        units = updated.unit_count,
        completed = updated.completed_units,
        failed_index = updated.failed_index,
        error_code = updated.error.as_deref(),
    );
    Ok(updated)
}

/// 取消意图先持久化；终态任务原样返回（幂等）。
pub(crate) async fn request_cancel(
    db: &impl ConnectionTrait,
    run_id: &str,
) -> Result<run::Model, ChapterAudioError> {
    run::Entity::update_many()
        .col_expr(
            run::Column::Status,
            sea_orm::sea_query::Expr::val("cancelling"),
        )
        .filter(run::Column::Id.eq(run_id))
        .filter(run::Column::Status.is_in(["queued", "running"]))
        .exec(db)
        .await
        .map_err(write_failed)?;
    find(db, run_id).await
}

fn status_name(status: ChapterAudioStatus) -> &'static str {
    match status {
        ChapterAudioStatus::Queued => "queued",
        ChapterAudioStatus::Running => "running",
        ChapterAudioStatus::Cancelling => "cancelling",
        ChapterAudioStatus::Cancelled => "cancelled",
        ChapterAudioStatus::Failed => "failed",
        ChapterAudioStatus::Interrupted => "interrupted",
        ChapterAudioStatus::Succeeded => "succeeded",
    }
}

/// 仅统计已产出音频的单元；续跑计数从这里重启，空白单元经过时再计入。
async fn done_units(db: &impl ConnectionTrait, run_id: &str) -> Result<u32, ChapterAudioError> {
    let count = unit::Entity::find()
        .filter(unit::Column::RunId.eq(run_id))
        .filter(unit::Column::Status.eq("done"))
        .count(db)
        .await
        .map_err(read_failed)?;
    u32::try_from(count).map_err(|_| ChapterAudioError::InvalidData)
}

/// 终态任务是否可以续跑：冻结输入与单元计划必须与当前计划完全一致。
pub(crate) fn resumable(row: &run::Model, plan: &Plan, units: &[unit::Model]) -> bool {
    let status = ChapterAudioStatus::parse(&row.status);
    !status.is_some_and(ChapterAudioStatus::active)
        && status.is_some()
        && row.completed_units > 0
        && row.analysis_version_id == plan.version_id
        && row.source_sha256 == plan.source_sha256
        && row.backend == plan.backend
        && row.model == plan.model
        && units.len() == plan.units.len()
        && units.iter().zip(&plan.units).all(|(row, planned)| {
            row.range_start == planned.range.start as i32
                && row.range_end == planned.range.end as i32
                && row.voice == planned.voice
                && row.target_kind == planned.target.columns().0
                && row.character_id == planned.target.columns().1
                && (row.status == "empty") == planned.empty
        })
}

/// 续跑：失败/未做单元回到待合成，已完成单元与音频原样保留；
/// 计数回到“仅已完成”，空白单元在再次经过时计入。
pub(crate) async fn resume(
    db: &DatabaseConnection,
    run_id: &str,
) -> Result<run::Model, ChapterAudioError> {
    let transaction = db.begin().await.map_err(write_failed)?;
    let current = find(&transaction, run_id).await?;
    if ChapterAudioStatus::parse(&current.status).is_some_and(ChapterAudioStatus::active) {
        return Err(ChapterAudioError::Busy);
    }
    unit::Entity::update_many()
        .col_expr(
            unit::Column::Status,
            sea_orm::sea_query::Expr::val("pending"),
        )
        .col_expr(
            unit::Column::Error,
            sea_orm::sea_query::Expr::val(None::<String>),
        )
        .col_expr(
            unit::Column::ErrorDetail,
            sea_orm::sea_query::Expr::val(None::<String>),
        )
        .filter(unit::Column::RunId.eq(run_id))
        .filter(unit::Column::Status.eq("failed"))
        .exec(&transaction)
        .await
        .map_err(write_failed)?;
    let done = done_units(&transaction, run_id).await?;
    tracing::info!(
        event = "chapter_audio_resumed",
        run_id,
        kept_done_units = done
    );
    let mut row = current.into_active_model();
    row.status = Set("queued".into());
    row.stage = Set("queued".into());
    row.completed_units = Set(done as i32);
    row.failed_index = Set(None);
    row.error = Set(None);
    row.error_detail = Set(None);
    row.finished_at = Set(None);
    let updated = row.update(&transaction).await.map_err(write_failed)?;
    transaction.commit().await.map_err(write_failed)?;
    Ok(updated)
}

pub(crate) async fn run_view(
    db: &impl ConnectionTrait,
    state: &ChapterAudioState,
    row: &run::Model,
) -> Result<ChapterAudioRunView, ChapterAudioError> {
    let chapter_title = chapter::Entity::find_by_id(&row.chapter_id)
        .one(db)
        .await
        .map_err(read_failed)?
        .map(|c| c.title)
        .unwrap_or_default();
    let count = |value: i32| u32::try_from(value).map_err(|_| ChapterAudioError::InvalidData);
    Ok(ChapterAudioRunView {
        id: row.id.clone(),
        project_id: row.project_id.clone(),
        chapter_id: row.chapter_id.clone(),
        chapter_title,
        status: ChapterAudioStatus::parse(&row.status).ok_or(ChapterAudioError::InvalidData)?,
        stage: row.stage.clone(),
        backend: row.backend.clone(),
        model: row.model.clone(),
        device: row.device.clone(),
        analysis_version_id: row.analysis_version_id.clone(),
        unit_count: count(row.unit_count)?,
        completed_units: count(row.completed_units)?,
        failed_index: row.failed_index.map(count).transpose()?,
        error: row.error.clone(),
        // 产物文件缺失时不暴露可播放身份。
        final_media_id: row
            .final_media_id
            .clone()
            .filter(|id| state.media_path(id).is_some()),
        final_duration_ms: row.final_duration_ms,
        created_at: row.created_at.clone(),
        finished_at: row.finished_at.clone(),
    })
}

pub(crate) async fn status_view(
    db: &impl ConnectionTrait,
    state: &ChapterAudioState,
    row: &run::Model,
) -> Result<ChapterAudioStatusView, ChapterAudioError> {
    let names: HashMap<String, String> =
        crate::chapter_analysis::analysis_characters(db, &row.project_id)
            .await?
            .into_iter()
            .map(|c| (c.id, c.display_name))
            .collect();
    let units = units(db, &row.id)
        .await?
        .into_iter()
        .map(|u| {
            let number =
                |value: i32| u32::try_from(value).map_err(|_| ChapterAudioError::InvalidData);
            let character_id = (!u.character_id.is_empty()).then(|| u.character_id.clone());
            Ok(ChapterAudioUnitView {
                index: number(u.index)?,
                range: ByteRange {
                    start: number(u.range_start)?,
                    end: number(u.range_end)?,
                },
                line: number(u.line)?,
                segment_id: u.segment_id,
                target_kind: u.target_kind,
                character_name: character_id.as_ref().and_then(|id| names.get(id).cloned()),
                character_id,
                voice: u.voice,
                status: ChapterAudioUnitStatus::parse(&u.status),
                media_id: u.media_id.filter(|id| state.media_path(id).is_some()),
                duration_ms: u.duration_ms,
            })
        })
        .collect::<Result<_, ChapterAudioError>>()?;
    Ok(ChapterAudioStatusView {
        run: run_view(db, state, row).await?,
        units,
    })
}

pub(crate) fn sources_root(app_data: &Path) -> PathBuf {
    app_data.join("project-sources")
}

#[cfg(test)]
mod tests;
