//! The release-only updater. The WebView never supplies URLs, signatures or packages.
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use tauri_specta::Event;
use tokio::sync::{Mutex as AsyncMutex, RwLock, RwLockReadGuard};

const CHANNEL: Option<&str> = option_env!("CASTGLEAN_UPDATE_CHANNEL");
const RELEASES: &str = "https://github.com/yexiyue/castglean/releases";

#[derive(Clone, Default, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum DesktopUpdateStatus {
    #[default]
    Idle,
    Disabled,
    Checking,
    Current,
    Available {
        offer: UpdateOffer,
    },
    Downloading {
        offer: UpdateOffer,
        received: u32,
        total: Option<u32>,
    },
    Ready {
        offer: UpdateOffer,
    },
    Installing {
        offer: UpdateOffer,
    },
    Failed {
        problem: UpdateProblem,
        offer: Option<UpdateOffer>,
    },
}

#[derive(Clone, Serialize, specta::Type)]
pub(crate) struct UpdateOffer {
    version: String,
    notes: String,
    release_url: String,
}

#[derive(Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum UpdateProblem {
    Check,
    Download,
    Signature,
    Busy,
    Install,
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
pub(crate) struct DesktopUpdateChanged(pub DesktopUpdateStatus);

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
pub(crate) struct DesktopUpdateInstallRequested;

struct Candidate {
    update: Update,
    offer: UpdateOffer,
    bytes: Option<Vec<u8>>,
}

#[derive(Default)]
pub(crate) struct UpdateState {
    action: AsyncMutex<()>,
    status: Mutex<DesktopUpdateStatus>,
    candidate: Mutex<Option<Candidate>>,
}

#[derive(Default)]
pub(crate) struct InstallGate(RwLock<()>);

pub(crate) fn admit(gate: &InstallGate) -> Result<RwLockReadGuard<'_, ()>, ()> {
    gate.0.try_read().map_err(|_| ())
}

fn release_target() -> Option<(&'static str, &'static str, &'static str)> {
    target_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn target_for(os: &str, arch: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match (os, arch) {
        ("macos", "aarch64") => Some(("darwin-aarch64", "aarch64", ".app.tar.gz")),
        ("windows", "x86_64") => Some(("windows-x86_64", "x64", "-setup.exe")),
        _ => None,
    }
}

pub(crate) fn enabled() -> bool {
    !cfg!(debug_assertions)
        && matches!(CHANNEL, Some("stable" | "candidate"))
        && release_target().is_some()
}

pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry, tauri_plugin_updater::Config> {
    let builder = tauri_plugin_updater::Builder::new();
    if let Some((target, _, _)) = release_target() {
        builder.target(target).build()
    } else {
        builder.build()
    }
}

fn set(app: &AppHandle, status: DesktopUpdateStatus) {
    if let Ok(mut current) = app.state::<UpdateState>().status.lock() {
        *current = status.clone();
    }
    let _ = DesktopUpdateChanged(status).emit(app);
}

pub(crate) fn start(app: &AppHandle) {
    if enabled() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            check(&app).await;
        });
    }
}

fn valid_package(update: &Update, arch: &str, suffix: &str) -> bool {
    let version = &update.version;
    update.download_url.as_str()
        == format!("{RELEASES}/download/v{version}/CastGlean_{version}_{arch}{suffix}")
}

