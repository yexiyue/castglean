//! Bounded AG-UI delivery. Rejoining restores committed facts and never starts work.
use super::{
    AiError, history,
    protocol::{self, AgentPage},
};
use sea_orm::DatabaseConnection;
use serde::Serialize;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{Mutex, mpsc, watch};

const SESSIONS: usize = 32;
const WINDOW: u32 = 8;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum AgentFrame {
    Events {
        cursor: u32,
        restore: bool,
        page: Box<AgentPage>,
        #[specta(type = Vec<specta_typescript::Unknown>)]
        events: Vec<serde_json::Value>,
    },
    Reset {
        cursor: u32,
    },
}
impl AgentFrame {
    #[cfg(test)]
    fn cursor(&self) -> u32 {
        match self {
            Self::Events { cursor, .. } | Self::Reset { cursor } => *cursor,
        }
    }
}
struct Subscriber {
    queue: mpsc::Sender<Arc<AgentFrame>>,
    control: watch::Sender<Option<Arc<AgentFrame>>>,
    acknowledged: u32,
    sent: u32,
}
pub(crate) struct Subscription {
    queue: mpsc::Receiver<Arc<AgentFrame>>,
    control: watch::Receiver<Option<Arc<AgentFrame>>>,
    stopped: bool,
}
impl Subscription {
    pub(crate) async fn next(&mut self) -> Option<Arc<AgentFrame>> {
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
                changed = self.control.changed() => {
                    if changed.is_err() {
                        let event = self.control.borrow().clone();
                        self.stopped = true; return event;
                    }
                }
                event = self.queue.recv() => return event,
            }
        }
    }
}
struct Buffer {
    page: AgentPage,
    subscribers: HashMap<String, Subscriber>,
}
#[derive(Default)]
struct State {
    sessions: HashMap<String, Buffer>,
}
pub(crate) struct Hub {
    db: DatabaseConnection,
    state: Mutex<State>,
}
impl std::fmt::Debug for Hub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentHub").finish_non_exhaustive()
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
        // The delivery lock closes snapshot/subscribe races. Writers notify only after commit.
        let history = history::page(&self.db, id, None, 20).await?;
        let page = protocol::page(&self.db, history).await?;
        if let Some(buffer) = state.sessions.get_mut(id) {
            if page.session.sequence > buffer.page.session.sequence {
                let cursor = page.session.sequence;
                let frame = Arc::new(AgentFrame::Events {
                    cursor,
                    restore: false,
                    events: protocol::update(&buffer.page, &page)?,
                    page: Box::new(page.clone()),
                });
                buffer.subscribers.retain(|_, subscriber| {
                    if cursor != subscriber.sent.saturating_add(1)
                        || subscriber.sent.saturating_sub(subscriber.acknowledged) >= WINDOW
                        || subscriber.queue.try_send(frame.clone()).is_err()
                    {
                        subscriber
                            .control
                            .send_replace(Some(Arc::new(AgentFrame::Reset { cursor })));
                        false
                    } else {
                        subscriber.sent = cursor;
                        true
                    }
                });
                buffer.page = page;
            }
        } else {
            if state.sessions.len() >= SESSIONS {
                let evict = state
                    .sessions
                    .iter()
                    .find(|(_, buffer)| buffer.subscribers.is_empty())
                    .map(|(id, _)| id.clone())
                    .ok_or(AiError::Busy)?;
                state.sessions.remove(&evict);
            }
            state.sessions.insert(
                id.into(),
                Buffer {
                    page,
                    subscribers: HashMap::new(),
                },
            );
        }
        state.sessions.get_mut(id).ok_or(AiError::StorageFailed)
    }
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
        let cursor = buffer.page.session.sequence;
        if after > cursor {
            return Err(AiError::InvalidRequest);
        }
        if buffer.subscribers.len() >= 8 || buffer.subscribers.contains_key(subscription) {
            return Err(AiError::Busy);
        }
        let (queue, receiver) = mpsc::channel(WINDOW as usize);
        let (control, controls) = watch::channel(None);
        queue
            .try_send(Arc::new(AgentFrame::Events {
                cursor,
                restore: true,
                events: protocol::restore(&buffer.page)?,
                page: Box::new(buffer.page.clone()),
            }))
            .map_err(|_| AiError::StorageFailed)?;
        buffer.subscribers.insert(
            subscription.into(),
            Subscriber {
                queue,
                control,
                acknowledged: cursor,
                sent: cursor,
            },
        );
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
        cursor: u32,
    ) -> Result<(), AiError> {
        let mut state = self.state.lock().await;
        if let Some(subscriber) = state
            .sessions
            .get_mut(id)
            .and_then(|buffer| buffer.subscribers.get_mut(subscription))
        {
            if cursor > subscriber.sent {
                return Err(AiError::InvalidRequest);
            }
            subscriber.acknowledged = subscriber.acknowledged.max(cursor);
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
                .filter(|(_, buffer)| !buffer.subscribers.is_empty())
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
