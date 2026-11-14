//! Session receipts for the native reference selector.
use sha2::{Digest, Sha256};
use std::collections::HashMap;

type Receipt = Result<Option<String>, String>;

#[derive(Default)]
pub(super) struct ReferenceReceipts {
    entries: HashMap<String, ([u8; 32], Receipt)>,
}

impl ReferenceReceipts {
    pub fn execute(
        &mut self,
        key: String,
        name: &str,
        transcript: &str,
        select: impl FnOnce() -> Receipt,
    ) -> Receipt {
        if key.is_empty() || key.len() > 128 {
            return Err("invalid reference request identity".into());
        }
        let mut hash = Sha256::new();
        hash.update((name.len() as u64).to_be_bytes());
        hash.update(name.as_bytes());
        hash.update(transcript.as_bytes());
        let fingerprint: [u8; 32] = hash.finalize().into();
        if let Some((old_fingerprint, result)) = self.entries.get(&key) {
            return if *old_fingerprint == fingerprint {
                result.clone()
            } else {
                Err("reference request identity reused with different parameters".into())
            };
        }
        if self.entries.len() >= 4096 {
            return Err("session reference identity limit reached; restart the application".into());
        }
        let result = select();
        self.entries.insert(key, (fingerprint, result.clone()));
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn successful_candidate_is_replayed_even_after_discard() {
        let root = tempfile::tempdir().unwrap();
        let mut store = super::super::store::Store::new(root.path().to_owned()).unwrap();
        let mut receipts = ReferenceReceipts::default();
        let first = receipts
            .execute("one".into(), "name", "text", || {
                store
                    .add(super::super::store::tests::candidate("reference-one"))
                    .map(|view| Some(view.id))
            })
            .unwrap()
            .unwrap();
        store.discard(&first).unwrap();
        let replay = receipts
            .execute("one".into(), "name", "text", || {
                panic!("candidate recreated")
            })
            .unwrap()
            .unwrap();
        assert_eq!(replay, first);
        assert!(store.candidates().is_empty());
    }
    #[test]
    fn cancellation_and_errors_are_replayed_without_opening_selector_again() {
        let mut receipts = ReferenceReceipts::default();
        assert!(
            receipts
                .execute("a".into(), "name", "text", || Ok(None))
                .unwrap()
                .is_none()
        );
        assert!(
            receipts
                .execute("a".into(), "name", "text", || panic!("reopened"))
                .unwrap()
                .is_none()
        );
        assert!(
            receipts
                .execute("a".into(), "other", "text", || panic!("reopened"))
                .is_err()
        );
        assert_eq!(
            receipts
                .execute("b".into(), "name", "text", || Err("invalid wav".into()))
                .unwrap_err(),
            "invalid wav"
        );
        assert_eq!(
            receipts
                .execute("b".into(), "name", "text", || panic!("reopened"))
                .unwrap_err(),
            "invalid wav"
        );
    }

    #[test]
    fn limit_rejects_new_identities_without_evicting_receipts() {
        let mut receipts = ReferenceReceipts::default();
        for index in 0..4096 {
            receipts
                .execute(index.to_string(), "name", "text", || Ok(None))
                .unwrap();
        }
        assert!(
            receipts
                .execute("new".into(), "name", "text", || panic!("over limit"))
                .is_err()
        );
        assert!(
            receipts
                .execute("0".into(), "name", "text", || panic!("evicted"))
                .unwrap()
                .is_none()
        );
    }
}
