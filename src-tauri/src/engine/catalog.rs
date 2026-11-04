//! 目录组装：引擎 catalog × 离线盘点 → 应用层 `ModelEntry`。
use talechime::{Capabilities, Registry};

use super::{EngineState, ModelCapabilities, ModelEntry, inventory};

/// 构建绑定当前设置的 Registry。HFClient 构建开销可忽略，每次命令重建。
pub(crate) fn registry(state: &EngineState) -> anyhow::Result<Registry> {
    let config = state.settings().download_config()?;
    Registry::with_downloads(Some(config.cache_dir.join("castglean")), &config)
}

/// 模型中心快照：真实构建支持 + 盘点状态 + 进行中任务叠加。
pub(crate) fn list_models(state: &EngineState) -> anyhow::Result<Vec<ModelEntry>> {
    let registry = registry(state)?;
    let mut entries = Vec::new();
    for capabilities in registry.catalog()? {
        let backend = capabilities.backend.clone();
        let resource = inventory::from_engine(
            registry
                .resource_status(&backend, capabilities.model.as_deref())
                .unwrap_or(talechime::ResourceStatus::Missing { missing_bytes: 0 }),
        );
        let mut entry = to_entry(&capabilities, resource);
        // 转换型判定使用盘点事实；任务视图仅在当前进程内叠加。
        entry.convertible_locally = inventory::is_local_conversion(&entry);
        if let Some(task) = state.task_state(&entry.backend, &entry.model) {
            entry.resource = task;
        }
        entries.push(entry);
    }
    Ok(entries)
}

fn to_entry(capabilities: &Capabilities, resource: super::ResourceState) -> ModelEntry {
    ModelEntry {
        backend: capabilities.backend.clone(),
        model: capabilities.model.clone().unwrap_or_default(),
        name: capabilities.model_name.clone(),
        capabilities: ModelCapabilities {
            preset: !capabilities.voices.is_empty(),
            reference_cloning: capabilities.cloning,
            // 文字设计能力映射随 B2 音色中心接入按设计引擎目录细化。
            text_design: false,
            style: capabilities.style,
        },
        voices: u32::try_from(capabilities.voices.len()).unwrap_or(u32::MAX),
        resource,
        convertible_locally: false,
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
        assert!(!entry.capabilities.text_design);
        assert_eq!(entry.voices, 1);
        assert_eq!(entry.resource, super::super::ResourceState::Ready);
    }
}
