//! Run/unit persistence, product files, media registry and startup recovery.
//!
//! 数据库是任务与单元事实的权威；内存里只保留在途任务的取消信号与媒体
//! 身份到文件的映射（启动时从数据库重建）。
use super::{plan::Plan, types::*};
use crate::chapter_analysis::ByteRange;
use crate::database::entity::{
    chapter, chapter_audio_arrangement as arrangement, chapter_audio_run as run,
    chapter_audio_unit as unit, command_receipt as receipt,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait,
    ExprTrait, IntoActiveModel, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    Statement, TransactionTrait,
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
    pub(super) waveforms: super::waveform::Cache,
}

impl ChapterAudioState {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self {
            root,
            starting: tokio::sync::Mutex::new(()),
            cancels: Mutex::new(HashMap::new()),
            media: Mutex::new(HashMap::new()),
            waveforms: super::waveform::Cache::default(),
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
         error = COALESCE(error, 'interrupted'), current_index = NULL, revision = revision + 1 \
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

/// 已放弃的版本不作为章节状态、可播版本或版本列表出现。
/// 创建时间只精确到秒，同一秒内的版本以插入顺序区分先后。
fn newest_first(query: sea_orm::Select<run::Entity>) -> sea_orm::Select<run::Entity> {
    query
        .order_by_desc(run::Column::CreatedAt)
        .order_by_desc(sea_orm::sea_query::Expr::cust("chapter_audio_runs.rowid"))
}

fn chapter_runs(
    project_id: &str,
    chapter_id: &str,
    mode: Option<ChapterAudioMode>,
) -> sea_orm::Select<run::Entity> {
    let query = run::Entity::find()
        .filter(run::Column::ProjectId.eq(project_id))
        .filter(run::Column::ChapterId.eq(chapter_id))
        .filter(run::Column::Adoption.ne("rejected"));
    let query = match mode {
        Some(mode) => query.filter(run::Column::Mode.eq(mode.as_str())),
        None => query,
    };
    newest_first(query)
}

async fn adopted(
    db: &impl ConnectionTrait,
    project_id: &str,
    chapter_id: &str,
    mode: Option<ChapterAudioMode>,
) -> Result<Option<run::Model>, ChapterAudioError> {
    let query = run::Entity::find()
        .filter(run::Column::ProjectId.eq(project_id))
        .filter(run::Column::ChapterId.eq(chapter_id))
        .filter(run::Column::Adoption.eq("adopted"));
    let query = match mode {
        Some(mode) => query.filter(run::Column::Mode.eq(mode.as_str())),
        None => newest_first(query),
    };
    query.one(db).await.map_err(read_failed)
}

/// 章节状态是最近一个未放弃的任务。重新采用了更早的版本时，较新的已完成版本不再是
/// 当前版本，此时返回当前采用版本，不把非当前版本当作本章状态。
pub(crate) async fn latest_for_chapter(
    db: &impl ConnectionTrait,
    project_id: &str,
    chapter_id: &str,
    mode: Option<ChapterAudioMode>,
) -> Result<Option<run::Model>, ChapterAudioError> {
    let Some(latest) = chapter_runs(project_id, chapter_id, mode)
        .one(db)
        .await
        .map_err(read_failed)?
    else {
        return Ok(None);
    };
    if latest.status == "succeeded"
        && latest.adoption == "none"
        && let Some(current) = adopted(
            db,
            &latest.project_id,
            &latest.chapter_id,
            Some(ChapterAudioMode::parse(&latest.mode)?),
        )
        .await?
    {
        return Ok(Some(current));
    }
    Ok(Some(latest))
}

/// 全部单元已有可读音频或为空白，且至少有一段音频。
pub(crate) async fn complete(
    db: &impl ConnectionTrait,
    state: &ChapterAudioState,
    row: &run::Model,
) -> Result<bool, ChapterAudioError> {
    let units = units(db, &row.id).await?;
    Ok(units.iter().any(|unit| unit.status == "done")
        && units.iter().all(|unit| {
            unit.status == "empty"
                || (unit.status == "done"
                    && unit
                        .media_id
                        .as_deref()
                        .and_then(|id| state.media_path(id))
                        .is_some())
        }))
}

/// 当前版本：完整可播的当前采用版本。没有时回退到最近的完整可播任务
/// （待采用与已放弃版本不参与），不伪造可播放状态。
pub(crate) async fn latest_playable(
    db: &DatabaseConnection,
    state: &ChapterAudioState,
    project_id: &str,
    chapter_id: &str,
    mode: Option<ChapterAudioMode>,
) -> Result<Option<run::Model>, ChapterAudioError> {
    if let Some(row) = adopted(db, project_id, chapter_id, mode).await?
        && complete(db, state, &row).await?
    {
        return Ok(Some(row));
    }
    let mut pages = chapter_runs(project_id, chapter_id, mode)
        .filter(run::Column::Status.eq("succeeded"))
        .filter(run::Column::Adoption.ne("pending"))
        .paginate(db, 16);
    while let Some(rows) = pages.fetch_and_next().await.map_err(read_failed)? {
        for row in rows {
            if complete(db, state, &row).await? {
                return Ok(Some(row));
            }
        }
    }
    Ok(None)
}

/// 某种制作方式的版本列表，最近在前，不含已放弃版本。
pub(crate) async fn versions(
    db: &impl ConnectionTrait,
    project_id: &str,
    chapter_id: &str,
    mode: ChapterAudioMode,
) -> Result<Vec<run::Model>, ChapterAudioError> {
    chapter_runs(project_id, chapter_id, Some(mode))
        .limit(32)
        .all(db)
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

/// A bounded projection for the assistant. The active run may be an older resumed attempt.
pub(crate) async fn recent_tasks(
    db: &DatabaseConnection,
    state: &ChapterAudioState,
    project_id: &str,
) -> Result<Vec<ChapterAudioTaskView>, ChapterAudioError> {
    const LIMIT: u64 = 5;
    let tx = db.begin().await.map_err(read_failed)?;
    let active = active_in_project(&tx, project_id).await?;
    let recent = run::Entity::find()
        .filter(run::Column::ProjectId.eq(project_id))
        .filter(run::Column::Status.is_not_in(ACTIVE))
        .order_by_desc(run::Column::FinishedAt)
        .order_by_desc(run::Column::CreatedAt)
        .order_by_desc(run::Column::Id)
        .limit(LIMIT - u64::from(active.is_some()))
        .all(&tx)
        .await
        .map_err(read_failed)?;
    let mut tasks = Vec::with_capacity(LIMIT as usize);
    for row in active.into_iter().chain(recent) {
        let preview = unit::Entity::find()
            .select_only()
            .columns([unit::Column::Index, unit::Column::MediaId])
            .filter(unit::Column::RunId.eq(&row.id))
            .filter(unit::Column::Status.eq("done"))
            .filter(unit::Column::MediaId.is_not_null())
            .order_by_asc(unit::Column::Index)
            .into_tuple::<(i32, String)>()
            .all(&tx)
            .await
            .map_err(read_failed)?
            .into_iter()
            .find(|(_, media_id)| state.media_path(media_id).is_some());
        tasks.push(ChapterAudioTaskView {
            run: run_view(&tx, state, &row).await?,
            preview_unit_index: preview
                .map(|(index, _)| u32::try_from(index).map_err(|_| ChapterAudioError::InvalidData))
                .transpose()?,
        });
    }
    tx.commit().await.map_err(read_failed)?;
    Ok(tasks)
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

/// 预检用的重做范围：只读，不建立任务、不复制文件。
/// 来源不存在、不属于本章或执行配置与当前计划不一致时不报告范围。
pub(crate) async fn redo_preview(
    db: &impl ConnectionTrait,
    state: &ChapterAudioState,
    plan: &Plan,
    project_id: &str,
    chapter_id: &str,
    source_id: &str,
) -> Result<Option<ChapterAudioRedo>, ChapterAudioError> {
    let source = match find(db, source_id).await {
        Ok(source) => source,
        Err(ChapterAudioError::NotFound) => return Ok(None),
        Err(error) => return Err(error),
    };
    if source.project_id != project_id
        || source.chapter_id != chapter_id
        || !same_inputs(&source, plan)
    {
        return Ok(None);
    }
    let units = units(db, &source.id).await?;
    Ok(Some(
        redo_scope(&units, plan, |unit: &unit::Model| {
            unit.media_id
                .as_deref()
                .and_then(|id| state.media_path(id))
                .is_some()
        })
        .summary(),
    ))
}

/// 单事务写入任务与全部单元；全局单活动任务由部分唯一索引兜底。
pub(crate) async fn insert(
    db: &DatabaseConnection,
    run_id: &str,
    project_id: &str,
    chapter_id: &str,
    plan: &Plan,
) -> Result<run::Model, ChapterAudioError> {
    write_run(
        db,
        None,
        Draft {
            run_id,
            project_id,
            chapter_id,
            plan,
            kind: ChapterAudioKind::Generation,
            parent: None,
            pauses: Vec::new(),
            dropped_pauses: 0,
            redo_indexes: Vec::new(),
            staged: &[],
        },
    )
    .await
}

/// 沿用单元：计划下标、为派生任务签发的产物身份、时长。
type Staged = (usize, String, f64);

/// 建立派生任务的输入。
pub(crate) struct Derivation<'a> {
    pub run_id: &'a str,
    pub project_id: &'a str,
    pub chapter_id: &'a str,
    pub plan: &'a Plan,
    pub parent: &'a run::Model,
    pub kind: ChapterAudioKind,
}

/// 建立派生任务：沿用单元先落为派生目录内的独立副本，再与任务、单元和继承的停顿同事务提交。
pub(crate) async fn derive(
    db: &DatabaseConnection,
    state: &ChapterAudioState,
    input: Derivation<'_>,
    scope: &RedoScope,
) -> Result<run::Model, ChapterAudioError> {
    let Derivation {
        run_id,
        project_id,
        chapter_id,
        plan,
        parent,
        kind,
    } = input;
    let source_units = units(db, &parent.id).await?;
    let (pauses, dropped_pauses) = super::arrangement::inherit(
        &super::arrangement::saved_pauses(db, &parent.id).await?,
        &source_units,
        plan,
    );
    let staged = stage_inherited(state, run_id, &scope.inherited)?;
    let inherited_audio = staged.len();
    write_run(
        db,
        Some(state),
        Draft {
            run_id,
            project_id,
            chapter_id,
            plan,
            // 没有沿用到音频就不是重做；重录始终记录来源。
            kind: if inherited_audio == 0 && kind == ChapterAudioKind::Redo {
                ChapterAudioKind::Generation
            } else {
                kind
            },
            parent: (inherited_audio > 0 || kind == ChapterAudioKind::Retake).then_some(parent),
            pauses,
            dropped_pauses,
            redo_indexes: scope.redo_indexes.clone(),
            staged: &staged,
        },
    )
    .await
}

/// 沿用单元先落为派生任务目录内的独立副本（同卷硬链接，失败回退复制）；
/// 记录提交后才登记为可播放身份。空白单元没有音频，不在此列。
fn stage_inherited(
    state: &ChapterAudioState,
    run_id: &str,
    inherited: &[(usize, unit::Model)],
) -> Result<Vec<Staged>, ChapterAudioError> {
    std::fs::create_dir_all(state.run_dir(run_id)).map_err(|_| ChapterAudioError::WriteFailed)?;
    inherited
        .iter()
        .filter(|(_, source)| source.status == "done")
        .map(|(index, source)| {
            let source_index =
                u32::try_from(source.index).map_err(|_| ChapterAudioError::InvalidData)?;
            let from = state.unit_path(&source.run_id, source_index);
            let to = state.unit_path(run_id, *index as u32);
            if std::fs::hard_link(&from, &to).is_err() {
                let staged = tempfile::NamedTempFile::new_in(state.run_dir(run_id))
                    .map_err(|_| ChapterAudioError::WriteFailed)?;
                std::fs::copy(&from, staged.path()).map_err(|_| ChapterAudioError::WriteFailed)?;
                staged
                    .as_file()
                    .sync_all()
                    .map_err(|_| ChapterAudioError::WriteFailed)?;
                staged
                    .persist(&to)
                    .map_err(|_| ChapterAudioError::WriteFailed)?;
            }
            Ok((*index, media_id(), source.duration_ms.unwrap_or_default()))
        })
        .collect()
}

pub(super) fn media_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// 新任务的完整写入内容：整章生成没有沿用；派生任务带沿用的音频与继承的停顿。
struct Draft<'a> {
    run_id: &'a str,
    project_id: &'a str,
    chapter_id: &'a str,
    plan: &'a Plan,
    kind: ChapterAudioKind,
    parent: Option<&'a run::Model>,
    pauses: Vec<super::arrangement::Pause>,
    dropped_pauses: u32,
    /// 实际重新合成的单元下标。
    redo_indexes: Vec<u32>,
    staged: &'a [Staged],
}

async fn write_run(
    db: &DatabaseConnection,
    state: Option<&ChapterAudioState>,
    draft: Draft<'_>,
) -> Result<run::Model, ChapterAudioError> {
    let Draft {
        run_id,
        project_id,
        chapter_id,
        plan,
        kind,
        parent,
        pauses,
        dropped_pauses,
        redo_indexes,
        staged,
    } = draft;
    let count = |value: usize| i32::try_from(value).map_err(|_| ChapterAudioError::InvalidData);
    let inherited = count(staged.len())?;
    let transaction = db.begin().await.map_err(write_failed)?;
    let row = run::ActiveModel {
        id: Set(run_id.to_owned()),
        project_id: Set(project_id.to_owned()),
        chapter_id: Set(chapter_id.to_owned()),
        analysis_version_id: Set(plan.version_id.clone()),
        mode: Set(plan.mode().as_str().into()),
        source_id: Set(plan.source_id.clone()),
        source_sha256: Set(plan.source_sha256.clone()),
        backend: Set(plan.backend.clone()),
        model: Set(plan.model.clone()),
        device: Set(plan.device.as_str().into()),
        text_semantics: Set(plan.text_semantics.clone()),
        status: Set("queued".into()),
        stage: Set("queued".into()),
        unit_count: Set(count(plan.units.len())?),
        completed_units: Set(inherited),
        revision: Set(0),
        current_index: Set(None),
        failed_index: Set(None),
        error: Set(None),
        error_detail: Set(None),
        final_media_id: Set(None),
        final_duration_ms: Set(None),
        created_at: Set(crate::timestamp::unix_seconds()),
        finished_at: Set(None),
        parent_run_id: Set(parent.map(|parent| parent.id.clone())),
        inherited_units: Set(inherited),
        dropped_pauses: Set(
            i32::try_from(dropped_pauses).map_err(|_| ChapterAudioError::InvalidData)?
        ),
        kind: Set(kind.as_str().into()),
        adoption: Set(ChapterAudioAdoption::None.as_str().into()),
        redo_indexes: Set(
            serde_json::to_string(&redo_indexes).map_err(|_| ChapterAudioError::InvalidData)?
        ),
    }
    .insert(&transaction)
    .await
    .map_err(|_| ChapterAudioError::Busy)?;
    for (index, planned) in plan.units.iter().enumerate() {
        let (target_kind, character_id) = planned.target.columns();
        let inherited = staged.iter().find(|(at, _, _)| *at == index);
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
            status: Set(if inherited.is_some() {
                "done"
            } else if planned.empty {
                "empty"
            } else {
                "pending"
            }
            .into()),
            media_id: Set(inherited.map(|(_, media, _)| media.clone())),
            duration_ms: Set(inherited.map(|(_, _, duration)| *duration)),
            error: Set(None),
            error_detail: Set(None),
        }
        .insert(&transaction)
        .await
        .map_err(write_failed)?;
    }
    // 继承的停顿是派生任务的起始编排（修订 1），不是用户的编辑，不可撤销。
    if !pauses.is_empty() {
        arrangement::ActiveModel {
            id: Set(run_id.to_owned()),
            revision: Set(1),
            content: Set(super::arrangement::encode(&pauses)?),
            previous_content: Set(None),
        }
        .insert(&transaction)
        .await
        .map_err(write_failed)?;
    }
    transaction.commit().await.map_err(write_failed)?;
    if let Some(state) = state {
        for (index, media, _) in staged {
            state.publish_media(media, state.unit_path(run_id, *index as u32));
        }
    }
    Ok(row)
}

/// 派生范围：沿用单元与实际需要合成的单元。
#[derive(Debug, Default)]
pub(crate) struct RedoScope {
    /// (计划下标, 沿用的来源单元)，含空白单元。
    pub inherited: Vec<(usize, unit::Model)>,
    /// 需要合成的有声单元的计划下标。
    pub redo_indexes: Vec<u32>,
}

impl RedoScope {
    pub(crate) fn summary(&self) -> ChapterAudioRedo {
        ChapterAudioRedo {
            inheritable_units: self
                .inherited
                .iter()
                .filter(|(_, unit)| unit.status == "done")
                .count() as u32,
            redo_units: self.redo_indexes.len() as u32,
            redo_indexes: self.redo_indexes.clone(),
        }
    }
}

/// 来源任务与当前计划的执行配置一致，才有单元可以沿用。
pub(crate) fn same_inputs(source: &run::Model, plan: &Plan) -> bool {
    source.mode == plan.mode().as_str()
        && source.backend == plan.backend
        && source.model == plan.model
        && source.device == plan.device.as_str()
        && source.text_semantics == plan.text_semantics
}

/// 沿用判定：原文范围、实际声音与空白标记完全相同，且来源音频确实可读。
fn inheritable(
    source: &unit::Model,
    planned: &super::plan::PlannedUnit,
    has_audio: &impl Fn(&unit::Model) -> bool,
) -> bool {
    source.range_start == planned.range.start as i32
        && source.range_end == planned.range.end as i32
        && source.voice == planned.voice
        && if planned.empty {
            source.status == "empty"
        } else {
            source.status == "done" && has_audio(source)
        }
}

/// 按当前计划计算沿用范围。原文不可变且切分确定，未修改的范围必然得到相同的单元范围。
pub(crate) fn redo_scope(
    source_units: &[unit::Model],
    plan: &Plan,
    has_audio: impl Fn(&unit::Model) -> bool,
) -> RedoScope {
    let mut scope = RedoScope::default();
    for (index, planned) in plan.units.iter().enumerate() {
        match source_units
            .iter()
            .find(|unit| inheritable(unit, planned, &has_audio))
        {
            Some(unit) => scope.inherited.push((index, unit.clone())),
            None if !planned.empty => scope.redo_indexes.push(index as u32),
            None => {}
        }
    }
    scope
}

/// 重录范围：指定的有声单元重新合成，其余有声单元全部沿用。
pub(crate) fn retake_scope(
    source_units: &[unit::Model],
    units: &[u32],
) -> Result<RedoScope, ChapterAudioError> {
    let mut scope = RedoScope::default();
    for (index, unit) in source_units.iter().enumerate() {
        if unit.status != "done" {
            continue;
        }
        if units.contains(&(index as u32)) {
            scope.redo_indexes.push(index as u32);
        } else {
            scope.inherited.push((index, unit.clone()));
        }
    }
    if scope.redo_indexes.is_empty()
        || units
            .iter()
            .any(|index| !scope.redo_indexes.contains(index))
    {
        return Err(ChapterAudioError::InvalidData);
    }
    Ok(scope)
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
        .col_expr(
            run::Column::CurrentIndex,
            sea_orm::sea_query::Expr::val(None::<i32>),
        )
        .col_expr(
            run::Column::Revision,
            sea_orm::sea_query::Expr::col(run::Column::Revision).add(1),
        )
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
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE chapter_audio_runs SET id = id WHERE id = ?",
            [run_id.into()],
        ))
        .await
        .map_err(write_failed)?;
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
    row.revision = Set(row.revision.clone().unwrap() + 1);
    row.current_index = Set(None);
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
    let revision = current.revision + 1;
    // 重录的结果等待用户决定；整章生成与局部重做成功即成为当前采用版本。
    let adoption = if status != ChapterAudioStatus::Succeeded {
        None
    } else if ChapterAudioKind::parse(&current.kind)? == ChapterAudioKind::Retake {
        Some(ChapterAudioAdoption::Pending)
    } else if super::arrangement::valid(&transaction, &current).await? {
        // 生成期间可能修改了归属或绑定。校验与采用共用写事务。
        supersede_adopted(&transaction, &current).await?;
        Some(ChapterAudioAdoption::Adopted)
    } else {
        None
    };
    let mut row = current.into_active_model();
    if let Some(adoption) = adoption {
        row.adoption = Set(adoption.as_str().into());
    }
    row.revision = Set(revision);
    row.current_index = Set(None);
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
        .col_expr(
            run::Column::Revision,
            sea_orm::sea_query::Expr::col(run::Column::Revision).add(1),
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Decision {
    Adopt,
    Reject,
}

/// 在同一事务内让旧版让位，部分唯一索引约束当前采用指针。
async fn supersede_adopted(
    db: &impl ConnectionTrait,
    current: &run::Model,
) -> Result<(), ChapterAudioError> {
    run::Entity::update_many()
        .col_expr(
            run::Column::Adoption,
            sea_orm::sea_query::Expr::val(ChapterAudioAdoption::None.as_str()),
        )
        .filter(run::Column::ProjectId.eq(&current.project_id))
        .filter(run::Column::ChapterId.eq(&current.chapter_id))
        .filter(run::Column::Mode.eq(&current.mode))
        .filter(run::Column::Adoption.eq(ChapterAudioAdoption::Adopted.as_str()))
        .filter(run::Column::Id.ne(&current.id))
        .col_expr(
            run::Column::Revision,
            sea_orm::sea_query::Expr::col(run::Column::Revision).add(1),
        )
        .exec(db)
        .await
        .map_err(write_failed)?;
    Ok(())
}

/// 采用或放弃。命令回执保证幂等；采用在同一事务内让原当前采用版本让位，
/// 任何决定都不删除或改写其他版本的音频与停顿。
pub(crate) async fn decide(
    db: &DatabaseConnection,
    state: &ChapterAudioState,
    project_id: &str,
    run_id: &str,
    operation_id: &str,
    decision: Decision,
) -> Result<run::Model, ChapterAudioError> {
    if operation_id.is_empty() || operation_id.len() > 128 {
        return Err(ChapterAudioError::InvalidData);
    }
    let operation = match decision {
        Decision::Adopt => "chapter_audio_adopt",
        Decision::Reject => "chapter_audio_reject",
    };
    let request = crate::project::hash(format!("{operation}:{project_id}:{run_id}").as_bytes());
    let tx = db.begin().await.map_err(write_failed)?;
    tx.execute_raw(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE chapter_audio_runs SET id = id WHERE id = ?",
        [run_id.into()],
    ))
    .await
    .map_err(write_failed)?;
    let row = find(&tx, run_id).await?;
    if row.project_id != project_id {
        return Err(ChapterAudioError::NotFound);
    }
    if let Some(saved) = receipt::Entity::find_by_id(operation_id)
        .one(&tx)
        .await
        .map_err(read_failed)?
    {
        if saved.operation != operation || saved.request_hash != request {
            return Err(ChapterAudioError::Conflict);
        }
        // 重放已提交的决定：返回当前事实，不重复提交。
        return Ok(row);
    }
    let current = ChapterAudioAdoption::parse(&row.adoption)?;
    let next = match decision {
        Decision::Adopt if current == ChapterAudioAdoption::Adopted => current,
        Decision::Adopt if current == ChapterAudioAdoption::Rejected => {
            return Err(ChapterAudioError::Conflict);
        }
        Decision::Adopt => {
            // 只采用完整、与当前归属和声音一致的版本。
            if row.status != "succeeded" || !complete(&tx, state, &row).await? {
                return Err(ChapterAudioError::Conflict);
            }
            if !super::arrangement::valid(&tx, &row).await? {
                return Err(ChapterAudioError::Conflict);
            }
            supersede_adopted(&tx, &row).await?;
            ChapterAudioAdoption::Adopted
        }
        Decision::Reject => match current {
            ChapterAudioAdoption::Pending => ChapterAudioAdoption::Rejected,
            ChapterAudioAdoption::Rejected => current,
            _ => return Err(ChapterAudioError::Conflict),
        },
    };
    if next != current {
        tracing::info!(
            event = "chapter_audio_decided",
            run_id,
            adoption = next.as_str()
        );
        let mut model = row.clone().into_active_model();
        model.adoption = Set(next.as_str().into());
        model.revision = Set(row.revision + 1);
        model.update(&tx).await.map_err(write_failed)?;
    }
    receipt::ActiveModel {
        id: Set(operation_id.to_owned()),
        project_id: Set(project_id.to_owned()),
        operation: Set(operation.into()),
        request_hash: Set(request),
        result: Set(serde_json::json!({ "runId": run_id, "adoption": next.as_str() })),
    }
    .insert(&tx)
    .await
    .map_err(|_| ChapterAudioError::WriteFailed)?;
    tx.commit().await.map_err(write_failed)?;
    find(db, run_id).await
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

/// 冻结输入与单元计划是否与当前计划完全一致；不看任务状态。
pub(crate) fn plan_matches(row: &run::Model, plan: &Plan, units: &[unit::Model]) -> bool {
    row.mode == plan.mode().as_str()
        && row.analysis_version_id == plan.version_id
        && row.source_id == plan.source_id
        && row.source_sha256 == plan.source_sha256
        && row.backend == plan.backend
        && row.model == plan.model
        && row.device == plan.device.as_str()
        && row.text_semantics == plan.text_semantics
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

/// 终态任务是否可以续跑：冻结输入与单元计划必须与当前计划完全一致。
pub(crate) fn resumable(row: &run::Model, plan: &Plan, units: &[unit::Model]) -> bool {
    let status = ChapterAudioStatus::parse(&row.status);
    !status.is_some_and(ChapterAudioStatus::active)
        && status.is_some()
        && status != Some(ChapterAudioStatus::Succeeded)
        && plan_matches(row, plan, units)
}

/// 续跑：失败/未做单元回到待合成，已完成单元与音频原样保留；
/// 计数回到“仅已完成”，空白单元在再次经过时计入。
pub(crate) async fn resume(
    db: &DatabaseConnection,
    run_id: &str,
) -> Result<run::Model, ChapterAudioError> {
    let transaction = db.begin().await.map_err(write_failed)?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE chapter_audio_runs SET id = id WHERE id = ?",
            [run_id.into()],
        ))
        .await
        .map_err(write_failed)?;
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
    let revision = current.revision + 1;
    let mut row = current.into_active_model();
    row.revision = Set(revision);
    row.current_index = Set(None);
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
        mode: ChapterAudioMode::parse(&row.mode)?,
        analysis_version_id: row.analysis_version_id.clone(),
        unit_count: count(row.unit_count)?,
        completed_units: count(row.completed_units)?,
        revision: count(row.revision)?,
        current_index: row.current_index.map(count).transpose()?,
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
        kind: ChapterAudioKind::parse(&row.kind)?,
        adoption: ChapterAudioAdoption::parse(&row.adoption)?,
        parent_run_id: row.parent_run_id.clone(),
        inherited_units: count(row.inherited_units)?,
        dropped_pauses: count(row.dropped_pauses)?,
        redo_indexes: serde_json::from_str(&row.redo_indexes)
            .map_err(|_| ChapterAudioError::InvalidData)?,
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
        arrangement: super::arrangement::read(db, row).await?,
    })
}

pub(crate) fn sources_root(app_data: &Path) -> PathBuf {
    app_data.join("project-sources")
}

#[cfg(test)]
mod tests;

/// 发布实际执行位置；取消后不再开始新单元。
pub(crate) async fn begin_unit(
    db: &impl ConnectionTrait,
    run_id: &str,
    index: u32,
) -> Result<run::Model, ChapterAudioError> {
    db.execute_raw(Statement::from_sql_and_values(DbBackend::Sqlite,
        "UPDATE chapter_audio_runs SET current_index = ?, revision = revision + 1 WHERE id = ? AND status = 'running'",
        [(index as i32).into(), run_id.into()])).await.map_err(write_failed)?;
    find(db, run_id).await
}
