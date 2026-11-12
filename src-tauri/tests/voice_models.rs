//! Offline coverage and opt-in, existing-cache acceptance. No test downloads weights.
use std::collections::BTreeSet;
use talechime::{Device, Engine, ModelOptions, Registry, ResourceStatus};

#[tokio::test(flavor = "current_thread")]
async fn all_backend_families_and_independent_designers_are_compiled() {
    let root = tempfile::tempdir().unwrap();
    let registry = Registry::with_downloads(
        Some(root.path().join("data")),
        &talechime::DownloadConfig {
            cache_dir: root.path().join("hub"),
            endpoint: None,
            token: None,
        },
    )
    .unwrap();
    let catalog = registry.catalog().unwrap();
    let families: BTreeSet<_> = catalog.iter().map(|m| m.backend.as_str()).collect();
    assert_eq!(
        families,
        [
            "moss",
            "kokoro",
            "qwen",
            "indextts",
            "cosyvoice3",
            "voxcpm",
            "omnivoice"
        ]
        .into()
    );
    for backend in ["kokoro", "indextts", "cosyvoice3"] {
        assert!(matches!(
            registry.resource_status(backend, None).await.unwrap(),
            ResourceStatus::Missing { missing_bytes } if missing_bytes > 0
        ));
    }
    assert_eq!(registry.designers().await.unwrap().len(), 4);
    assert!(
        catalog
            .iter()
            .all(|m| m.model.as_deref() != Some("1.7b-voicedesign"))
    );
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "explicit existing-cache inventory; never downloads models"]
async fn cached_model_inventory() {
    let root = std::env::var_os("CASTGLEAN_MODEL_ROOT").expect("set CASTGLEAN_MODEL_ROOT");
    let registry = Registry::new(Some(root.into())).unwrap();
    for model in registry.catalog().unwrap() {
        println!(
            "{}/{} devices={:?} resource={:?}",
            model.backend,
            model.model.as_deref().unwrap_or_default(),
            registry.available_devices_for(&model.backend, model.model.as_deref()),
            registry
                .resource_status(&model.backend, model.model.as_deref())
                .await
                .unwrap()
        );
    }
    for engine in registry.designers().await.unwrap() {
        println!(
            "design {} devices={:?} ready={} missing={}",
            engine.id, engine.devices, engine.ready, engine.extra_download_bytes
        );
    }
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "explicit real synthesis using prepared weights only"]
async fn cached_nano_synthesis() -> anyhow::Result<()> {
    let root = std::env::var_os("CASTGLEAN_MODEL_ROOT").expect("set CASTGLEAN_MODEL_ROOT");
    talechime::run_local(async {
        let root = std::path::PathBuf::from(root);
        let registry = Registry::new(Some(root.clone()))?;
        anyhow::ensure!(
            registry
                .resource_status("moss", Some("nano-candle"))
                .await?
                == ResourceStatus::Ready,
            "prepare Nano resources first"
        );
        let voices = tempfile::tempdir()?;
        let mut options = ModelOptions::new("moss", &root);
        options.model = Some("nano-candle".into());
        options.device = if std::env::var("CASTGLEAN_DEVICE").as_deref() == Ok("metal") {
            Device::Metal
        } else {
            Device::Cpu
        };
        let device = options.device;
        options.voices = Some(voices.path().into());
        let started = std::time::Instant::now();
        let mut engine = Engine::load(&registry, options, |_| {}).await?;
        let voice = engine.capabilities()?.default_voice;
        let trial_text = std::env::var("CASTGLEAN_TRIAL_TEXT").unwrap_or_else(|_| "你好。".into());
        let pcm = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            engine.synthesize_pcm(trial_text, &voice, None, 16 * 1024 * 1024),
        )
        .await??;
        anyhow::ensure!(
            pcm.duration_ms()? > 0 && pcm.samples.iter().all(|s| s.is_finite()),
            "invalid generated PCM"
        );
        println!(
            "Nano {:?}: samples={} duration_ms={} elapsed={:?}",
            device,
            pcm.samples.len(),
            pcm.duration_ms()?,
            started.elapsed()
        );
        if let Some(path) = std::env::var_os("CASTGLEAN_AUDIO_OUTPUT") {
            let path = std::path::PathBuf::from(path);
            anyhow::ensure!(
                path.is_absolute() && !path.exists(),
                "output must be a new absolute path"
            );
            let spec = hound::WavSpec {
                channels: pcm.channels,
                sample_rate: pcm.sample_rate,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };
            let mut wav = hound::WavWriter::create(path, spec)?;
            for sample in pcm.samples {
                wav.write_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
            }
            wav.finalize()?;
        }
        engine.close().await?;
        Ok(())
    })
    .await
}
