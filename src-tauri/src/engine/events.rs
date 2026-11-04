//! 模型资源的有序 Channel 与重连快照。任务身份和序号由宿主分配。
use super::{EngineState, ModelEntry, ResourceState};
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex};
use tauri::{Manager, ipc::Channel};

#[derive(Debug, Clone, Serialize, specta::Type)]
pub(crate) struct ModelResourceUpdate {
    pub backend: String,
    pub model: String,
    pub task_id: u32,
    pub sequence: u32,
    pub state: ResourceState,
}
#[derive(Clone, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum ModelResourceMessage {
    Snapshot {
        entries: Vec<ModelEntry>,
        updates: Vec<ModelResourceUpdate>,
    },
    Update {
        update: ModelResourceUpdate,
    },
}
struct Subscriber {
    owner: String,
    channel: Channel<ModelResourceMessage>,
}
#[derive(Default)]
struct Stream {
    sequence: u32,
    next_subscription: u32,
    latest: HashMap<(String, String), ModelResourceUpdate>,
    subscribers: HashMap<u32, Subscriber>,
}
#[derive(Default)]
pub(crate) struct ModelStream(Mutex<Stream>);
impl ModelStream {
    pub fn sequence(&self) -> u32 {
        self.0.lock().expect("model stream lock").sequence
    }
    pub fn clear(&self) {
        self.0.lock().expect("model stream lock").latest.clear();
    }
    pub fn disconnect(&self, owner: &str) {
        self.0
            .lock()
            .expect("model stream lock")
            .subscribers
            .retain(|_, subscriber| subscriber.owner != owner);
    }
    pub fn subscribe(
        &self,
        owner: String,
        channel: Channel<ModelResourceMessage>,
        mut entries: Vec<ModelEntry>,
        since: u32,
    ) -> Result<u32, String> {
        let mut stream = self.0.lock().map_err(|_| "model stream unavailable")?;
        if stream.subscribers.len() >= 16 {
            return Err("too many model subscriptions".into());
        }
        for entry in &mut entries {
            if let Some(update) = stream
                .latest
                .get(&(entry.backend.clone(), entry.model.clone()))
                && update.sequence > since
            {
                entry.resource = update.state.clone();
            }
        }
        channel
            .send(ModelResourceMessage::Snapshot {
                entries,
                updates: stream.latest.values().cloned().collect(),
            })
            .map_err(|_| "model channel unavailable")?;
        stream.next_subscription = stream
            .next_subscription
            .checked_add(1)
            .ok_or("subscription limit")?;
        let id = stream.next_subscription;
        stream.subscribers.insert(id, Subscriber { owner, channel });
        Ok(id)
    }
    pub fn unsubscribe(&self, owner: &str, id: u32) {
        let mut stream = self.0.lock().expect("model stream lock");
        if stream
            .subscribers
            .get(&id)
            .is_some_and(|s| s.owner == owner)
        {
            stream.subscribers.remove(&id);
        }
    }
    fn publish(
        &self,
        mut update: ModelResourceUpdate,
        expected: Option<u32>,
        state: &EngineState,
    ) -> u32 {
        let mut stream = self.0.lock().expect("model stream lock");
        let key = (update.backend.clone(), update.model.clone());
        if let Some(task) = expected
            && !stream.latest.get(&key).is_some_and(|last| {
                last.task_id == task && matches!(last.state, ResourceState::Downloading { .. })
            })
        {
            return task;
        }
        stream.sequence = stream
            .sequence
            .checked_add(1)
            .expect("model sequence exhausted");
        update.task_id = expected.unwrap_or(stream.sequence);
        update.sequence = stream.sequence;
        state.record_task_state(&update.backend, &update.model, update.state.clone());
        stream.latest.insert(key, update.clone());
        let task_id = update.task_id;
        let message = ModelResourceMessage::Update { update };
        stream
            .subscribers
            .retain(|_, subscriber| subscriber.channel.send(message.clone()).is_ok());
        task_id
    }
}
impl ModelResourceUpdate {
    pub(crate) fn publish(self, app: &tauri::AppHandle) -> u32 {
        let state = app.state::<EngineState>();
        state.model_stream.publish(self, None, &state)
    }
    pub(crate) fn publish_for(self, app: &tauri::AppHandle, task: u32) {
        let state = app.state::<EngineState>();
        state.model_stream.publish(self, Some(task), &state);
    }
    pub(crate) fn progress(
        backend: &str,
        model: &str,
        downloaded: f64,
        total: f64,
        current_file: &str,
    ) -> Self {
        Self::state(
            backend,
            model,
            ResourceState::Downloading {
                downloaded_bytes: downloaded,
                total_bytes: total,
                current_file: Some(current_file.into()),
            },
        )
    }
    pub(crate) fn state(backend: &str, model: &str, state: ResourceState) -> Self {
        Self {
            backend: backend.into(),
            model: model.into(),
            state,
            task_id: 0,
            sequence: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    fn state() -> (tempfile::TempDir, EngineState) {
        let root = tempfile::tempdir().unwrap();
        let state = EngineState::new(root.path().join("settings.json"), root.path().join("cache"));
        (root, state)
    }
    fn capture() -> (
        Channel<ModelResourceMessage>,
        Arc<Mutex<Vec<serde_json::Value>>>,
    ) {
        let values = Arc::new(Mutex::new(Vec::new()));
        let sink = values.clone();
        (
            Channel::new(move |body| {
                sink.lock().unwrap().push(body.deserialize().unwrap());
                Ok(())
            }),
            values,
        )
    }
    fn downloading(bytes: f64) -> ModelResourceUpdate {
        ModelResourceUpdate::progress("moss", "nano", bytes, 100.0, "weights")
    }
    fn entry(resource: ResourceState) -> ModelEntry {
        ModelEntry {
            backend: "moss".into(),
            model: "nano".into(),
            name: "model".into(),
            capabilities: super::super::ModelCapabilities {
                preset: false,
                reference_cloning: false,
                text_design: false,
                style: false,
            },
            voices: 0,
            resource,
            convertible_locally: false,
        }
    }
    #[test]
    fn reconnect_snapshot_covers_updates_racing_inventory_and_orders_later_delivery() {
        let (_root, state) = state();
        let stream = &state.model_stream;
        let since = stream.sequence();
        let task = stream.publish(downloading(40.0), None, &state);
        let (channel, values) = capture();
        stream
            .subscribe(
                "main".into(),
                channel,
                vec![entry(ResourceState::Missing {
                    missing_bytes: 100.0,
                })],
                since,
            )
            .unwrap();
        stream.publish(downloading(55.0), Some(task), &state);
        let values = values.lock().unwrap();
        assert_eq!(values[0]["type"], "snapshot");
        assert_eq!(
            values[0]["entries"][0]["resource"]["Downloading"]["downloaded_bytes"],
            40.0
        );
        assert_eq!(values[1]["type"], "update");
        assert!(
            values[1]["update"]["sequence"].as_u64() > values[0]["updates"][0]["sequence"].as_u64()
        );
    }
    #[test]
    fn terminal_state_cannot_be_revived_and_old_tasks_cannot_overwrite_retries() {
        let (_root, state) = state();
        let stream = &state.model_stream;
        let old = stream.publish(downloading(0.0), None, &state);
        stream.publish(
            ModelResourceUpdate::state("moss", "nano", ResourceState::Ready),
            Some(old),
            &state,
        );
        let terminal = stream.sequence();
        stream.publish(downloading(99.0), Some(old), &state);
        assert_eq!(stream.sequence(), terminal);
        let new = stream.publish(downloading(0.0), None, &state);
        stream.publish(
            ModelResourceUpdate::state("moss", "nano", ResourceState::Ready),
            Some(old),
            &state,
        );
        assert_eq!(stream.sequence(), new);
        assert!(matches!(
            state.task_state("moss", "nano"),
            Some(ResourceState::Downloading { .. })
        ));
    }
    #[test]
    fn disk_snapshot_is_not_overridden_by_historic_terminal_state() {
        let (_root, state) = state();
        let stream = &state.model_stream;
        stream.publish(
            ModelResourceUpdate::state("moss", "nano", ResourceState::Ready),
            None,
            &state,
        );
        let since = stream.sequence();
        let (channel, values) = capture();
        stream
            .subscribe(
                "main".into(),
                channel,
                vec![entry(ResourceState::Missing {
                    missing_bytes: 100.0,
                })],
                since,
            )
            .unwrap();
        assert!(
            values.lock().unwrap()[0]["entries"][0]["resource"]
                .get("Missing")
                .is_some()
        );
    }
    #[test]
    fn unsubscribe_is_owner_scoped_and_disconnected_subscribers_do_not_consume_budget() {
        let (_root, state) = state();
        let stream = &state.model_stream;
        let (channel, _) = capture();
        let id = stream.subscribe("main".into(), channel, vec![], 0).unwrap();
        stream.unsubscribe("other", id);
        assert_eq!(stream.0.lock().unwrap().subscribers.len(), 1);
        stream.disconnect("main");
        assert!(stream.0.lock().unwrap().subscribers.is_empty());
        let dead = Channel::new(|_| Err(tauri::Error::Io(std::io::Error::other("closed"))));
        assert!(stream.subscribe("main".into(), dead, vec![], 0).is_err());
        assert!(stream.0.lock().unwrap().subscribers.is_empty());
    }
}
