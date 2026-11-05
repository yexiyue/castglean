//! Application-owned preparation contract; SDK types never cross IPC.
use super::{EngineState, PreparationPhase, ResourceState};
use serde::Serialize;

#[derive(Clone, Serialize, specta::Type)]
pub(crate) struct ModelPreparationPlan {
    pub fingerprint: String,
    pub download_bytes: f64,
    pub peak_additional_bytes: f64,
    pub output_bytes: f64,
    pub conversions: Vec<String>,
    pub cache_dir: String,
    pub available_bytes: Option<f64>,
}
pub(super) struct PlannedResources {
    pub view: ModelPreparationPlan,
    pub native: Option<talechime::PreparationPlan>,
    pub model: String,
}
pub(crate) async fn plan(
    state: &EngineState,
    backend: &str,
    model: Option<&str>,
) -> anyhow::Result<PlannedResources> {
    let config = state.download_config()?;
    let registry =
        talechime::Registry::with_downloads(Some(config.cache_dir.join("castglean")), &config)?;
    let resolved = registry.resolve(backend, model)?;
    let native = resolved.native_preparation_plan().await?;
    let missing = registry.resource_status(backend, model)?.missing_bytes() as f64;
    let view = ModelPreparationPlan {
        fingerprint: native.as_ref().map_or_else(
            || {
                download_fingerprint(
                    &config,
                    backend,
                    resolved.capabilities().model.as_deref().unwrap_or_default(),
                    missing as u64,
                )
            },
            |p| p.fingerprint.clone(),
        ),
        download_bytes: native.as_ref().map_or(missing, |p| p.download_bytes as f64),
        peak_additional_bytes: native
            .as_ref()
            .map_or(missing, |p| p.peak_additional_bytes as f64),
        output_bytes: native.as_ref().map_or(0.0, |p| p.output_bytes as f64),
        conversions: native
            .as_ref()
            .map_or_else(Vec::new, |p| p.conversions.clone()),
        cache_dir: config.cache_dir.display().to_string(),
        available_bytes: super::inventory::available_for(&config.cache_dir).ok(),
    };
    Ok(PlannedResources {
        view,
        native,
        model: resolved.capabilities().model.clone().unwrap_or_default(),
    })
}
pub(super) fn stage(progress: talechime::PreparationProgress) -> ResourceState {
    use talechime::PreparationPhase as EnginePhase;
    ResourceState::Preparing {
        phase: match progress.phase {
            EnginePhase::Downloading => PreparationPhase::Downloading,
            EnginePhase::Converting => PreparationPhase::Converting,
            EnginePhase::Verifying => PreparationPhase::Verifying,
            EnginePhase::Publishing => PreparationPhase::Publishing,
        },
        component: progress.component,
        completed: progress.completed as f64,
        total: progress.total as f64,
    }
}

/// Opaque confirmation identity; raw source credentials never leave this module.
pub(super) fn download_fingerprint(
    config: &talechime::DownloadConfig,
    backend: &str,
    model: &str,
    missing: u64,
) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    for value in [
        config.cache_dir.to_string_lossy().as_ref(),
        config
            .endpoint
            .as_deref()
            .unwrap_or("https://huggingface.co"),
        config.token.as_deref().unwrap_or(""),
        backend,
        model,
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
        let original = download_fingerprint(&config, "moss", "nano", 100);
        assert!(!original.contains("private-test-token"));
        assert_ne!(original, download_fingerprint(&config, "moss", "nano", 99));
        config.token = Some("another-private-token".into());
        assert_ne!(original, download_fingerprint(&config, "moss", "nano", 100));
        config.token = Some("private-test-token".into());
        config.endpoint = Some("https://mirror.example".into());
        assert_ne!(original, download_fingerprint(&config, "moss", "nano", 100));
        config.endpoint = None;
        config.cache_dir = root.path().join("b");
        assert_ne!(original, download_fingerprint(&config, "moss", "nano", 100));
    }
}
