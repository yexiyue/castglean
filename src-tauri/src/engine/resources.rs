//! 资源准备任务：引擎线程上的状态机、磁盘预检、取消与事件。
//!
//! 引擎对象（`Rc`）全部生活在专用线程的 LocalSet 上，复用 Tauri
//! 运行时，符合 talechime「对象留在其 owner 线程」的约定。IPC 命令
//! 经 channel 与引擎线程通信；准备任务用 `spawn_local` 驱动，其
//! 普通下载使用 drop-future 取消；原生准备通过协作信号停止并等待 worker 退出。
//! 权威状态仍是离线盘点，任务阶段与失败是叠加视图；前端通过有序 Channel
//! 和重连快照消费，不拥有任务生命周期。
mod native;

use std::{cell::RefCell, collections::HashMap, rc::Rc};

use talechime::Event;
use tauri::Manager;
use tokio::sync::{mpsc, oneshot};

use super::{EngineState, PrepareOutcome, ResourceState, events::ModelResourceUpdate, inventory};

/// IPC → 引擎线程的请求。
enum EngineRequest {
    Studio(Box<crate::voices::studio::StudioJob>),
    /// 章节顺序合成；与试听共用推理闸门。
    ChapterAudio {
        run_id: String,
    },
    Plan {
        backend: String,
        model: Option<String>,
        reply: oneshot::Sender<Result<super::preparation::ModelPreparationPlan, String>>,
    },
    Prepare {
        backend: String,
        model: Option<String>,
        fingerprint: String,
        reply: oneshot::Sender<Result<PrepareOutcome, String>>,
    },
    UpdateSettings {
        settings: super::config::EngineSettings,
        reply: oneshot::Sender<Result<super::config::EngineSettings, String>>,
    },
    Verify {
        backend: String,
        model: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Pause {
        backend: String,
        model: String,
        reply: oneshot::Sender<Result<bool, String>>,
    },
    Cancel {
        backend: String,
        model: String,
        reply: oneshot::Sender<Result<bool, String>>,
    },
}

#[derive(Clone)]
pub(crate) struct EngineThread {
    tx: mpsc::Sender<EngineRequest>,
}

impl EngineThread {
    /// 启动引擎线程，以宿主运行时驱动本线程的 LocalSet。
    /// 所有 `Rc` 引擎对象只在该线程内存在。
    pub(crate) fn start(app: tauri::AppHandle) -> std::io::Result<Self> {
        let (tx, rx) = mpsc::channel(16);
        std::thread::Builder::new()
            .name("castglean-engine".into())
            .spawn(move || engine_loop(app, rx))?;
        Ok(Self { tx })
    }

    async fn request<T>(
        &self,
        build: impl FnOnce(oneshot::Sender<T>) -> EngineRequest,
    ) -> Result<T, String> {
        let (reply, done) = oneshot::channel();
        self.tx
            .send(build(reply))
            .await
            .map_err(|_| "engine thread unavailable".to_string())?;
        done.await
            .map_err(|_| "engine thread dropped request".to_string())
    }

    pub(crate) async fn studio(&self, job: crate::voices::studio::StudioJob) -> Result<(), String> {
        self.tx
            .send(EngineRequest::Studio(Box::new(job)))
            .await
            .map_err(|_| "engine thread unavailable".into())
    }
    pub(crate) async fn chapter_audio(&self, run_id: String) -> Result<(), String> {
        self.tx
            .send(EngineRequest::ChapterAudio { run_id })
            .await
            .map_err(|_| "engine thread unavailable".into())
    }
    pub(crate) async fn prepare(
        &self,
        backend: String,
        model: Option<String>,
        fingerprint: String,
    ) -> Result<PrepareOutcome, String> {
        self.request(|reply| EngineRequest::Prepare {
            backend,
            model,
            fingerprint,
            reply,
        })
        .await?
    }

    pub(crate) async fn plan(
        &self,
        backend: String,
        model: Option<String>,
    ) -> Result<super::preparation::ModelPreparationPlan, String> {
        self.request(|reply| EngineRequest::Plan {
            backend,
            model,
            reply,
        })
        .await?
    }

