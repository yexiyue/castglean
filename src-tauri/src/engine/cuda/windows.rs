use super::CudaStatus;
use crate::engine::{
    EngineState,
    cuda_client::CudaClient,
    cuda_protocol::{Command, Outcome},
    cuda_runtime::RuntimeAssets,
};
use anyhow::{Context, ensure};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::Manager;

#[derive(Default)]
pub(crate) struct State {
    status: Mutex<Option<CudaStatus>>,
    operation: tokio::sync::Mutex<()>,
}

pub(crate) fn active(app: &tauri::AppHandle) -> bool {
    app.state::<State>().operation.try_lock().is_err()
}

fn root(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    Ok(app.path().app_local_data_dir()?.join("cuda"))
}

fn worker(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let path = app
        .path()
        .resource_dir()?
        .join("engine/castglean-cuda-worker.exe");
    ensure!(path.is_file(), "CUDA worker is not part of this build");
    Ok(path)
}

fn set(app: &tauri::AppHandle, status: CudaStatus) {
    *app.state::<State>()
        .status
        .lock()
        .expect("CUDA status lock") = Some(status);
}

pub(crate) fn spawn_status(app: &tauri::AppHandle) -> CudaStatus {
    let state = app.state::<State>();
    let mut status = state.status.lock().expect("CUDA status lock");
    if let Some(status) = *status {
        return status;
    }
    if worker(app).is_err() {
        *status = Some(CudaStatus::Unsupported);
        return CudaStatus::Unsupported;
    }
    *status = Some(CudaStatus::Checking);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<State>();
        let _operation = state.operation.lock().await;
        if matches!(
            *state.status.lock().expect("CUDA status lock"),
            Some(CudaStatus::Checking)
        ) {
            let status = inspect(&app).await.unwrap_or(CudaStatus::Failed);
            set(&app, status);
        }
    });
    CudaStatus::Checking
}

async fn driver_supports_cuda() -> anyhow::Result<()> {
    use std::os::windows::process::CommandExt;

    let system = PathBuf::from(std::env::var_os("SystemRoot").context("Windows system root")?);
    let mut command = std::process::Command::new(system.join("System32/nvidia-smi.exe"));
    command
        .args([
            "--query-gpu=driver_version,compute_cap",
            "--format=csv,noheader",
        ])
        .creation_flags(0x0800_0000);
    let output = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::process::Command::from(command)
            .kill_on_drop(true)
            .output()
            .await
    })
    .await??;
    ensure!(output.status.success(), "NVIDIA driver not available");
    ensure!(
        String::from_utf8_lossy(&output.stdout).lines().any(|line| {
            let Some((driver, capability)) = line.split_once(',') else {
                return false;
            };
            capability.trim() == "12.0"
                && driver
                    .split('.')
                    .next()
                    .and_then(|major| major.trim().parse::<u32>().ok())
                    .is_some_and(|major| major >= 580)
        }),
        "no validated CUDA device or driver"
    );
    Ok(())
}

async fn inspect(app: &tauri::AppHandle) -> anyhow::Result<CudaStatus> {
    if driver_supports_cuda().await.is_err() {
        return Ok(CudaStatus::DriverUnavailable);
    }
    let assets = RuntimeAssets::pinned()?;
    let root = root(app)?;
    let runtime = root.join(&assets.version);
    if !verify_async(runtime.clone()).await {
        return Ok(CudaStatus::NeedsDownload {
            total: assets.download_size().try_into()?,
        });
    }
    probe(app, runtime).await?;
    Ok(CudaStatus::Ready {
        enabled: root.join("enabled").is_file(),
    })
}

async fn verify_async(runtime: PathBuf) -> bool {
    tauri::async_runtime::spawn_blocking(move || RuntimeAssets::pinned()?.verified(&runtime))
        .await
        .is_ok_and(|verified| verified.is_ok())
}

fn start(app: &tauri::AppHandle, runtime: PathBuf) -> anyhow::Result<CudaClient> {
    let scratch = crate::storage::cache(app).join("cuda-worker");
    std::fs::create_dir_all(&scratch)?;
    CudaClient::start(&worker(app)?, &runtime, &scratch)
}

async fn probe(app: &tauri::AppHandle, runtime: PathBuf) -> anyhow::Result<()> {
    let mut client = start(app, runtime)?;
    let available = matches!(client.request(Command::Probe).await?, Outcome::Available);
    client.terminate().await?;
    ensure!(
        available,
        "CUDA worker could not initialize a compatible GPU"
    );
    Ok(())
}

pub(crate) async fn enable(app: &tauri::AppHandle, enabled: bool) -> anyhow::Result<()> {
    let install_gate = app.state::<crate::desktop_updates::InstallGate>();
    let _gate = crate::desktop_updates::admit(install_gate.inner())
        .map_err(|()| anyhow::anyhow!("app update in progress"))?;
    let state = app.state::<State>();
    let _operation = state
        .operation
        .try_lock()
        .context("CUDA preparation already active")?;
    worker(app)?;
    let root = root(app)?;
    let preference = root.join("enabled");
    if !enabled {
        match tokio::fs::remove_file(preference).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        set(app, inspect(app).await.unwrap_or(CudaStatus::Failed));
        return Ok(());
    }
    let result: anyhow::Result<()> = async {
        if driver_supports_cuda().await.is_err() {
            set(app, CudaStatus::DriverUnavailable);
            anyhow::bail!("no compatible NVIDIA device or driver");
        }
        let assets = RuntimeAssets::pinned()?;
        let total = assets.download_size().try_into()?;
        set(app, CudaStatus::Downloading { received: 0, total });
        let runtime = assets
            .prepare(&root, |received| {
                set(
                    app,
                    CudaStatus::Downloading {
                        received: received as u32,
                        total,
                    },
                );
            })
            .await?;
        probe(app, runtime).await?;
        tokio::fs::write(preference, b"1\n").await?;
        set(app, CudaStatus::Ready { enabled: true });
        Ok(())
    }
    .await;
    if result.is_err()
        && matches!(
            *state.status.lock().expect("CUDA status lock"),
            Some(CudaStatus::Downloading { .. })
        )
    {
        set(app, CudaStatus::Failed);
    }
    result
}

pub(crate) fn preferred(app: &tauri::AppHandle, backend: &str, model: &str) -> bool {
    backend == "kokoro"
        && model == "1.1-zh-g2pw"
        && worker(app).is_ok()
        && root(app).is_ok_and(|root| root.join("enabled").is_file())
}

pub(crate) async fn load(app: &tauri::AppHandle, model: &str) -> anyhow::Result<CudaClient> {
    let runtime = root(app)?.join(RuntimeAssets::pinned()?.version);
    ensure!(
        verify_async(runtime.clone()).await,
        "CUDA runtime unavailable"
    );
    let mut client = start(app, runtime)?;
    let hub_cache = app.state::<EngineState>().download_config()?.cache_dir;
    let command = Command::Load {
        model: model.to_owned(),
        hub_cache,
    };
    ensure!(
        matches!(client.request(command).await?, Outcome::Loaded),
        "CUDA model load failed"
    );
    Ok(client)
}
