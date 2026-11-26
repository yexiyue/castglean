//! CUDA readiness and per-model device selection owned by the Windows host.
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub(crate) use super::cuda_client::CudaClient as Client;
#[cfg(windows)]
pub(crate) use windows::{State, active, load, preferred};

#[cfg(windows)]
use windows::{enable, spawn_status};

#[derive(Clone, Copy, serde::Serialize, specta::Type)]
#[cfg_attr(not(windows), allow(dead_code))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum CudaStatus {
    Unsupported,
    Checking,
    DriverUnavailable,
    NeedsDownload { total: u32 },
    Downloading { received: u32, total: u32 },
    Ready { enabled: bool },
    Failed,
}

#[cfg(not(windows))]
pub(crate) fn preferred(_: &tauri::AppHandle, _: &str, _: &str) -> bool {
    false
}

#[cfg(not(windows))]
pub(crate) fn active(_: &tauri::AppHandle) -> bool {
    false
}

#[tauri::command]
#[specta::specta]
pub(crate) fn cuda_runtime_status(app: tauri::AppHandle) -> CudaStatus {
    #[cfg(windows)]
    {
        spawn_status(&app)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        CudaStatus::Unsupported
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn cuda_runtime_enable(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        enable(&app, enabled).await.map_err(|error| {
            tracing::warn!(event = "cuda_runtime_prepare_failed", %error);
            "cuda_runtime_prepare_failed".into()
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (app, enabled);
        Err("cuda_unavailable".into())
    }
}
