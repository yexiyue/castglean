//! Whole-novel import and bounded diagnostics. Mutable drafts live only in the Rust host.
pub(crate) mod commands;
mod detection;
pub(crate) mod diagnostics;
mod encoding;
mod storage;
mod store;
#[cfg(test)]
mod store_tests;
mod types;
use std::sync::Arc;
pub(crate) use store::ImportState;
use tauri::Manager;
pub(crate) use types::{DraftEdit, FilePreview, ImportSnapshot, TextPage};

pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let state = Arc::new(ImportState::new(
        app.path().app_data_dir()?.join("chapter-imports"),
    ));
    app.manage(state);
    Ok(())
}
