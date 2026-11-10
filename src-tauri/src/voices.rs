//! 音色资产与搬运域。模型对象、工程角色和 ZIP 布局不进入本域契约。
pub(crate) mod commands;
pub(crate) mod events;
mod library;
pub(crate) mod studio;
mod transfers;

pub(crate) use events::*;
use std::{path::PathBuf, sync::Mutex};
use talechime::VoiceLibrary;
use tauri::Manager;

pub(crate) struct VoiceState {
    library: VoiceLibrary,
    catalog_reads: Mutex<()>,
    /// Serializes binding validation/publication with library deletion.
    pub(crate) binding_changes: tokio::sync::Mutex<()>,
    transfers: Mutex<transfers::Transfers>,
}
impl VoiceState {
    pub(crate) fn active_transfers(&self) -> Result<u32, String> {
        let transfers = self
            .transfers
            .lock()
            .map_err(|_| "voice task lock unavailable")?;
        Ok(transfers
            .snapshots()
            .iter()
            .filter(|task| {
                matches!(
                    task.state,
                    VoiceTaskState::Running | VoiceTaskState::Cancelling
                )
            })
            .count() as u32)
    }
    /// Read-only library catalog projection for cross-domain consumers such as
    /// voice binding; no mutation surface is exposed.
    pub(crate) fn catalog_voices(&self) -> Result<Vec<LibraryVoice>, VoiceError> {
        Ok(self.inventory()?.voices)
    }
    fn new(root: PathBuf) -> Result<Self, VoiceError> {
        Ok(Self {
            library: VoiceLibrary::open(root).map_err(VoiceError::from)?,
            catalog_reads: Mutex::new(()),
            binding_changes: tokio::sync::Mutex::new(()),
            transfers: Mutex::new(transfers::Transfers::default()),
        })
    }
}
pub(crate) fn init(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    let root = app.path().app_data_dir()?.join("voices-v2");
    let state = VoiceState::new(root).map_err(|_| {
        tauri::Error::Io(std::io::Error::other("voice library initialization failed"))
    })?;
    app.manage(state);
    studio::StudioState::init(app)
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e.to_string())))?;
    Ok(())
}
