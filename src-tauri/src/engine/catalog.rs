//! 目录组装：引擎 catalog × 离线盘点 → 应用层 `ModelEntry`。
use talechime::{Capabilities, Registry};

use super::{EngineState, ModelCapabilities, ModelEntry, inventory};

/// 按当前显式下载设置构建 Registry。
pub(crate) fn registry(state: &EngineState) -> anyhow::Result<Registry> {
    state.registry()
}

/// 模型中心快照：真实构建支持 + 盘点状态 + 进行中任务叠加。
pub(crate) async fn list_models(state: &EngineState) -> anyhow::Result<Vec<ModelEntry>> {
    let started = std::time::Instant::now();
    let registry = registry(state)?;
    let mut entries = Vec::new();
    for capabilities in registry.catalog()? {
        let backend = capabilities.backend.clone();
        let resource = match registry
            .resource_status(&backend, capabilities.model.as_deref())
            .await
        {
            Ok(status) => inventory::from_engine(status),
            Err(error) => super::ResourceState::Failed {
                error: inventory::classify_failure(&error),
                missing_bytes: 0.0,
            },
        };
        let mut entry = to_entry(&capabilities, resource);
        entry.available_devices = registry
            .available_devices_for(&backend, capabilities.model.as_deref())
            .into_iter()
            .filter_map(super::InferenceDevice::from_engine)
            .collect();
        entry.unavailable_reason = if entry.compiled_devices.is_empty() {
            Some(super::ModelUnavailableReason::NoCompiledDevice)
        } else if entry.available_devices.is_empty() {
            Some(super::ModelUnavailableReason::NoAvailableDevice)
        } else {
            None
        };
        if let Some(task) = state.task_state(&entry.backend, &entry.model)
            && (task.active()
                || matches!(
                    entry.resource,
                    super::ResourceState::Missing { .. } | super::ResourceState::Partial { .. }
                ))
        {
            entry.resource = task;
        }
        entries.push(entry);
    }
    tracing::info!(
        event = "model_inventory_complete",
        models = entries.len(),
        ready = entries
            .iter()
            .filter(|entry| matches!(entry.resource, super::ResourceState::Ready))
            .count(),
        duration_ms = started.elapsed().as_millis() as u64,
    );
    Ok(entries)
}

fn to_entry(capabilities: &Capabilities, resource: super::ResourceState) -> ModelEntry {
    ModelEntry {
        backend: capabilities.backend.clone(),
        model: capabilities.model.clone().unwrap_or_default(),
        name: capabilities.model_name.clone(),
        compiled_devices: capabilities
            .compiled_devices
            .iter()
            .cloned()
            .filter_map(super::InferenceDevice::from_engine)
            .collect(),
        available_devices: vec![],
        voice_catalog: capabilities
            .voices
            .iter()
            .filter(|id| !id.starts_with("custom:"))
            .map(|id| super::PresetVoice {
                id: id.clone(),
                name: capabilities.voice_names.get(id).unwrap_or(id).clone(),
            })
            .collect(),
        capabilities: ModelCapabilities {
            preset: !capabilities.voices.is_empty(),
            reference_cloning: capabilities.cloning,
            style: capabilities.style,
        },
        voices: u32::try_from(capabilities.voices.len()).unwrap_or(u32::MAX),
        resource,
        unavailable_reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_entry_maps_capabilities_honestly() {
        let capabilities = Capabilities {
            backend: "moss".into(),
            model: Some("nano-candle".into()),
            model_name: "MOSS Nano Candle".into(),
            voices: vec!["Weiguo".into()],
            default_voice: "Weiguo".into(),
            voice_names: Default::default(),
            native_streaming: true,
            cloning: true,
            style: false,
            compiled_devices: vec![],
            pronunciation: false,
            parameters: vec![],
        };
        let entry = to_entry(&capabilities, super::super::ResourceState::Ready);
        assert!(entry.capabilities.preset);
        assert!(entry.capabilities.reference_cloning);
        assert!(entry.available_devices.is_empty());
        assert_eq!(entry.voice_catalog[0].id, "Weiguo");
        assert_eq!(entry.voices, 1);
        assert_eq!(entry.resource, super::super::ResourceState::Ready);
    }

    #[tokio::test]
    async fn invalid_cache_path_fails_catalog_then_valid_path_recovers() {
        let root = tempfile::tempdir().unwrap();
        let state = EngineState::new(
            root.path().join("settings.json"),
            "relative-cache".into(),
            root.path().join("data"),
            root.path().join("app-cache"),
        );
        let error = list_models(&state).await.unwrap_err();
        assert!(error.to_string().contains("下载缓存目录必须是绝对路径"));

        state.settings.lock().unwrap().cache_dir = Some(root.path().join("hub"));
        let entries = list_models(&state).await.unwrap();
        assert!(
            !entries.is_empty(),
            "compiled catalog must be returned after recovery"
        );
        assert!(entries.iter().all(|entry| !entry.backend.is_empty()));
        assert!(
            entries
                .iter()
                .flat_map(|entry| &entry.voice_catalog)
                .all(|voice| !voice.id.is_empty())
        );
    }
}
