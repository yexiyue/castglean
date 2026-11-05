//! Bounded authority for job identity, replay and cancellation.
use super::*;
use std::collections::BTreeMap;
use tokio::sync::watch;

struct Slot {
    key: String,
    job: StudioJob,
    cancel: watch::Sender<bool>,
}
#[derive(Default)]
pub(super) struct Tasks {
    next: u32,
    revision: u32,
    slots: BTreeMap<u32, Slot>,
}
impl Tasks {
    pub fn cancelled(&self, id: u32) -> bool {
        self.slots
            .get(&id)
            .is_none_or(|slot| *slot.cancel.borrow() || slot.job.state.terminal())
    }
    pub fn revision(&self) -> u32 {
        self.revision
    }
    pub fn active(&self) -> bool {
        self.slots.values().any(|s| !s.job.state.terminal())
    }
    pub fn snapshots(&self) -> Vec<StudioJob> {
        self.slots.values().map(|s| s.job.clone()).collect()
    }
    pub fn begin(
        &mut self,
        key: String,
        request: StudioRequest,
    ) -> Result<(StudioJob, bool), String> {
        if key.is_empty() || key.len() > 128 {
            return Err("invalid request identity".into());
        }
        if let Some(slot) = self.slots.values().find(|s| s.key == key) {
            return if slot.job.request == request {
                Ok((slot.job.clone(), false))
            } else {
                Err("request identity already used with different input".into())
            };
        }
        if self
            .slots
            .values()
            .filter(|s| !s.job.state.terminal())
            .count()
            >= 5
        {
            return Err("inference queue is full".into());
        }
        if self.slots.len() >= 32 {
            return Err("dismiss completed tasks first".into());
        }
        self.revision = self.revision.checked_add(1).ok_or("sequence exhausted")?;
        self.next = self.next.checked_add(1).ok_or("job identity exhausted")?;
        let job = StudioJob {
            id: self.next,
            sequence: self.revision,
            request,
            state: JobState::Queued,
            stage: "queued".into(),
            resource: None,
            error: None,
            candidate: None,
            audio: None,
        };
        let (cancel, _) = watch::channel(false);
        self.slots.insert(
            job.id,
            Slot {
                key,
                job: job.clone(),
                cancel,
            },
        );
        Ok((job, true))
    }
    pub fn cancellation(&self, id: u32) -> Result<watch::Receiver<bool>, String> {
        Ok(self.slots.get(&id).ok_or("unknown job")?.cancel.subscribe())
    }
    pub fn update(
        &mut self,
        id: u32,
        state: JobState,
        stage: &str,
        result: Option<JobResult>,
    ) -> Option<StudioJob> {
        let slot = self.slots.get_mut(&id)?;
        if slot.job.state.terminal() {
            return None;
        }
        if slot.job.state == JobState::Cancelling && state == JobState::Running {
            return None;
        }
        slot.job.state = state;
        slot.job.stage = stage.into();
        self.revision = self.revision.checked_add(1)?;
        slot.job.sequence = self.revision;
        if let Some(result) = result {
            match result {
                Ok(output) => {
                    slot.job.candidate = output.candidate;
                    slot.job.audio = output.audio;
                }
                Err(error) => slot.job.error = Some(error),
            }
        }
        Some(slot.job.clone())
    }
    pub fn resource_progress(
        &mut self,
        id: u32,
        resource: crate::engine::ResourceState,
    ) -> Option<StudioJob> {
        self.update(id, JobState::Running, "downloading", None)?;
        let job = &mut self.slots.get_mut(&id)?.job;
        job.resource = Some(resource);
        Some(job.clone())
    }
    pub fn dismiss(&mut self, id: u32) -> Result<StudioJob, String> {
        let slot = self.slots.get(&id).ok_or("unknown job")?;
        if !slot.job.state.terminal() {
            return Err("job is still active".into());
        }
        self.revision = self.revision.checked_add(1).ok_or("sequence exhausted")?;
        Ok(self.slots.remove(&id).unwrap().job)
    }
    pub fn cancel(&mut self, id: u32) -> Result<StudioJob, String> {
        let slot = self.slots.get_mut(&id).ok_or("unknown job")?;
        if !slot.job.state.terminal() {
            slot.cancel.send_replace(true);
            slot.job.state = JobState::Cancelling;
            self.revision = self.revision.checked_add(1).ok_or("sequence exhausted")?;
            slot.job.sequence = self.revision;
        }
        Ok(slot.job.clone())
    }
}

