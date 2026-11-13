//! A failed queue consumer must not leave the independent dispatcher running alone.
use super::{RunJob, Runtime};
use apalis::prelude::*;
use apalis_sqlite::SqliteStorage;
use std::{sync::Arc, time::Duration};

const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const STABLE_AFTER: Duration = Duration::from_secs(60);

fn spawn_consumer(
    workers: &mut tokio::task::JoinSet<Result<(), WorkerError>>,
    runtime: Arc<Runtime>,
    queue: SqliteStorage<RunJob>,
    name: String,
) {
    let worker = WorkerBuilder::new(name)
        .backend(queue.poll_with_interval(Duration::from_millis(250)))
        .concurrency(2)
        .parallelize(|future| tokio::spawn(future))
        .data(runtime)
        .build(|job: RunJob, runtime: Data<Arc<Runtime>>| async move {
            let run_id = job.run_id.clone();
            if let Err(error) = runtime.handle(job).await {
                tracing::warn!(event = "ai_queue_handler_failed", run_id, error_code = %error);
            }
        });
    workers.spawn(worker.run());
}

/// Recreate only queue infrastructure. Active application leases and requests
/// stay owned by the same Runtime; duplicate deliveries still pass its run CAS.
pub(super) async fn supervise(runtime: Arc<Runtime>, queue: SqliteStorage<RunJob>) {
    let mut workers = tokio::task::JoinSet::new();
    let mut generation = 0u64;
    let mut backoff = MIN_BACKOFF;
    loop {
        generation = generation.saturating_add(1);
        // A recently alive previous registration must not block replacement.
        let worker_id = format!("local-ai-{}-{generation}", runtime.owner.id);
        let started = tokio::time::Instant::now();
        tracing::info!(event = "ai_queue_consumer_starting", worker_id, generation);
        spawn_consumer(&mut workers, runtime.clone(), queue.clone(), worker_id);
        let outcome = workers.join_next().await.expect("one consumer was spawned");
        let reason = match outcome {
            Ok(Ok(())) => "unexpected_exit",
            Ok(Err(_)) => "queue_error",
            Err(error) if error.is_panic() => "panic",
            Err(_) => "cancelled",
        };
        if started.elapsed() >= STABLE_AFTER {
            backoff = MIN_BACKOFF;
        }
        tracing::warn!(
            event = "ai_queue_consumer_restarting",
            generation,
            reason,
            retry_after_ms = backoff.as_millis() as u64,
        );
        tokio::time::sleep(backoff).await;
        backoff = backoff.saturating_mul(2).min(MAX_BACKOFF);
    }
}
