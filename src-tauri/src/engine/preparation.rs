//! Application-owned preparation contract; SDK types never cross IPC.
use super::EngineState;
use serde::Serialize;

#[derive(Clone, Serialize, specta::Type)]
pub(crate) struct ModelPreparationPlan {
    pub fingerprint: String,
    pub download_bytes: f64,
    pub peak_additional_bytes: f64,
    pub cache_dir: String,
    pub available_bytes: Option<f64>,
}
pub(crate) async fn plan(
    state: &EngineState,
    backend: &str,
    model: Option<&str>,
) -> anyhow::Result<ModelPreparationPlan> {
    let settings = state.settings();
    let config = settings.download_config(&state.default_cache_dir)?;
    let registry = state.registry_for(&settings)?;
    let resolved = registry.resolve(backend, model)?;
    let inventory = registry.resource_inventory(backend, model).await?;
    let missing = inventory.missing_bytes as f64;
    Ok(ModelPreparationPlan {
        fingerprint: download_fingerprint(
            &config,
            backend,
            resolved.capabilities().model.as_deref().unwrap_or_default(),
            missing as u64,
            &inventory.fingerprint,
            registry.root(),
            registry.cache(),
        ),
        download_bytes: missing,
        peak_additional_bytes: missing,
        cache_dir: config.cache_dir.display().to_string(),
        available_bytes: super::inventory::available_for(&config.cache_dir).ok(),
    })
}

/// Opaque confirmation identity; raw source credentials never leave this module.
pub(super) fn download_fingerprint(
    config: &talechime::DownloadConfig,
    backend: &str,
    model: &str,
    missing: u64,
    inventory: &str,
    data_dir: &std::path::Path,
    app_cache_dir: &std::path::Path,
) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    for value in [
        config.cache_dir.to_string_lossy().as_ref(),
        data_dir.to_string_lossy().as_ref(),
        app_cache_dir.to_string_lossy().as_ref(),
        config
            .endpoint
            .as_deref()
            .unwrap_or("https://huggingface.co"),
        config.token.as_deref().unwrap_or(""),
        backend,
        model,
        inventory,
    ] {
        hash.update((value.len() as u64).to_le_bytes());
        hash.update(value.as_bytes());
    }
    hash.update(missing.to_le_bytes());
    format!("{:x}", hash.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn download_confirmation_binds_source_credentials_cache_and_inventory_without_disclosing_them()
    {
        let root = tempfile::tempdir().unwrap();
        let mut config = talechime::DownloadConfig {
            cache_dir: root.path().join("a"),
            endpoint: None,
            token: Some("private-test-token".into()),
        };
        let data = root.path().join("data");
        let app_cache = root.path().join("app-cache");
        let fingerprint = |config: &talechime::DownloadConfig, missing| {
            download_fingerprint(
                config,
                "moss",
                "nano",
                missing,
                "inventory-a",
                &data,
                &app_cache,
            )
        };
        let original = fingerprint(&config, 100);
        assert!(!original.contains("private-test-token"));
        assert_ne!(original, fingerprint(&config, 99));
        assert_ne!(
            original,
            download_fingerprint(
                &config,
                "moss",
                "nano",
                100,
                "inventory-b",
                &data,
                &app_cache
            )
        );
        assert_ne!(
            original,
            download_fingerprint(
                &config,
                "moss",
                "nano",
                100,
                "inventory-a",
                &root.path().join("other-data"),
                &app_cache
            )
        );
        assert_ne!(
            original,
            download_fingerprint(
                &config,
                "moss",
                "nano",
                100,
                "inventory-a",
                &data,
                &root.path().join("other-cache")
            )
        );
        config.token = Some("another-private-token".into());
        assert_ne!(original, fingerprint(&config, 100));
        config.token = Some("private-test-token".into());
        config.endpoint = Some("https://mirror.example".into());
        assert_ne!(original, fingerprint(&config, 100));
        config.endpoint = None;
        config.cache_dir = root.path().join("b");
        assert_ne!(original, fingerprint(&config, 100));
    }
}
