//! Bounded delivery of committed message changes. SQLite is the recovery authority.
use super::{AiError, HistoryPage, Message, RunInfo, SessionInfo, history, messages::MessagePart};
use sea_orm::DatabaseConnection;
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};
use tokio::sync::{Mutex, mpsc, watch};

const SESSIONS: usize = 32;
const BYTES: usize = 1024 * 1024;
const WINDOW: u32 = 8;
const FRAMES: usize = WINDOW as usize;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum StreamChange {
    Message {
        message: Message,
    },
    TextDelta {
        message_id: String,
        from_version: u32,
        version: u32,
        part: u32,
        offset_utf16: u32,
        text: String,
    },
}
#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum StreamEvent {
    Update {
        version: u32,
        session_id: String,
        run_id: Option<String>,
        sequence: u32,
        session: Box<SessionInfo>,
        run: Option<Box<RunInfo>>,
        changes: Vec<StreamChange>,
    },
    ResyncRequired {
        version: u32,
        session_id: String,
        run_id: Option<String>,
        sequence: u32,
    },
}
impl StreamEvent {
    fn run_id(&self) -> Option<String> {
        match self {
            Self::Update { run_id, .. } | Self::ResyncRequired { run_id, .. } => run_id.clone(),
        }
    }
    fn sequence(&self) -> u32 {
        match self {
            Self::Update { sequence, .. } | Self::ResyncRequired { sequence, .. } => *sequence,
        }
    }
}
struct Subscriber {
    queue: mpsc::Sender<Arc<StreamEvent>>,
    control: watch::Sender<Option<Arc<StreamEvent>>>,
    acknowledged: u32,
    sent: u32,
}
pub(crate) struct Subscription {
    queue: mpsc::Receiver<Arc<StreamEvent>>,
    control: watch::Receiver<Option<Arc<StreamEvent>>>,
    stopped: bool,
}
impl Subscription {
    pub(crate) async fn next(&mut self) -> Option<Arc<StreamEvent>> {
        if self.stopped {
            return None;
        }
        loop {
            if let Some(event) = self.control.borrow_and_update().clone() {
                self.stopped = true;
                return Some(event);
            }
            tokio::select! {
                biased;
                changed=self.control.changed()=>{
                    if changed.is_err() {
                        let event=self.control.borrow().clone();self.stopped=true;return event;
                    }
                }
                event=self.queue.recv()=>return event,
            }
        }
    }
}
struct Buffer {
    sequence: u32,
    run_id: Option<String>,
    messages: HashMap<String, Message>,
    frames: VecDeque<(Arc<StreamEvent>, usize)>,
    bytes: usize,
    subscribers: HashMap<String, Subscriber>,
}
#[derive(Default)]
struct State {
    sessions: HashMap<String, Buffer>,
    order: VecDeque<String>,
}
pub(crate) struct Hub {
    db: DatabaseConnection,
    state: Mutex<State>,
}
impl std::fmt::Debug for Hub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AiStreamHub").finish_non_exhaustive()
    }
}
fn resync(session: &str, sequence: u32, run_id: Option<String>) -> Arc<StreamEvent> {
    Arc::new(StreamEvent::ResyncRequired {
        version: 1,
        session_id: session.into(),
        run_id,
        sequence,
    })
}
fn change(old: Option<&Message>, new: &Message) -> StreamChange {
    if let Some(old) = old
        && old.status == new.status
        && old.role == new.role
        && old.run_id == new.run_id
        && old.parts.parts().len() == new.parts.parts().len()
        && old.version < new.version
        && let Some((last, rest)) = new.parts.parts().split_last()
        && old.parts.parts()[..rest.len()] == *rest
        && let (Some(MessagePart::Text { text: before }), MessagePart::Text { text: after }) =
            (old.parts.parts().last(), last)
        && after.len() > before.len()
        && after.starts_with(before)
    {
        return StreamChange::TextDelta {
            message_id: new.id.clone(),
            from_version: old.version,
            version: new.version,
            part: rest.len() as u32,
            offset_utf16: before.encode_utf16().count() as u32,
            text: after[before.len()..].into(),
        };
    }
    StreamChange::Message {
        message: new.clone(),
    }
}
impl Hub {
    pub(crate) fn new(db: DatabaseConnection) -> Arc<Self> {
        Arc::new(Self {
            db,
            state: Mutex::new(State::default()),
        })
    }