/// Cancellation can interrupt queueing, but active work must finish its own teardown.
pub(super) async fn exclusive<T, F, Fut>(
    gate: &tokio::sync::Semaphore,
    mut cancel: watch::Receiver<bool>,
    work: F,
) -> Result<T, String>
where
    F: FnOnce(watch::Receiver<bool>) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let _permit = tokio::select! {
        permit = gate.acquire() => permit.map_err(|_| "inference queue closed")?,
        _ = cancelled(&mut cancel) => return Err("cancelled".into()),
    };
    if *cancel.borrow() {
        return Err("cancelled".into());
    }
    work(cancel).await
}

pub(super) async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    if *cancel.borrow() {
        return;
    }
    while cancel.changed().await.is_ok() {
        if *cancel.borrow() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancelling_work_holds_slot_until_backend_teardown_finishes() {
        use std::sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        };
        use tokio::sync::Notify;
        let gate = Arc::new(tokio::sync::Semaphore::new(1));
        let entered = Arc::new(Notify::new());
        let closing = Arc::new(Notify::new());
        let closed = Arc::new(Notify::new());
        let (cancel, receiver) = watch::channel(false);
        let first = tokio::spawn({
            let gate = gate.clone();
            let entered = entered.clone();
            let closing = closing.clone();
            let closed = closed.clone();
            async move {
                exclusive(&gate, receiver, |mut cancel| async move {
                    entered.notify_one();
                    cancelled(&mut cancel).await;
                    closing.notify_one();
                    closed.notified().await;
                    Err::<(), _>("cancelled".into())
                })
                .await
            }
        });
        entered.notified().await;
        cancel.send_replace(true);
        closing.notified().await;
        let started = Arc::new(AtomicBool::new(false));
        let (_second_cancel, receiver) = watch::channel(false);
        let second = exclusive(&gate, receiver, |_| async {
            started.store(true, Ordering::SeqCst);
            Ok(())
        });
        tokio::pin!(second);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut second)
                .await
                .is_err()
        );
        assert!(!started.load(Ordering::SeqCst));
        assert!(!first.is_finished());
        closed.notify_one();
        assert_eq!(first.await.unwrap(), Err("cancelled".into()));
        second.await.unwrap();
        assert!(started.load(Ordering::SeqCst));
    }

    #[test]
    fn queue_budget_is_bounded_and_replay_does_not_consume_another_slot() {
        let mut tasks = Tasks::default();
        let request = StudioRequest::PrepareDesign {
            engine: "fake".into(),
        };
        for key in 0..5 {
            tasks.begin(key.to_string(), request.clone()).unwrap();
        }
        assert!(tasks.begin("overflow".into(), request.clone()).is_err());
        assert!(!tasks.begin("0".into(), request.clone()).unwrap().1);
        tasks.cancel(1).unwrap();
        assert!(tasks.begin("still-full".into(), request.clone()).is_err());
        tasks
            .update(1, JobState::Cancelled, "cancelled", None)
            .unwrap();
        assert!(tasks.begin("released".into(), request).unwrap().1);
    }
    #[test]
    fn replay_cancel_and_late_updates_preserve_identity() {
        let mut tasks = Tasks::default();
        let request = StudioRequest::PrepareDesign {
            engine: "fake".into(),
        };
        let (job, created) = tasks.begin("one".into(), request.clone()).unwrap();
        assert!(created);
        assert!(!tasks.begin("one".into(), request).unwrap().1);
        let receiver = tasks.cancellation(job.id).unwrap();
        tasks.cancel(job.id).unwrap();
        assert!(*receiver.borrow());
        assert!(tasks.active());
        assert!(
            tasks
                .update(job.id, JobState::Running, "late progress", None)
                .is_none()
        );
        tasks
            .update(job.id, JobState::Cancelled, "cancelled", None)
            .unwrap();
        assert!(!tasks.active());
        assert!(
            tasks
                .update(job.id, JobState::Succeeded, "late", None)
                .is_none()
        );
    }
}
