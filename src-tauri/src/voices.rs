//! 音色资产与搬运域。模型对象、工程角色和 ZIP 布局不进入本域契约。
pub(crate) mod commands;
pub(crate) mod events;
mod library;
mod transfers;

pub(crate) use events::*;
use std::{path::PathBuf, sync::Mutex};
use talechime::VoiceLibrary;
use tauri::Manager;

pub(crate) struct VoiceState {
    library: VoiceLibrary,
    transfers: Mutex<transfers::Transfers>,
}
impl VoiceState {
    fn new(root: PathBuf) -> Result<Self, VoiceError> {
        Ok(Self {
            library: VoiceLibrary::open(root).map_err(VoiceError::from)?,
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
    Ok(())
}