    async fn refresh<'a>(&self, state: &'a mut State, id: &str) -> Result<&'a mut Buffer, AiError> {
        // Holding this delivery lock across the read closes history/subscribe
        // races. Writers never acquire it until after their transaction commits.
        let snapshot = history::page(&self.db, id, None, 20).await?;
        if !state.sessions.contains_key(id) {
            if state.sessions.len() >= SESSIONS {
                let evict = state
                    .order
                    .iter()
                    .find(|id| {
                        state
                            .sessions
                            .get(*id)
                            .is_some_and(|b| b.subscribers.is_empty())
                    })
                    .cloned()
                    .ok_or(AiError::Busy)?;
                state.sessions.remove(&evict);
                state.order.retain(|id| id != &evict);
            }
            state.sessions.insert(
                id.into(),
                Buffer {
                    sequence: snapshot.session.sequence,
                    run_id: snapshot.run.as_ref().map(|r| r.id.clone()),
                    messages: snapshot
                        .messages
                        .iter()
                        .map(|m| (m.id.clone(), m.clone()))
                        .collect(),
                    frames: VecDeque::new(),
                    bytes: 0,
                    subscribers: HashMap::new(),
                },
            );
        } else {
            let buffer = state.sessions.get_mut(id).ok_or(AiError::StorageFailed)?;
            Self::publish_snapshot(buffer, snapshot)?;
        }
        state.order.retain(|entry| entry != id);
        state.order.push_back(id.into());
        state.sessions.get_mut(id).ok_or(AiError::StorageFailed)
    }
    fn publish_snapshot(buffer: &mut Buffer, snapshot: HistoryPage) -> Result<(), AiError> {
        let sequence = snapshot.session.sequence;
        if sequence <= buffer.sequence {
            return Ok(());
        }
        let id = snapshot.session.id.clone();
        let run_id = snapshot.run.as_ref().map(|r| r.id.clone());
        let event = if buffer.sequence.checked_add(1) != Some(sequence) {
            buffer.frames.clear();
            buffer.bytes = 0;
            resync(&id, sequence, run_id.clone())
        } else {
            let changes = snapshot
                .messages
                .iter()
                .filter(|m| {
                    buffer
                        .messages
                        .get(&m.id)
                        .is_none_or(|old| old.version != m.version)
                })
                .map(|m| change(buffer.messages.get(&m.id), m))
                .collect();
            Arc::new(StreamEvent::Update {
                version: 1,
                session_id: id.clone(),
                run_id: snapshot.run.as_ref().map(|r| r.id.clone()),
                sequence,
                session: Box::new(snapshot.session),
                run: snapshot.run.map(Box::new),
                changes,
            })
        };
        let size = serde_json::to_vec(event.as_ref())
            .map_err(|_| AiError::StorageFailed)?
            .len();
        let (event, size) = if size > BYTES {
            buffer.frames.clear();
            buffer.bytes = 0;
            let event = resync(&id, sequence, run_id.clone());
            let size = serde_json::to_vec(event.as_ref())
                .map_err(|_| AiError::StorageFailed)?
                .len();
            (event, size)
        } else {
            (event, size)
        };
        buffer.sequence = sequence;
        buffer.run_id = run_id;
        buffer.messages = snapshot
            .messages
            .into_iter()
            .map(|m| (m.id.clone(), m))
            .collect();
        buffer.frames.push_back((event.clone(), size));
        buffer.bytes += size;
        while buffer.frames.len() > FRAMES || buffer.bytes > BYTES {
            if let Some((_, size)) = buffer.frames.pop_front() {
                buffer.bytes -= size;
            }
        }
        buffer
            .subscribers
            .retain(|_, subscriber| Self::deliver(subscriber, event.clone(), &id));
        Ok(())
    }
    fn deliver(subscriber: &mut Subscriber, event: Arc<StreamEvent>, id: &str) -> bool {
        let sequence = event.sequence();
        if matches!(event.as_ref(), StreamEvent::ResyncRequired { .. })
            || sequence != subscriber.sent.saturating_add(1)
            || subscriber.sent.saturating_sub(subscriber.acknowledged) >= WINDOW
            || subscriber.queue.try_send(event.clone()).is_err()
        {
            subscriber
                .control
                .send_replace(Some(resync(id, sequence, event.run_id())));
            return false;
        }
        subscriber.sent = sequence;
        true
    }
    /// Notification is best effort; a later subscribe/watch reconciles against
    /// the persisted cursor and explicitly requests resync if a gap occurred.
    pub(crate) async fn publish(&self, id: &str) -> Result<(), AiError> {
        let mut state = self.state.lock().await;
        self.refresh(&mut state, id).await.map(|_| ())
    }
    pub(crate) async fn subscribe(
        &self,
        id: &str,
        subscription: &str,
        after: u32,
    ) -> Result<Subscription, AiError> {
        uuid::Uuid::parse_str(subscription).map_err(|_| AiError::InvalidRequest)?;
        let mut state = self.state.lock().await;
        let buffer = self.refresh(&mut state, id).await?;
        if after > buffer.sequence {
            return Err(AiError::InvalidRequest);
        }
        if buffer.subscribers.len() >= 8 || buffer.subscribers.contains_key(subscription) {
            return Err(AiError::Busy);
        }
        let (queue, receiver) = mpsc::channel(WINDOW as usize);
        let (control, controls) = watch::channel(None);
        let mut subscriber = Subscriber {
            queue,
            control,
            acknowledged: after,
            sent: after,
        };
        let mut complete = true;
        for (event, _) in buffer.frames.iter().filter(|(e, _)| e.sequence() > after) {
            if !Self::deliver(&mut subscriber, event.clone(), id) {
                subscriber.control.send_replace(Some(resync(
                    id,
                    buffer.sequence,
                    buffer.run_id.clone(),
                )));
                complete = false;
                break;
            }
        }
        if complete && subscriber.sent != buffer.sequence {
            subscriber.control.send_replace(Some(resync(
                id,
                buffer.sequence,
                buffer.run_id.clone(),
            )));
            complete = false;
        }
        if complete {
            buffer.subscribers.insert(subscription.into(), subscriber);
        }
        Ok(Subscription {
            queue: receiver,
            control: controls,
            stopped: false,
        })
    }
    pub(crate) async fn acknowledge(
        &self,
        id: &str,
        subscription: &str,
        sequence: u32,
    ) -> Result<(), AiError> {
        let mut state = self.state.lock().await;
        if let Some(subscriber) = state
            .sessions
            .get_mut(id)
            .and_then(|b| b.subscribers.get_mut(subscription))
        {
            if sequence > subscriber.sent {
                return Err(AiError::InvalidRequest);
            }
            subscriber.acknowledged = subscriber.acknowledged.max(sequence);
        }
        Ok(())
    }
    pub(crate) async fn unsubscribe(&self, id: &str, subscription: &str) {
        if let Some(buffer) = self.state.lock().await.sessions.get_mut(id) {
            buffer.subscribers.remove(subscription);
        }
    }
    pub(crate) async fn watch(self: Arc<Self>) {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let ids: Vec<_> = self
                .state
                .lock()
                .await
                .sessions
                .iter()
                .filter(|(_, b)| !b.subscribers.is_empty())
                .map(|(id, _)| id.clone())
                .collect();
            for id in ids {
                let _ = self.publish(&id).await;
            }
        }
    }
}

#[cfg(test)]
mod tests;
