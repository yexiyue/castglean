//! Short voice production: validated candidates, owned tasks, controlled media.
mod audio;
pub(crate) mod commands;
pub(crate) mod execution;
pub(crate) mod media;
mod preparation;
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
}
impl StudioState {
    pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
        app.manage(Self {
            store: Mutex::new(store::Store::new(app.path().app_cache_dir()?)?),
            tasks: Mutex::new(tasks::Tasks::default()),
        });
        Ok(())
    }
    pub(crate) fn active(&self) -> bool {
        self.tasks.lock().is_ok_and(|tasks| tasks.active())
    }
}
