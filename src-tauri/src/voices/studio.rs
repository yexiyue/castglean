//! Short voice production: validated candidates, owned tasks, controlled media.
mod audio;
pub(crate) mod casting;
pub(crate) mod commands;
pub(crate) mod execution;
mod preparation;
mod reference;
mod store;
mod tasks;
mod types;
mod waveform;
use std::sync::Mutex;
use tauri::{
    Manager,
    http::{Request, Response},
};
pub(crate) use types::*;
pub(crate) use waveform::extract as extract_waveform;

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

fn open(store: &store::Store, path: &str) -> Result<std::fs::File, u16> {
    let id = path.strip_prefix('/').ok_or(404u16)?;
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(404);
    }
    store
        .media
        .get(id)
        .ok_or(404u16)?
        .file
        .reopen()
        .map_err(|_| 500)
}
pub(crate) fn respond_audio(
    app: &tauri::AppHandle,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let result = (|| -> Result<_, u16> {
        if !matches!(request.method().as_str(), "GET" | "HEAD") {
            return Err(405);
        }
        let state = app.state::<StudioState>();
        let store = state.store.lock().map_err(|_| 500u16)?;
        let file = open(&store, request.uri().path())?;
        drop(store);
        crate::audio_protocol::serve(file, &request)
    })();
    result.unwrap_or_else(|status| Response::builder().status(status).body(vec![]).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn media_only_opens_issued_identity_and_rejects_released_or_arbitrary_paths() {
        let root = tempfile::tempdir().unwrap();
        let mut store = store::Store::new(root.path().into()).unwrap();
        let id = store.audio(b"test audio", None).unwrap();
        assert!(open(&store, &format!("/{id}")).is_ok());
        for path in [
            "/etc/passwd",
            "/../reference.wav",
            "/00000000000000000000000000000000",
        ] {
            assert!(open(&store, path).is_err());
        }
        store.media.remove(&id);
        assert!(open(&store, &format!("/{id}")).is_err());
    }
}