    pub(crate) async fn update_settings(
        &self,
        settings: super::config::EngineSettings,
    ) -> Result<super::config::EngineSettings, String> {
        self.request(|reply| EngineRequest::UpdateSettings { settings, reply })
            .await?
    }

    pub(crate) async fn verify(
        &self,
        backend: String,
        model: Option<String>,
    ) -> Result<(), String> {
        self.request(|reply| EngineRequest::Verify {
            backend,
            model,
            reply,
        })
        .await?
    }

    pub(crate) async fn pause(&self, backend: String, model: String) -> Result<bool, String> {
        self.request(|reply| EngineRequest::Pause {
            backend,
            model,
            reply,
        })
        .await?
    }
    pub(crate) async fn cancel(&self, backend: String, model: String) -> Result<bool, String> {
        self.request(|reply| EngineRequest::Cancel {
            backend,
            model,
            reply,
        })
        .await?
    }
}

/// 引擎线程内进行中任务的登记表。
enum TaskKind {
    Verify,
    Download(talechime::Downloads),
    Native {
        downloads: talechime::Downloads,
        control: talechime::PreparationControl,
    },
}
struct LocalTask {
    handle: tokio::task::JoinHandle<()>,
    kind: TaskKind,
}
impl LocalTask {
    fn is_verifying(&self) -> bool {
        matches!(self.kind, TaskKind::Verify)
    }
    fn is_native(&self) -> bool {
        matches!(self.kind, TaskKind::Native { .. })
    }
    async fn stop(self) -> bool {
        let downloads = match self.kind {
            TaskKind::Native { downloads, control } => {
                control.cancel();
                Some(downloads)
            }
            TaskKind::Download(downloads) => {
                self.handle.abort();
                Some(downloads)
            }
            TaskKind::Verify => {
                self.handle.abort();
                None
            }
        };
        let _ = self.handle.await;
        downloads.is_some_and(|client| client.checkpoint_failed())
    }
}
type LocalTasks = Rc<RefCell<HashMap<(String, String), LocalTask>>>;
type LocalPlans = Rc<RefCell<HashMap<(String, String), talechime::PreparationPlan>>>;

fn engine_loop(app: tauri::AppHandle, mut rx: mpsc::Receiver<EngineRequest>) {
    let local = tokio::task::LocalSet::new();
    tauri::async_runtime::block_on(local.run_until(async move {
        let tasks: LocalTasks = Rc::new(RefCell::new(HashMap::new()));
        let plans: LocalPlans = Default::default();
        let studio_gate = Rc::new(tokio::sync::Semaphore::new(1));
        while let Some(request) = rx.recv().await {
            match request {
                EngineRequest::Plan {
                    backend,
                    model,
                    reply,
                } => {
                    let app = app.clone();
                    let plans = plans.clone();
                    tokio::task::spawn_local(async move {
                        let state = app.state::<EngineState>();
                        let result = super::preparation::plan(&state, &backend, model.as_deref())
                            .await
                            .map(|planned| {
                                if let Some(native) = planned.native {
                                    plans.borrow_mut().insert((backend, planned.model), native);
                                }
                                planned.view
                            })
                            .map_err(|_| "无法计算资源准备计划".to_string());
                        let _ = reply.send(result);
                    });
                }
                EngineRequest::Studio(job) => {
                    tokio::task::spawn_local(crate::voices::studio::execution::run(
                        app.clone(),
                        *job,
                        studio_gate.clone(),
                    ));
                }
                EngineRequest::ChapterAudio { run_id } => {
                    tokio::task::spawn_local(crate::chapter_audio::run(
                        app.clone(),
                        run_id,
                        studio_gate.clone(),
                    ));
                }
                EngineRequest::Prepare {
                    backend,
                    model,
                    fingerprint,
                    reply,
                } => {
                    // reply 失败说明前端已离开；Started 的任务照常跑完并
                    // 发送 Channel 更新（幂等，重进页面即见权威状态）。
                    let outcome = begin_prepare(&app, &tasks, &plans, backend, model, fingerprint);
                    let _ = reply.send(outcome);
                }
                EngineRequest::UpdateSettings { settings, reply } => {
                    // 与任务启动同步串行处理，目录检查和任务登记之间不能切换配置。
                    let state = app.state::<EngineState>();
                    let result = if app.state::<crate::voices::studio::StudioState>().active()
                        || app
                            .state::<crate::chapter_audio::ChapterAudioState>()
                            .active()
                        || !tasks.borrow().is_empty()
                    {
                        Err(anyhow::anyhow!("音色任务正在运行，请稍后更改设置"))
                    } else {
                        state.set_settings(settings)
                    }
                    .map(|()| state.settings())
                    .map_err(|error| error.to_string());
                    let _ = reply.send(result);
                }
                EngineRequest::Verify {
                    backend,
                    model,
                    reply,
                } => {
                    if app.state::<crate::voices::studio::StudioState>().active() {
                        let _ = reply.send(Err("音色任务正在运行".into()));
                        continue;
                    }
                    if app
                        .state::<crate::chapter_audio::ChapterAudioState>()
                        .active()
                    {
                        let _ = reply.send(Err("章节音频正在生成".into()));
                        continue;
                    }
                    let state = app.state::<EngineState>();
                    if state.active_preparations().unwrap_or(1) > 0 {
                        let _ = reply.send(Err("请先完成或取消资源准备，再验证模型".into()));
                        continue;
                    }
                    let resolved = super::catalog::registry(&state).and_then(|registry| {
                        anyhow::ensure!(
                            matches!(
                                registry.resource_status(&backend, model.as_deref())?,
                                talechime::ResourceStatus::Ready
                            ),
                            "资源未就绪，请先完成准备再验证"
                        );
                        registry.resolve(&backend, model.as_deref())
                    });
                    match resolved {
                        Err(error) => {
                            let _ = reply.send(Err(error.to_string()));
                        }
                        Ok(resolved) => {
                            let key = (
                                backend,
                                resolved.capabilities().model.clone().unwrap_or_default(),
                            );
                            if tasks.borrow().contains_key(&key) {
                                let _ = reply.send(Err("模型任务正在运行".into()));
                                continue;
                            }
                            let active_tasks = tasks.clone();
                            let task_key = key.clone();
                            let verify_gate = studio_gate.clone();
                            let handle = tokio::task::spawn_local(async move {
                                let _permit = verify_gate.acquire().await.unwrap();
                                let (tx, mut rx) = mpsc::channel(16);
                                let drain = async { while rx.recv().await.is_some() {} };
                                let options = talechime::PrepareOptions {
                                    device: resolved
                                        .available_devices()
                                        .into_iter()
                                        .next()
                                        .unwrap_or(talechime::Device::Cpu),
                                    calibrate: false,
                                    recovery: false,
                                    voice: None,
                                };
                                let (result, ()) =
                                    tokio::join!(resolved.load_existing(options, tx), drain);
                                active_tasks.borrow_mut().remove(&task_key);
                                let _ = reply
                                    .send(result.map(|_| ()).map_err(|error| error.to_string()));
                            });
                            tasks.borrow_mut().insert(
                                key,
                                LocalTask {
                                    handle,
                                    kind: TaskKind::Verify,
                                },
                            );
                        }
                    }
                }
                EngineRequest::Pause {
                    backend,
                    model,
                    reply,
                } => {
                    let _ = reply.send(pause_task(&app, &tasks, &backend, &model).await);
                }
                EngineRequest::Cancel {
                    backend,
                    model,
                    reply,
                } => {
                    let _ = reply.send(cancel_task(&app, &tasks, &backend, &model).await);
                }
            }
        }
    }));
}

fn begin_prepare(
    app: &tauri::AppHandle,
    tasks: &LocalTasks,
    plans: &LocalPlans,
    backend: String,
    model: Option<String>,
    fingerprint: String,
) -> Result<PrepareOutcome, String> {
    if app.state::<crate::voices::studio::StudioState>().active() {
        return Err("音色任务正在使用模型资源，请稍后准备".into());
    }
    if app
        .state::<crate::chapter_audio::ChapterAudioState>()
        .active()
    {
        return Err("章节音频正在使用模型资源，请稍后准备".into());
    }
    if tasks.borrow().values().any(LocalTask::is_verifying) {
        return Err("模型正在加载验证，请稍后准备资源".into());
    }
    let state = app.state::<EngineState>();
    let registry =
        super::catalog::registry(&state).map_err(|error| format!("engine registry: {error}"))?;
    let resolved = registry
        .resolve(&backend, model.as_deref())
        .map_err(|error| format!("unknown model: {error}"))?;
    let model_id = resolved.capabilities().model.clone().unwrap_or_default();

    if tasks
        .borrow()
        .contains_key(&(backend.clone(), model_id.clone()))
    {
        return Ok(PrepareOutcome::AlreadyPreparing);
    }

    if resolved.resource_preparation() == talechime::ResourcePreparation::Native {
        let plan = plans
            .borrow()
            .get(&(backend.clone(), model_id.clone()))
            .cloned();
        return native::begin(
            app,
            tasks,
            registry,
            resolved,
            (backend, model_id),
            fingerprint,
            plan,
        );
    }

    let status = registry
        .resource_status(&backend, Some(&model_id))
        .map_err(|error| format!("inventory: {error}"))?;
    let config = state.download_config().map_err(|_| "无法读取资源设置")?;
    if fingerprint
        != super::preparation::download_fingerprint(
            &config,
            &backend,
            &model_id,
            status.missing_bytes(),
        )
    {
        return Ok(PrepareOutcome::PlanChanged);
    }
    // 总量基线：本次准备还需下载的字节（就绪文件对进度分子分母都不贡献）。
    let missing_total = status.missing_bytes();
    let saved_state = state.task_state(&backend, &model_id);
    let saved_remaining = match &saved_state {
        Some(ResourceState::Paused {
            total_bytes,
            downloaded_bytes,
            ..
        }) => Some((total_bytes - downloaded_bytes).max(0.0)),
        _ => None,
    };
    let prior_total = match saved_state {
        Some(ResourceState::Paused { total_bytes, .. }) => total_bytes as u64,
        _ => missing_total,
    };
    let progress_total = prior_total.max(missing_total);
    let ready_before = progress_total.saturating_sub(missing_total);
    if status == talechime::ResourceStatus::Ready {
        return Ok(PrepareOutcome::AlreadyReady);
    }
    if let Some(outcome) = space_check(
        &state,
        saved_remaining
            .unwrap_or(missing_total as f64)
            .min(missing_total as f64),
    ) {
        return Ok(outcome);
    }

    let key = (backend.clone(), model_id.clone());
    let (tx, rx) = mpsc::channel::<Event>(64);
    let app = app.clone();
    let task_id = ModelResourceUpdate::state(
        &backend,
        &model_id,
        ResourceState::Downloading {
            downloaded_bytes: ready_before as f64,
            total_bytes: progress_total as f64,
            current_file: None,
            bytes_per_second: None,
            remaining_seconds: None,
            stalled: false,
        },
    )
    .publish(&app);
    if let Err(error) = state.persist_resource_tasks() {
        ModelResourceUpdate::state(
            &backend,
            &model_id,
            ResourceState::Failed {
                error: super::PrepareFailure::Disk,
                missing_bytes: missing_total as f64,
            },
        )
        .publish(&app);
        return Err(format!("无法保存下载任务：{error}"));
    }
    let task_backend = backend;
    let task_model = model_id;
    let active_tasks = tasks.clone();
    let downloads = registry.downloads().clone();
    let handle = tokio::task::spawn_local(async move {
        // Forwarding belongs to this task and drops with cancellation.
        let forward = super::progress::forward(rx, |resource, metrics| {
            ModelResourceUpdate::progress(
                &task_backend,
                &task_model,
                (ready_before + metrics.downloaded) as f64,
                progress_total.max(ready_before + metrics.downloaded) as f64,
                resource,
            )
            .with_metrics(metrics)
            .publish_for(&app, task_id);
        });
        let (result, ()) = tokio::join!(resolved.prepare_resources(tx), forward);

        let result =
            result.and_then(|()| registry.resource_status(&task_backend, Some(&task_model)));
        let next = match result {
            Ok(status) => inventory::from_engine(status),
            Err(error) => {
                let remaining = registry
                    .resource_status(&task_backend, Some(&task_model))
                    .map(talechime::ResourceStatus::missing_bytes)
                    .unwrap_or(missing_total);
                ResourceState::Failed {
                    error: if registry.downloads().checkpoint_failed() {
                        super::PrepareFailure::Disk
                    } else {
                        inventory::classify_failure(&error)
                    },
                    missing_bytes: remaining as f64,
                }
            }
        };
        active_tasks
            .borrow_mut()
            .remove(&(task_backend.clone(), task_model.clone()));
        ModelResourceUpdate::state(&task_backend, &task_model, next).publish_for(&app, task_id);
    });
    tasks.borrow_mut().insert(
        key,
        LocalTask {
            handle,
            kind: TaskKind::Download(downloads),
        },
    );
    Ok(PrepareOutcome::Started)
}

fn space_check(
    state: &tauri::State<'_, EngineState>,
    missing_bytes: f64,
) -> Option<PrepareOutcome> {
    if missing_bytes == 0.0 {
        return None;
    }
    let config = state.download_config().ok()?;
    let available = inventory::available_for(&config.cache_dir).ok()?;
    (available < missing_bytes).then_some(PrepareOutcome::InsufficientSpace {
        available,
        required: missing_bytes,
    })
}

async fn cancel_task(
    app: &tauri::AppHandle,
    tasks: &LocalTasks,
    backend: &str,
    model: &str,
) -> Result<bool, String> {
    let handle = tasks
        .borrow_mut()
        .remove(&(backend.to_owned(), model.to_owned()));
    if let Some(task) = handle {
        if task.is_native() {
            ModelResourceUpdate::state(
                backend,
                model,
                ResourceState::Preparing {
                    phase: super::PreparationPhase::Cancelling,
                    component: String::new(),
                    completed: 0.0,
                    total: 0.0,
                },
            )
            .publish(app);
        }
        if task.stop().await {
            return Err(checkpoint_failure(app, backend, model));
        }
    } else if !matches!(
        app.state::<EngineState>().task_state(backend, model),
        Some(ResourceState::Paused { .. } | ResourceState::Interrupted { .. })
    ) {
        return Ok(false);
    }
    // 已完成文件保留；状态立即回归盘点并广播。
    let state = app.state::<EngineState>();
    let next = match super::catalog::registry(&state).and_then(|registry| {
        Ok(inventory::from_engine(
            registry.resource_status(backend, Some(model))?,
        ))
    }) {
        Ok(next) => next,
        Err(_) => ResourceState::Missing { missing_bytes: 0.0 },
    };
    ModelResourceUpdate::state(backend, model, next).publish(app);
    state
        .persist_resource_tasks()
        .map_err(|e| format!("下载已取消，但任务保存失败：{e}"))?;
    Ok(true)
}

async fn pause_task(
    app: &tauri::AppHandle,
    tasks: &LocalTasks,
    backend: &str,
    model: &str,
) -> Result<bool, String> {
    let state = app.state::<EngineState>();
    let Some(paused) = state
        .task_state(backend, model)
        .as_ref()
        .and_then(super::resource_tasks::paused)
    else {
        return Ok(false);
    };
    let handle = tasks
        .borrow_mut()
        .remove(&(backend.to_owned(), model.to_owned()));
    let next = pause_after_exit(handle, paused, || {
        super::catalog::registry(&state)
            .and_then(|registry| registry.resource_status(backend, Some(model)))
            .is_ok_and(|status| status == talechime::ResourceStatus::Ready)
    })
    .await
    .map_err(|()| checkpoint_failure(app, backend, model))?;
    ModelResourceUpdate::state(backend, model, next).publish(app);
    state
        .persist_resource_tasks()
        .map_err(|e| format!("下载已停止，但任务保存失败：{e}"))?;
    Ok(true)
}

/// Read publication readiness only after cancellation has joined all owned work.
async fn pause_after_exit(
    task: Option<LocalTask>,
    paused: ResourceState,
    is_ready: impl FnOnce() -> bool,
) -> Result<ResourceState, ()> {
    if let Some(task) = task
        && task.stop().await
    {
        return Err(());
    }
    Ok(if is_ready() {
        ResourceState::Ready
    } else {
        paused
    })
}

fn checkpoint_failure(app: &tauri::AppHandle, backend: &str, model: &str) -> String {
    let state = app.state::<EngineState>();
    let missing_bytes = match state
        .task_state(backend, model)
        .as_ref()
        .and_then(super::resource_tasks::paused)
    {
        Some(ResourceState::Paused {
            total_bytes,
            downloaded_bytes,
            ..
        }) => (total_bytes - downloaded_bytes).max(0.0),
        _ => 0.0,
    };
    ModelResourceUpdate::state(
        backend,
        model,
        ResourceState::Failed {
            error: super::PrepareFailure::Disk,
            missing_bytes,
        },
    )
    .publish(app);
    "下载已停止，但断点保存失败，请检查缓存目录权限与空间".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn pause_after_publication_waits_for_exit_and_keeps_ready() {
        tokio::task::LocalSet::new()
            .run_until(async {
                let temp = tempfile::tempdir().unwrap();
                let downloads = talechime::Downloads::new(&talechime::DownloadConfig {
                    cache_dir: temp.path().join("hf"),
                    endpoint: None,
                    token: None,
                })
                .unwrap();
                let published = Rc::new(std::cell::Cell::new(false));
                let exited = Rc::new(std::cell::Cell::new(false));
                let release = Rc::new(tokio::sync::Notify::new());
                let committed = Rc::new(tokio::sync::Notify::new());
                let worker_published = published.clone();
                let worker_exited = exited.clone();
                let worker_release = release.clone();
                let worker_committed = committed.clone();
                let handle = tokio::task::spawn_local(async move {
                    worker_published.set(true);
                    worker_committed.notify_one();
                    // Commit has happened; the SDK ignores cancellation at this boundary.
                    worker_release.notified().await;
                    worker_exited.set(true);
                });
                committed.notified().await;
                let task = LocalTask {
                    handle,
                    kind: TaskKind::Native {
                        downloads,
                        control: talechime::PreparationControl::default(),
                    },
                };
                let fallback = ResourceState::Paused {
                    downloaded_bytes: 1.0,
                    total_bytes: 1.0,
                    current_file: None,
                };
                let pause =
                    tokio::task::spawn_local(pause_after_exit(Some(task), fallback, move || {
                        assert!(exited.get(), "inventory must follow worker exit");
                        published.get()
                    }));
                tokio::task::yield_now().await;
                assert!(!pause.is_finished());
                release.notify_one();
                assert_eq!(pause.await.unwrap().unwrap(), ResourceState::Ready);
            })
            .await;
    }

    #[tokio::test]
    async fn native_cancellation_waits_for_owned_work_to_exit() {
        tokio::task::LocalSet::new()
            .run_until(async {
                let control = talechime::PreparationControl::default();
                let worker_control = control.clone();
                let release = Rc::new(tokio::sync::Notify::new());
                let worker_release = release.clone();
                let handle = tokio::task::spawn_local(async move {
                    while worker_control.check().is_ok() {
                        tokio::task::yield_now().await;
                    }
                    // Simulates an owned converter acknowledging cancellation only after cleanup.
                    worker_release.notified().await;
                });
                let temp = tempfile::tempdir().unwrap();
                let downloads = talechime::Downloads::new(&talechime::DownloadConfig {
                    cache_dir: temp.path().join("hf-cache"),
                    endpoint: None,
                    token: None,
                })
                .unwrap();
                let stopping = tokio::task::spawn_local(
                    LocalTask {
                        handle,
                        kind: TaskKind::Native { downloads, control },
                    }
                    .stop(),
                );
                tokio::task::yield_now().await;
                assert!(!stopping.is_finished());
                release.notify_one();
                assert!(!stopping.await.unwrap());
            })
            .await;
    }
}
