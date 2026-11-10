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
        // The SDK takes a non-waiting filesystem lock even for inventory reads.
        // Concurrent IPC projections must queue locally instead of reporting Busy.
        let _read = self
            .catalog_reads
            .lock()
            .map_err(|_| VoiceError::new(VoiceFailure::Unavailable))?;
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_catalog_readers_do_not_report_a_busy_library() {
        let root = tempfile::tempdir().unwrap();
        let state = std::sync::Arc::new(VoiceState::new(root.path().join("voices")).unwrap());
        let mut bytes = std::io::Cursor::new(Vec::new());
        let mut writer = hound::WavWriter::new(
            &mut bytes,
            hound::WavSpec {
                channels: 1,
                sample_rate: 24000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        for _ in 0..24000 {
            writer.write_sample(0_i16).unwrap();
        }
        writer.finalize().unwrap();
        state
            .library
            .create(
                "public-voice",
                "公开样例",
                bytes.get_ref(),
                "公开参考音频",
                Some("验收测试描述"),
                talechime::VoiceSource::Imported,
            )
            .unwrap();
        let start = std::sync::Arc::new(std::sync::Barrier::new(8));
        let readers: Vec<_> = (0..8)
            .map(|_| {
                let state = state.clone();
                let start = start.clone();
                std::thread::spawn(move || {
                    start.wait();
                    for _ in 0..32 {
                        assert_eq!(state.catalog_voices().unwrap().len(), 1);
                    }
                })
            })
            .collect();
        for reader in readers {
            reader.join().unwrap();
        }
    }
}
