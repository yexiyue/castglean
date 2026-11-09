//! Admission happens before queueing, so a busy connection cannot occupy all workers.
use super::{RunJob, RuntimeOwner};
use crate::{
    ai::{self, AiError, Configuration, RunFailure, RunStatus},
    database::entity::ai_run,
    llm::LlmState,
};
use apalis::prelude::*;
use apalis_sqlite::SqliteStorage;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, TransactionTrait,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

struct Admission {
    token: CancellationToken,
    connection: String,
    _permit: OwnedSemaphorePermit,
}

struct ActiveRun<'a> {
    runtime: &'a Runtime,
    id: &'a str,
    token: CancellationToken,
}
impl Drop for ActiveRun<'_> {
    fn drop(&mut self) {
        self.token.cancel();
        self.runtime.release(self.id);
    }
}

pub(crate) struct Runtime {
    stream: Arc<ai::stream::Hub>,
    owner: RuntimeOwner,
    db: DatabaseConnection,
    root: PathBuf,
    llm: Arc<LlmState>,
    slots: Arc<Semaphore>,
    admitted: Mutex<HashMap<String, Admission>>,
    wake: tokio::sync::Notify,
}
impl Runtime {
    pub(super) fn new(
        owner: RuntimeOwner,
        db: DatabaseConnection,
        root: PathBuf,
        llm: Arc<LlmState>,
    ) -> Arc<Self> {
        Arc::new(Self {
            stream: ai::stream::Hub::new(db.clone()),
            owner,
            db,
            root,
            llm,
            slots: Arc::new(Semaphore::new(2)),
            admitted: Mutex::new(HashMap::new()),
            wake: tokio::sync::Notify::new(),
        })
    }
    pub(crate) fn wake(&self) {
        self.wake.notify_one();
    }
    pub(super) fn stream(&self) -> Arc<ai::stream::Hub> {
        self.stream.clone()
    }
    pub(crate) fn cancel(&self, id: &str) {
        if let Ok(admitted) = self.admitted.lock()
            && let Some(a) = admitted.get(id)
        {
            a.token.cancel();
        }
        self.wake();
    }
    fn admit(&self, run: &str, connection: &str) -> Result<Option<CancellationToken>, AiError> {
        let mut admitted = self.admitted.lock().map_err(|_| AiError::StorageFailed)?;
        if let Some(existing) = admitted.get(run) {
            return Ok(Some(existing.token.clone()));
        }
        if admitted.values().any(|a| a.connection == connection) {
            return Ok(None);
        }
        let Ok(permit) = self.slots.clone().try_acquire_owned() else {
            return Ok(None);
        };
        let token = CancellationToken::new();
        admitted.insert(
            run.into(),
            Admission {
                token: token.clone(),
                connection: connection.into(),
                _permit: permit,
            },
        );
        Ok(Some(token))
    }
    fn release(&self, run: &str) {
        if let Ok(mut admitted) = self.admitted.lock() {
            admitted.remove(run);
        }
        self.wake();
    }

    pub(super) async fn dispatch(&self, queue: &mut SqliteStorage<RunJob>) -> Result<(), AiError> {
        let now = now();
        // Inspect all eligible intents: a long queue for connection A must not
        // hide runnable work for B behind an arbitrary first-page limit.
        let runs = ai_run::Entity::find()
            .filter(ai_run::Column::Status.eq("queued"))
            .filter(ai_run::Column::DispatchAfter.lte(now))
            .order_by_asc(ai_run::Column::CreatedAt)
            .all(&self.db)
            .await?;
        for run in runs {
            let config: Configuration =
                serde_json::from_value(run.configuration).map_err(|_| AiError::StorageFailed)?;
            if self
                .admit(&run.id, &config.selection.connection_id)?
                .is_none()
            {
                continue;
            }
            let pushed = queue
                .push_task(
                    TaskBuilder::new(RunJob {
                        run_id: run.id.clone(),
                    })
                    .max_attempts(1)
                    .build(),
                )
                .await
                .is_ok();
            // On lost responses the same intent is dispatched again. The run
            // CAS, rather than queue delivery, is the side-effect boundary.
            use sea_orm::sea_query::Expr;
            ai_run::Entity::update_many()
                .col_expr(ai_run::Column::DispatchAfter, Expr::value(now + 30))
                .col_expr(
                    ai_run::Column::DispatchedAt,
                    Expr::value(pushed.then_some(now)),
                )
                .filter(ai_run::Column::Id.eq(&run.id))
                .filter(ai_run::Column::Status.eq("queued"))
                .exec(&self.db)
                .await?;
            if !pushed {
                self.release(&run.id);
            }
        }
        // Queued cancellation can leave an admission without a future handler.
        let ids: Vec<_> = self
            .admitted
            .lock()
            .map_err(|_| AiError::StorageFailed)?
            .keys()
            .cloned()
            .collect();
        for id in ids {
            let row = ai_run::Entity::find_by_id(&id).one(&self.db).await?;
            if row.is_none_or(|r| !matches!(r.status.as_str(), "queued" | "running" | "cancelling"))
            {
                self.release(&id);
            }
        }
        Ok(())
    }