async fn check(app: &AppHandle) {
    if !enabled() {
        return;
    }
    let state = app.state::<UpdateState>();
    let Ok(_action) = state.action.try_lock() else {
        return;
    };
    // A confirmed download remains ready even if the user requests another check.
    if let Ok(candidate) = state.candidate.lock()
        && candidate
            .as_ref()
            .is_some_and(|candidate| candidate.bytes.is_some())
    {
        return;
    }
    set(app, DesktopUpdateStatus::Checking);
    if let Ok(mut candidate) = state.candidate.lock() {
        *candidate = None;
    }
    let result = async {
        let Some((_, arch, suffix)) = release_target() else {
            return Ok(None);
        };
        let update = app
            .updater_builder()
            .timeout(Duration::from_secs(25))
            .version_comparator(|current, release| {
                let same_channel = release.version.pre.is_empty() == (CHANNEL == Some("stable"));
                release.version > current && same_channel
            })
            .build()?
            .check()
            .await?;
        match update {
            Some(mut update) if valid_package(&update, arch, suffix) => {
                update.timeout = Some(Duration::from_secs(900));
                Ok(Some(update))
            }
            Some(_) => Err(Error::InvalidUpdaterFormat),
            None => Ok(None),
        }
    }
    .await;
    match result {
        Ok(Some(update)) => {
            let offer = UpdateOffer {
                version: update.version.clone(),
                notes: update
                    .body
                    .as_deref()
                    .unwrap_or_default()
                    .chars()
                    .take(2500)
                    .collect(),
                release_url: format!("{RELEASES}/tag/v{}", update.version),
            };
            if let Ok(mut candidate) = state.candidate.lock() {
                *candidate = Some(Candidate {
                    update,
                    offer: offer.clone(),
                    bytes: None,
                });
                set(app, DesktopUpdateStatus::Available { offer });
            }
        }
        Ok(None) => set(app, DesktopUpdateStatus::Current),
        Err(error) => {
            tracing::warn!(event = "desktop_update_check_failed", %error);
            set(
                app,
                DesktopUpdateStatus::Failed {
                    problem: UpdateProblem::Check,
                    offer: None,
                },
            );
        }
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) fn desktop_update_status(app: AppHandle) -> DesktopUpdateStatus {
    if !enabled() {
        return DesktopUpdateStatus::Disabled;
    }
    app.state::<UpdateState>()
        .status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn desktop_update_check(app: AppHandle) {
    check(&app).await;
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn desktop_update_download(app: AppHandle) -> Result<(), String> {
    if !enabled() {
        return Err("updates_unavailable".into());
    }
    let state = app.state::<UpdateState>();
    let _action = state.action.try_lock().map_err(|_| "update_in_progress")?;
    let (update, offer) = {
        let candidate = state.candidate.lock().map_err(|_| "updates_unavailable")?;
        let candidate = candidate.as_ref().ok_or("update_not_found")?;
        if candidate.bytes.is_some() {
            return Ok(());
        }
        (candidate.update.clone(), candidate.offer.clone())
    };
    let mut received = 0u32;
    let mut reported = std::time::Instant::now();
    set(
        &app,
        DesktopUpdateStatus::Downloading {
            offer: offer.clone(),
            received,
            total: None,
        },
    );
    match update
        .download(
            |size, total| {
                received = received.saturating_add(u32::try_from(size).unwrap_or(u32::MAX));
                if reported.elapsed() >= Duration::from_millis(125) {
                    set(
                        &app,
                        DesktopUpdateStatus::Downloading {
                            offer: offer.clone(),
                            received,
                            total: total.and_then(|value| u32::try_from(value).ok()),
                        },
                    );
                    reported = std::time::Instant::now();
                }
            },
            || {},
        )
        .await
    {
        Ok(bytes) => {
            let mut candidate = state.candidate.lock().map_err(|_| "updates_unavailable")?;
            *candidate = Some(Candidate {
                update,
                offer: offer.clone(),
                bytes: Some(bytes),
            });
            set(&app, DesktopUpdateStatus::Ready { offer });
        }
        Err(error) => {
            let problem = match error {
                Error::Minisign(_)
                | Error::Base64(_)
                | Error::SignatureUtf8(_)
                | Error::SignedVersionMismatch { .. } => UpdateProblem::Signature,
                _ => UpdateProblem::Download,
            };
            tracing::warn!(event = "desktop_update_download_failed", %error);
            set(
                &app,
                DesktopUpdateStatus::Failed {
                    problem,
                    offer: Some(offer),
                },
            );
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn desktop_update_request_install(window: WebviewWindow) -> Result<(), String> {
    if !enabled() || window.label() != "main" {
        return Err("updates_unavailable".into());
    }
    DesktopUpdateInstallRequested
        .emit_to(&window, "main")
        .map_err(|_| "updates_unavailable".into())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn desktop_update_install(window: WebviewWindow) -> Result<(), String> {
    if !enabled() || window.label() != "main" {
        return Err("updates_unavailable".into());
    }
    let app = window.app_handle();
    let state = app.state::<UpdateState>();
    let _action = state.action.try_lock().map_err(|_| "update_in_progress")?;
    let _installing = app.state::<InstallGate>().inner().0.try_write();
    let offer = state
        .candidate
        .lock()
        .map_err(|_| "updates_unavailable")?
        .as_ref()
        .filter(|candidate| candidate.bytes.is_some())
        .map(|candidate| candidate.offer.clone())
        .ok_or("update_not_downloaded")?;
    if _installing.is_err()
        || crate::desktop_window::window_close_context(app.clone())
            .await
            .map_or(true, |context| context.active_tasks != 0)
    {
        set(
            app,
            DesktopUpdateStatus::Failed {
                problem: UpdateProblem::Busy,
                offer: Some(offer),
            },
        );
        return Err("update_busy".into());
    }
    let staged = state
        .candidate
        .lock()
        .map_err(|_| "updates_unavailable")?
        .take()
        .ok_or("update_not_downloaded")?;
    set(
        app,
        DesktopUpdateStatus::Installing {
            offer: offer.clone(),
        },
    );
    let (result, staged) = tauri::async_runtime::spawn_blocking(move || {
        let result = staged
            .bytes
            .as_ref()
            .map_or(Err(Error::InvalidUpdaterFormat), |bytes| {
                staged.update.install(bytes)
            });
        (result, staged)
    })
    .await
    .map_err(|_| {
        set(
            app,
            DesktopUpdateStatus::Failed {
                problem: UpdateProblem::Install,
                offer: None,
            },
        );
        "update_install_failed"
    })?;
    if let Err(error) = result {
        tracing::warn!(event = "desktop_update_install_failed", %error);
        if let Ok(mut candidate) = state.candidate.lock() {
            *candidate = Some(staged);
        }
        set(
            app,
            DesktopUpdateStatus::Failed {
                problem: UpdateProblem::Install,
                offer: Some(offer),
            },
        );
        return Err("update_install_failed".into());
    }
    crate::desktop_window::restart_after_update(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_uses_one_update_target_and_asset() {
        assert_eq!(
            target_for("windows", "x86_64"),
            Some(("windows-x86_64", "x64", "-setup.exe"))
        );
        assert_eq!(
            target_for("macos", "aarch64"),
            Some(("darwin-aarch64", "aarch64", ".app.tar.gz"))
        );
        assert_eq!(target_for("windows", "aarch64"), None);
    }

    #[test]
    fn installation_and_task_admission_exclude_each_other() {
        let gate = InstallGate::default();
        let admission = admit(&gate).unwrap();
        assert!(gate.0.try_write().is_err());
        drop(admission);
        let install = gate.0.try_write().unwrap();
        assert!(admit(&gate).is_err());
        drop(install);
        assert!(admit(&gate).is_ok());
    }
}
