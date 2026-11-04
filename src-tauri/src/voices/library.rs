//! 基础库到应用语义的投影，不导出基础库类型和内部路径。
use super::*;
impl From<&talechime::VoiceAsset> for LibraryVoice {
    fn from(a: &talechime::VoiceAsset) -> Self {
        Self {
            id: a.id().into(),
            name: a.name().into(),
            transcript: a.transcript().into(),
            description: a.description().map(str::to_owned),
            source: match a.source() {
                talechime::VoiceSource::Imported => None,
                talechime::VoiceSource::Designed(engine) => Some(engine.clone()),
            },
            created_at: a.created_at_unix() as f64,
            imported_at: a.imported_at_unix() as f64,
            bytes: a.wav_bytes() as f64,
            duration: a.duration_seconds(),
        }
    }
}
impl VoiceState {
    pub(super) fn inventory(&self) -> Result<VoiceInventory, VoiceError> {
        let inventory = self.library.inventory().map_err(VoiceError::from)?;
        Ok(VoiceInventory {
            voices: inventory.assets.iter().map(LibraryVoice::from).collect(),
            diagnostics: inventory
                .diagnostics
                .into_iter()
                .map(|d| VoiceDiagnostic {
                    id: d.id,
                    error: d.error.into(),
                })
                .collect(),
        })
    }
}
pub(super) fn preview(id: u32, p: &talechime::ImportPreview) -> VoiceImportPreview {
    VoiceImportPreview {
        id,
        entries: p
            .entries()
            .iter()
            .map(|e| ImportVoiceEntry {
                index: e.index as u32,
                voice: LibraryVoice::from(&e.asset),
                sources: e.sources.iter().map(|s| s.package_index as u32).collect(),
                existing_id: e.existing_id.clone(),
                existing_voice: e.existing_asset.as_ref().map(LibraryVoice::from),
                conflicts: e
                    .conflicts
                    .iter()
                    .map(|c| match c {
                        talechime::ImportConflict::AlreadyPresent => VoiceConflict::AlreadyPresent,
                        talechime::ImportConflict::MetadataDifference => {
                            VoiceConflict::MetadataDifference
                        }
                        talechime::ImportConflict::IdentityConflict => {
                            VoiceConflict::IdentityConflict
                        }
                        talechime::ImportConflict::SameName => VoiceConflict::SameName,
                        talechime::ImportConflict::DuplicateContent => {
                            VoiceConflict::DuplicateContent
                        }
                    })
                    .collect(),
            })
            .collect(),
    }
}
