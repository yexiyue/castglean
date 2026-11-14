//! Short voice production: validated candidates, owned tasks, controlled media.
mod audio;
pub(crate) mod commands;
pub(crate) mod execution;
pub(crate) mod media;
mod preparation;
mod reference;
mod store;
mod tasks;
mod types;
mod waveform;
use std::sync::Mutex;
use tauri::Manager;
pub(crate) use types::*;

pub(crate) struct StudioState {
    store: Mutex<store::Store>,
    tasks: Mutex<tasks::Tasks>,
    references: Mutex<reference::ReferenceReceipts>,
}
impl StudioState {
    pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
        app.manage(Self {
            store: Mutex::new(store::Store::new(crate::storage::cache(app))?),
            tasks: Mutex::new(tasks::Tasks::default()),
            references: Mutex::new(reference::ReferenceReceipts::default()),
        });
        Ok(())
    }
    pub(crate) fn active(&self) -> bool {
        self.tasks.lock().is_ok_and(|tasks| tasks.active())
    }
}

/// Reclaim only stale session directories whose lease is not held.
pub(crate) fn clear_stale_cache(root: &std::path::Path) -> std::io::Result<usize> {
    store::recover(
        &root.join("voice-studio"),
        std::time::Duration::from_secs(300),
    )
}
