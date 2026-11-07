//! Frozen source selection, deterministic partitioning, and host-owned AI splitting.
pub(crate) mod confirm;
mod detection;
mod encoding;
mod partition;
pub(crate) mod selection;
pub(crate) mod splitting;
pub(crate) use detection::{
    HeadingRule, ImportIssue, builtin as heading_rules, detect as detect_chapters,
};
pub(crate) use encoding::decode as decode_source;
pub(crate) use partition::{patch_boundaries, recalculate, regroup};
use std::sync::Arc;
use tauri::Manager;

pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    app.manage(Arc::new(selection::Selections::default()));
    Ok(())
}
