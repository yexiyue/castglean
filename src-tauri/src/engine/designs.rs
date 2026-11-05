//! Independent design engines, not narration model aliases.
use super::{EngineState, InferenceDevice, catalog};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub(crate) struct DesignEngineEntry {
    pub id: String,
    pub name: String,
    pub devices: Vec<InferenceDevice>,
    pub ready: bool,
    pub resource: super::ResourceState,
    pub missing_bytes: f64,
    pub reuses_synthesis_model: bool,
    pub text_max_chars: u32,
    pub description_max_chars: Option<u32>,
    pub description_max_bytes: u32,
    pub forbid_parentheses: bool,
}
pub(crate) fn list(state: &EngineState) -> anyhow::Result<Vec<DesignEngineEntry>> {
    Ok(catalog::registry(state)?
        .designers()
        .into_iter()
        .map(|info| DesignEngineEntry {
            id: info.id.into(),
            name: info.name.into(),
            devices: info
                .devices
                .into_iter()
                .filter_map(InferenceDevice::from_engine)
                .collect(),
            ready: info.ready,
            resource: if info.ready {
                super::ResourceState::Ready
            } else {
                state
                    .resource_task_state(&super::ResourceKey::Design {
                        engine: info.id.into(),
                    })
                    .unwrap_or(super::ResourceState::Missing {
                        missing_bytes: info.extra_download_bytes as f64,
                    })
            },
            missing_bytes: info.extra_download_bytes as f64,
            reuses_synthesis_model: info.reuses_synthesis_model,
            text_max_chars: info.inputs.text_max_chars as u32,
            description_max_chars: info.inputs.description_max_chars.map(|n| n as u32),
            description_max_bytes: info.inputs.description_max_bytes as u32,
            forbid_parentheses: info.inputs.forbid_parentheses,
        })
        .collect())
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn list_design_engines(
    app: tauri::AppHandle,
) -> Result<Vec<DesignEngineEntry>, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        list(&app.state::<EngineState>()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
