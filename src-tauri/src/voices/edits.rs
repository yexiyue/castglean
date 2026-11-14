//! Session receipts for library metadata edits.
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct EditReceipts {
    entries: HashMap<String, ([u8; 32], Result<(), String>)>,
}

impl EditReceipts {
    pub(super) fn execute(
        &mut self,
        operation_id: &str,
        voice_id: &str,
        field: &str,
        value: Option<&str>,
        write: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        uuid::Uuid::parse_str(operation_id).map_err(|_| "invalid edit identity")?;
        let mut digest = Sha256::new();
        for part in [voice_id, field] {
            digest.update((part.len() as u64).to_be_bytes());
            digest.update(part.as_bytes());
        }
        match value {
            Some(value) => {
                digest.update([1]);
                digest.update(value.as_bytes());
            }
            None => digest.update([0]),
        }
        let fingerprint = digest.finalize().into();
        if let Some((original, result)) = self.entries.get(operation_id) {
            return if original == &fingerprint {
                result.clone()
            } else {
                Err("edit identity reused with different input".into())
            };
        }
        if self.entries.len() >= 4096 {
            return Err("voice edit identity limit reached".into());
        }
        // A storage error can occur after the atomic rename. Cache errors too:
        // replay must never perform a potentially committed edit a second time.
        let result = write();
        self.entries
            .insert(operation_id.to_owned(), (fingerprint, result.clone()));
        result
    }
}

#[cfg(test)]
mod tests {
    use super::EditReceipts;
    use talechime::VoiceLibrary;

    #[test]
    fn replay_never_overwrites_a_later_edit_and_rejects_changed_request() {
        let root = tempfile::tempdir().unwrap();
        let library = VoiceLibrary::open(root.path()).unwrap();
        let mut wav = std::io::Cursor::new(Vec::new());
        let mut writer = hound::WavWriter::new(
            &mut wav,
            hound::WavSpec {
                channels: 1,
                sample_rate: 24000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        for _ in 0..2400 {
            writer.write_sample(100i16).unwrap();
        }
        writer.finalize().unwrap();
        let asset = library
            .create(
                "voice-one",
                "Original",
                &wav.into_inner(),
                "示例",
                None,
                talechime::VoiceSource::Imported,
            )
            .unwrap();
        let mut receipts = EditReceipts::default();
        let id = uuid::Uuid::new_v4().to_string();
        let write = || {
            library
                .rename(asset.id(), "First")
                .map(|_| ())
                .map_err(|error| error.to_string())
        };
        receipts
            .execute(&id, asset.id(), "name", Some("First"), write)
            .unwrap();
        library.rename(asset.id(), "Later human edit").unwrap();
        receipts
            .execute(&id, asset.id(), "name", Some("First"), || {
                panic!("replayed write")
            })
            .unwrap();
        assert_eq!(library.get(asset.id()).unwrap().name(), "Later human edit");
        assert!(
            receipts
                .execute(&id, asset.id(), "name", Some("Other"), || panic!(
                    "different request"
                ))
                .is_err()
        );
    }

    #[test]
    fn failed_write_is_not_repeated_after_an_unknown_storage_outcome() {
        let mut receipts = EditReceipts::default();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(
            receipts
                .execute(&id, "voice", "description", None, || Err(
                    "storage failed".into()
                ))
                .is_err()
        );
        assert!(
            receipts
                .execute(&id, "voice", "description", None, || panic!(
                    "repeated failure"
                ))
                .is_err()
        );
        assert!(
            receipts
                .execute(&id, "voice", "description", Some(""), || panic!(
                    "changed request"
                ))
                .is_err()
        );
    }

    #[test]
    fn capacity_preserves_existing_receipts_and_rejects_new_writes() {
        let mut receipts = EditReceipts::default();
        let first = uuid::Uuid::new_v4().to_string();
        receipts
            .execute(&first, "voice", "name", Some("first"), || Ok(()))
            .unwrap();
        for _ in 1..4096 {
            receipts
                .execute(
                    &uuid::Uuid::new_v4().to_string(),
                    "voice",
                    "name",
                    None,
                    || Ok(()),
                )
                .unwrap();
        }
        assert!(
            receipts
                .execute(
                    &uuid::Uuid::new_v4().to_string(),
                    "voice",
                    "name",
                    None,
                    || panic!("capacity must reject before writing")
                )
                .is_err()
        );
        receipts
            .execute(&first, "voice", "name", Some("first"), || {
                panic!("receipt was evicted")
            })
            .unwrap();
    }
}