    async fn handle(&self, job: RunJob) -> Result<(), AiError> {
        let row = ai_run::Entity::find_by_id(&job.run_id)
            .one(&self.db)
            .await?
            .ok_or(AiError::NotFound)?;
        if row.status != "queued" {
            return Ok(());
        }
        let config: Configuration =
            serde_json::from_value(row.configuration).map_err(|_| AiError::StorageFailed)?;
        let Some(token) = self.admit(&job.run_id, &config.selection.connection_id)? else {
            return Ok(());
        };
        let Some(lease) = ai::runs::claim(&self.db, &job.run_id, &self.owner.id).await? else {
            return Ok(());
        };
        let lease = lease.with_stream(self.stream.clone());
        let _ = self.stream.publish(lease.session_id()).await;
        let _active = ActiveRun {
            runtime: self,
            id: &job.run_id,
            token: token.clone(),
        };
        let workers = Arc::new(Semaphore::new(1));
        let llm = self.llm.clone();
        let db = self.db.clone();
        let wire_lease = lease.clone();
        let wire_token = token.clone();
        let configured = tauri::async_runtime::spawn_blocking(move || {
            let connection = llm
                .acquire_for_run(&config.selection)
                .map_err(|_| RunFailure::ConfigurationUnavailable)?;
            if connection.connection.revision != config.revision {
                return Err(RunFailure::ConfigurationChanged);
            }
            let account = Arc::new(move |bytes: usize| {
                if wire_token.is_cancelled() {
                    return Err(crate::llm::LlmError::TooLarge);
                }
                tauri::async_runtime::block_on(async {
                    let tx = db.begin().await?;
                    ai::runs::charge(
                        &tx,
                        &wire_lease,
                        ai::budget::Charge::Wire {
                            input_bytes: u32::try_from(bytes)
                                .map_err(|_| AiError::BudgetExhausted)?,
                        },
                    )
                    .await?;
                    ai::runs::commit(tx, &wire_lease).await
                })
                .map_err(|_: AiError| crate::llm::LlmError::TooLarge)
            });
            let model = crate::llm::configured_model(&connection, Some(account))
                .map_err(|_| RunFailure::ConfigurationUnavailable)?;
            Ok((connection, model))
        })
        .await
        .map_err(|_| AiError::StorageFailed)?;
        let outcome = match configured {
            Err(error) => Err(error),
            Ok((connection, model)) => {
                let task_model = ai::tasks::Model {
                    client: model,
                    generation: crate::chapter_analysis::Generation {
                        model: connection.model.clone(),
                        completion_options: connection
                            .completion_options()
                            .map_err(|_| AiError::InvalidRequest)?,
                    },
                };
                ai::tasks::Execution {
                    #[cfg(test)]
                    experiment: None,
                    db: &self.db,
                    root: &self.root,
                    lease: &lease,
                    token: &token,
                    workers: workers.clone(),
                }
                .execute(task_model)
                .await
            }
        };
        self.settle(&lease, &token, &workers, outcome).await
    }

    async fn settle(
        &self,
        lease: &ai::runs::Lease,
        token: &CancellationToken,
        workers: &Semaphore,
        outcome: Result<(), RunFailure>,
    ) -> Result<(), AiError> {
        token.cancel();
        let _drained = workers
            .acquire()
            .await
            .map_err(|_| AiError::StorageFailed)?;
        if outcome.is_ok()
            && ai_run::Entity::find_by_id(lease.run_id())
                .one(&self.db)
                .await?
                .is_some_and(|r| r.status == "waiting_for_input")
        {
            return Ok(());
        }
        let status = match outcome {
            Ok(()) => RunStatus::WaitingForInput,
            Err(RunFailure::Cancelled) => RunStatus::Cancelled,
            _ => RunStatus::Failed,
        };
        // Keep admission until the terminal commit. If this write fails the
        // started run stays interrupted/recoverable, never automatically rerun.
        let finished = ai::runs::finish(&self.db, lease, status, outcome.err()).await;
        finished.map(|_| ())
    }
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub(super) fn start(runtime: Arc<Runtime>, queue: SqliteStorage<RunJob>) {
    tauri::async_runtime::spawn(runtime.stream.clone().watch());
    let handler = runtime.clone();
    let worker_queue = queue.clone();
    let worker = WorkerBuilder::new("local-ai")
        .backend(worker_queue.poll_with_interval(Duration::from_millis(250)))
        .concurrency(2)
        .parallelize(|future| tokio::spawn(future))
        .data(handler)
        .build(|job: RunJob, runtime: Data<Arc<Runtime>>| async move {
            // A started model run is never retried by queue middleware.
            // Safe pre-claim failures remain queued for the dispatcher.
            let _ = runtime.handle(job).await;
        });
    tauri::async_runtime::spawn(worker.run());
    tauri::async_runtime::spawn(async move {
        let mut queue = queue;
        loop {
            let _ = runtime.dispatch(&mut queue).await;
            tokio::select! { () = runtime.wake.notified() => {}, () = tokio::time::sleep(Duration::from_secs(1)) => {} }
        }
    });
}

#[cfg(test)]
mod tests;
