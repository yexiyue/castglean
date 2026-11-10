//! Read-time voice reference resolution against the current catalog.
//! Validity is computed, never stored: catalog changes surface without writes.
use super::types::{BindingError, CatalogSnapshot, CatalogVoice, PresetCatalogEntry, VoiceRef};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use tauri::Manager;

/// Why a binding or suggestion entry does not resolve right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VoiceValidity {
    Valid,
    LibraryMissing,
    PresetMissing,
}

/// The resolving side of the catalog: library asset ids and preset tuples that
/// the current library and engine build actually provide.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct CatalogView {
    library_ids: BTreeSet<String>,
    preset_keys: BTreeSet<(String, String, String)>,
}

impl CatalogView {
    pub(crate) fn from_parts(
        library_ids: impl IntoIterator<Item = String>,
        presets: impl IntoIterator<Item = (String, String, String)>,
    ) -> Self {
        Self {
            library_ids: library_ids.into_iter().collect(),
            preset_keys: presets.into_iter().collect(),
        }
    }

    /// A frozen casting snapshot resolves the same way the live catalog does.
    pub(crate) fn from_snapshot(snapshot: &CatalogSnapshot) -> Self {
        Self::from_parts(
            snapshot.library.iter().map(|voice| voice.id.clone()),
            snapshot.presets.iter().map(|preset| {
                (
                    preset.backend.clone(),
                    preset.model.clone(),
                    preset.voice.clone(),
                )
            }),
        )
    }

    pub(crate) fn evaluate(&self, voice: &VoiceRef) -> VoiceValidity {
        match voice {
            VoiceRef::Library { id } => {
                if self.library_ids.contains(id) {
                    VoiceValidity::Valid
                } else {
                    VoiceValidity::LibraryMissing
                }
            }
            VoiceRef::Preset {
                backend,
                model,
                voice,
            } => {
                if self
                    .preset_keys
                    .contains(&(backend.clone(), model.clone(), voice.clone()))
                {
                    VoiceValidity::Valid
                } else {
                    VoiceValidity::PresetMissing
                }
            }
        }
    }
}

/// Async IPC reads keep filesystem inventory work off the host runtime.
pub(crate) async fn read(app: tauri::AppHandle) -> Result<CatalogSnapshot, BindingError> {
    tauri::async_runtime::spawn_blocking(move || snapshot(&app))
        .await
        .map_err(|_| BindingError::ReadFailed)?
}

/// Full catalog snapshot with labels and descriptions, frozen for casting runs.
pub(crate) fn snapshot(app: &tauri::AppHandle) -> Result<CatalogSnapshot, BindingError> {
    let voices = app
        .state::<crate::voices::VoiceState>()
        .catalog_voices()
        .map_err(|_| BindingError::ReadFailed)?;
    let engine_state = app.state::<crate::engine::EngineState>();
    let models =
        crate::engine::catalog::list_models(&engine_state).map_err(|_| BindingError::ReadFailed)?;
    Ok(CatalogSnapshot {
        library: voices
            .into_iter()
            .map(|voice| CatalogVoice {
                id: voice.id,
                name: voice.name,
                description: voice.description,
            })
            .collect(),
        presets: models
            .into_iter()
            .flat_map(|entry| {
                let backend = entry.backend;
                let model = entry.model;
                entry
                    .voice_catalog
                    .into_iter()
                    .map(move |voice| PresetCatalogEntry {
                        backend: backend.clone(),
                        model: model.clone(),
                        voice: voice.id,
                        name: voice.name,
                    })
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view() -> CatalogView {
        CatalogView::from_parts(
            ["voice-a".to_owned(), "voice-b".to_owned()],
            [
                ("cpu".to_owned(), "kokoro".to_owned(), "zf_1".to_owned()),
                ("metal".to_owned(), "qwen".to_owned(), "v2".to_owned()),
            ],
        )
    }

    #[test]
    fn resolves_library_and_preset_references() {
        let view = view();
        assert_eq!(
            view.evaluate(&VoiceRef::Library {
                id: "voice-a".into()
            }),
            VoiceValidity::Valid
        );
        assert_eq!(
            view.evaluate(&VoiceRef::Library {
                id: "voice-gone".into()
            }),
            VoiceValidity::LibraryMissing
        );
        assert_eq!(
            view.evaluate(&VoiceRef::Preset {
                backend: "cpu".into(),
                model: "kokoro".into(),
                voice: "zf_1".into()
            }),
            VoiceValidity::Valid
        );
        for (backend, model, voice) in [
            ("cpu", "kokoro", "zf_2"),
            ("cpu", "removed", "zf_1"),
            ("gpu", "kokoro", "zf_1"),
        ] {
            assert_eq!(
                view.evaluate(&VoiceRef::Preset {
                    backend: backend.into(),
                    model: model.into(),
                    voice: voice.into()
                }),
                VoiceValidity::PresetMissing
            );
        }
    }

    #[test]
    fn preset_resolution_preserves_tuple_boundaries() {
        let catalog = CatalogView::from_parts([], [("cpu/a".into(), "b".into(), "one".into())]);
        assert_eq!(
            catalog.evaluate(&VoiceRef::Preset {
                backend: "cpu".into(),
                model: "a/b".into(),
                voice: "one".into(),
            }),
            VoiceValidity::PresetMissing
        );
    }

    #[test]
    fn snapshot_and_live_parts_agree() {
        let snapshot = CatalogSnapshot {
            library: vec![super::super::types::CatalogVoice {
                id: "voice-a".into(),
                name: "A".into(),
                description: None,
            }],
            presets: vec![super::super::types::PresetCatalogEntry {
                backend: "cpu".into(),
                model: "kokoro".into(),
                voice: "zf_1".into(),
                name: "一号".into(),
            }],
        };
        let from_snapshot = CatalogView::from_snapshot(&snapshot);
        let from_parts = CatalogView::from_parts(
            ["voice-a".to_owned()],
            [("cpu".to_owned(), "kokoro".to_owned(), "zf_1".to_owned())],
        );
        assert_eq!(from_snapshot, from_parts);
    }
}
