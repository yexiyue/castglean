//! CUDA imports belong to this executable. Build the desktop separately without its feature.
#[cfg(all(test, windows))]
#[path = "../engine/cuda_client.rs"]
mod cuda_client;
#[path = "../engine/cuda_protocol.rs"]
mod cuda_protocol;
#[cfg(all(test, windows))]
#[path = "../engine/cuda_runtime.rs"]
mod cuda_runtime;

use anyhow::{Context, ensure};
use cuda_protocol::{
    BACKEND, Command, Failure, MAX_FRAME, MAX_PCM_BYTES, MODEL, Outcome, Reply, Request, VERSION,
};
use std::{
    io::{self, BufRead, Read, Write},
    path::{Path, PathBuf},
};
use talechime::{Device, DownloadConfig, Engine, ModelOptions, Registry};

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    talechime::run_local(run()).await
}

async fn run() -> anyhow::Result<()> {
    let mut args = std::env::args_os().skip(1);
    let scratch = PathBuf::from(args.next().context("missing private output directory")?);
    ensure!(args.next().is_none() && scratch.is_absolute() && scratch.is_dir());

    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    let mut engine = None;
    let mut previous = 0;
    let mut frame = Vec::new();
    loop {
        frame.clear();
        if (&mut input)
            .take((MAX_FRAME + 1) as u64)
            .read_until(b'\n', &mut frame)?
            == 0
        {
            break;
        }
        ensure!(frame.len() <= MAX_FRAME && frame.ends_with(b"\n"));
        let Request {
            version,
            id,
            command,
        } = serde_json::from_slice(&frame).context("invalid worker frame")?;
        ensure!(version == VERSION && id > previous);
        previous = id;
        let closing = matches!(command, Command::Shutdown);
        let outcome = match command {
            Command::Probe => probe(&scratch),
            Command::Load { model, hub_cache } if engine.is_none() && model == MODEL => {
                match load(&scratch, hub_cache).await {
                    Ok(loaded) => {
                        engine = Some(loaded);
                        Outcome::Loaded
                    }
                    Err(_) => Outcome::Failed {
                        reason: Failure::ModelUnavailable,
                    },
                }
            }
            Command::Synthesize { text, voice } => match engine.as_ref() {
                Some(engine) => synthesize(engine, &scratch, id, &text, &voice).await,
                None => Outcome::Failed {
                    reason: Failure::UnexpectedCommand,
                },
            },
            Command::Shutdown => {
                if let Some(mut engine) = engine.take() {
                    engine.close().await?;
                }
                Outcome::Closed
            }
            _ => Outcome::Failed {
                reason: Failure::UnexpectedCommand,
            },
        };
        serde_json::to_writer(
            &mut output,
            &Reply {
                version: VERSION,
                id,
                outcome,
            },
        )?;
        output.write_all(b"\n")?;
        output.flush()?;
        if closing {
            break;
        }
    }
    if let Some(mut engine) = engine {
        engine.close().await?;
    }
    Ok(())
}

fn probe(scratch: &Path) -> Outcome {
    match Registry::new(Some(scratch.join("probe"))) {
        Ok(registry)
            if registry
                .available_devices_for(BACKEND, Some(MODEL))
                .contains(&Device::Cuda) =>
        {
            Outcome::Available
        }
        _ => Outcome::Failed {
            reason: Failure::DeviceUnavailable,
        },
    }
}

async fn load(scratch: &Path, hub_cache: PathBuf) -> anyhow::Result<Engine> {
    let data = scratch.join("data");
    let registry = Registry::with_storage_paths(
        data.clone(),
        scratch.join("cache"),
        &DownloadConfig {
            cache_dir: hub_cache,
            endpoint: None,
            token: None,
        },
        Default::default(),
    )?;
    let mut options = ModelOptions::new(BACKEND, data);
    options.model = Some(MODEL.into());
    options.device = Device::Cuda;
    Ok(Engine::load(&registry, options, |_| {}).await?)
}

async fn synthesize(engine: &Engine, scratch: &Path, id: u32, text: &str, voice: &str) -> Outcome {
    let Ok(pcm) = engine
        .synthesize_pcm(text, voice, None, MAX_PCM_BYTES)
        .await
    else {
        return Outcome::Failed {
            reason: Failure::SynthesisFailed,
        };
    };
    match write_audio(scratch, id, pcm) {
        Ok(()) => Outcome::Audio,
        Err(_) => Outcome::Failed {
            reason: Failure::OutputFailed,
        },
    }
}

fn write_audio(scratch: &Path, id: u32, pcm: talechime::Pcm) -> anyhow::Result<()> {
    ensure!(!pcm.samples.is_empty());
    let spec = hound::WavSpec {
        channels: pcm.channels,
        sample_rate: pcm.sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut staged = tempfile::NamedTempFile::new_in(scratch)?;
    {
        let mut writer = hound::WavWriter::new(staged.as_file_mut(), spec)?;
        for sample in pcm.samples {
            writer.write_sample(sample)?;
        }
        writer.finalize()?;
    }
    staged.persist_noclobber(scratch.join(format!("{id}.wav")))?;
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[tokio::test(flavor = "current_thread")]
    #[ignore = "requires built worker, verified Windows CUDA runtime and prepared Kokoro cache"]
    async fn installed_worker_synthesizes_and_shuts_down() -> anyhow::Result<()> {
        let binary =
            PathBuf::from(std::env::var_os("CASTGLEAN_CUDA_TEST_WORKER").context("worker")?);
        let runtime =
            PathBuf::from(std::env::var_os("CASTGLEAN_CUDA_TEST_RUNTIME").context("runtime")?);
        let hub_cache =
            PathBuf::from(std::env::var_os("CASTGLEAN_CUDA_TEST_CACHE").context("Hub cache")?);
        let scratch = tempfile::tempdir()?;
        let mut client = cuda_client::CudaClient::start(&binary, &runtime, scratch.path())?;
        assert!(matches!(
            client.request(Command::Probe).await?,
            Outcome::Available
        ));
        assert!(matches!(
            client
                .request(Command::Load {
                    model: MODEL.into(),
                    hub_cache
                })
                .await?,
            Outcome::Loaded
        ));
        let pcm = client
            .synthesize("春天来了，院子里的花开了。".into(), "zf_001".into())
            .await?;
        assert_eq!((pcm.sample_rate, pcm.channels), (24_000, 1));
        assert!(pcm.samples.iter().any(|sample| sample.abs() > 0.001));
        assert!(matches!(
            client.request(Command::Shutdown).await?,
            Outcome::Closed
        ));
        client.terminate().await?;
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    #[ignore = "downloads pinned CUDA runtime archives from NVIDIA"]
    async fn downloads_runtime_and_reuses_valid_files() -> anyhow::Result<()> {
        let root = PathBuf::from(
            std::env::var_os("CASTGLEAN_CUDA_TEST_DOWNLOAD").context("runtime output")?,
        );
        let assets = cuda_runtime::RuntimeAssets::pinned()?;
        let runtime = assets.prepare(&root, |_| {}).await?;
        assert_eq!(runtime, root.join(&assets.version));
        assets.verify_installed(runtime.clone()).await?;
        assert_eq!(assets.prepare(&root, |_| {}).await?, runtime);
        Ok(())
    }
}
