//! Frozen source selection, import confirmation, and split proposal decisions.
pub(crate) mod confirm;
pub(crate) mod selection;
pub(crate) mod splitting;
use std::sync::Arc;
use tauri::Manager;

pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    app.manage(Arc::new(selection::Selections::default()));
    Ok(())
}
