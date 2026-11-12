//! Candidate and media lifetimes. No model or frontend state lives here.
use super::*;
use std::{collections::BTreeMap, io::Write, path::PathBuf, sync::Arc};
use talechime::{VoiceCandidate, VoiceLibrary};
use tempfile::{NamedTempFile, TempDir};

pub(super) struct Media {
    pub file: NamedTempFile,
    pub waveform: Option<VoiceWaveform>,
    pub asset: Option<String>,
    pub leases: std::collections::HashSet<String>,
    pub retained: bool,
}
struct Candidate {
    reference: Arc<VoiceCandidate>,
    view: CandidateView,
}
pub(super) struct Store {
    _lease: std::fs::File,
    root: TempDir,
    candidates: BTreeMap<String, Candidate>,
    pub media: BTreeMap<String, Media>,
}
impl Store {
    pub fn new(cache: PathBuf) -> anyhow::Result<Self> {
        let cache = cache.join("voice-studio");
        std::fs::create_dir_all(&cache)?;
        recover(&cache, std::time::Duration::from_secs(300))?;
        let root = tempfile::Builder::new()
            .prefix("session-")
            .tempdir_in(cache)?;
        let lease = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(root.path().join(".lease"))?;
        lease.try_lock()?;
        Ok(Self {
            _lease: lease,
            root,
            candidates: BTreeMap::new(),
            media: BTreeMap::new(),
        })
    }
    pub fn candidates(&self) -> Vec<CandidateView> {
        self.candidates.values().map(|c| c.view.clone()).collect()
    }
    pub fn reference(&self, id: &str) -> Result<Arc<VoiceCandidate>, String> {
        self.candidates
            .get(id)
            .map(|c| c.reference.clone())
            .ok_or("unknown candidate".into())
    }
    pub fn add(&mut self, candidate: VoiceCandidate) -> Result<CandidateView, String> {
        let total: usize = self
            .candidates
            .values()
            .map(|c| c.reference.wav().len())
            .sum();
        if self.candidates.len() >= 8
            || candidate.wav().len() > 25 * 1024 * 1024
            || total + candidate.wav().len() > 200 * 1024 * 1024
        {
            return Err("candidate budget exceeded; discard a candidate first".into());
        }
        let id = candidate.asset().id().to_owned();
        if self.candidates.contains_key(&id) {
            return Err("candidate identity collision".into());
        }
        let audio = self.audio(candidate.wav(), None)?;
        let view = CandidateView {
            id: id.clone(),
            voice: candidate.asset().into(),
            audio,
            saved_id: None,
        };
        self.candidates.insert(
            id,
            Candidate {
                reference: Arc::new(candidate),
                view: view.clone(),
            },
        );
        Ok(view)
    }
    pub fn audio(&mut self, wav: &[u8], asset: Option<String>) -> Result<String, String> {
        if wav.len() > 25 * 1024 * 1024 || self.media.len() >= 40 {
            return Err("audio budget exceeded".into());
        }
        let mut file = NamedTempFile::new_in(self.root.path()).map_err(|e| e.to_string())?;
        file.write_all(wav)
            .and_then(|()| file.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().simple().to_string();
        self.media.insert(
            id.clone(),
            Media {
                file,
                waveform: None,
                asset,
                leases: Default::default(),
                retained: true,
            },
        );
        Ok(id)
    }
    pub fn save(
        &mut self,
        id: &str,
        library: &VoiceLibrary,
    ) -> Result<super::super::LibraryVoice, String> {
        let candidate = self.candidates.get_mut(id).ok_or("unknown candidate")?;
        if let Some(id) = &candidate.view.saved_id {
            return library
                .get(id)
                .map(|a| (&a).into())
                .map_err(|e| e.to_string());
        }
        // Library entry requires a description; designed voices carry one by
        // construction, reference recordings collect it in the creation flow.
        if candidate
            .reference
            .asset()
            .description()
            .is_none_or(|text| text.trim().is_empty())
        {
            return Err("voice description is required".into());
        }
        let asset = library
            .save_candidate(&candidate.reference)
            .map_err(|e| e.to_string())?;
        candidate.view.saved_id = Some(asset.id().into());
        Ok((&asset).into())
    }
    pub fn discard(&mut self, id: &str) -> Result<(), String> {
        let candidate = self.candidates.get(id).ok_or("unknown candidate")?;
        if self
            .media
            .get(&candidate.view.audio)
            .is_some_and(|m| !m.leases.is_empty())
            || Arc::strong_count(&candidate.reference) != 1
        {
            return Err("candidate is busy".into());
        }
        self.media.remove(&candidate.view.audio);
        self.candidates.remove(id);
        Ok(())
    }
    pub fn asset_busy(&self, id: &str) -> bool {
        self.media
            .values()
            .any(|m| m.asset.as_deref() == Some(id) && !m.leases.is_empty())
    }
}

pub(super) fn recover(
    cache: &std::path::Path,
    grace: std::time::Duration,
) -> std::io::Result<usize> {
    match std::fs::symlink_metadata(cache) {
        Ok(metadata) if metadata.is_dir() => (),
        Ok(_) => return Err(std::io::Error::other("voice cache is not a directory")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    }
    let mut removed = 0;
    for entry in std::fs::read_dir(cache)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(suffix) = name.to_str().and_then(|name| name.strip_prefix("session-")) else {
            continue;
        };
        if !entry.file_type()?.is_dir()
            || suffix.len() != 6
            || !suffix.bytes().all(|b| b.is_ascii_alphanumeric())
        {
            continue;
        }
        let stale = entry
            .metadata()?
            .modified()?
            .elapsed()
            .is_ok_and(|age| age > grace);
        if !stale {
            continue;
        }
        let lease_path = entry.path().join(".lease");
        if std::fs::symlink_metadata(&lease_path).is_ok_and(|metadata| metadata.is_file())
            && let Ok(lease) = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&lease_path)
            && lease.try_lock().is_ok()
        {
            std::fs::remove_dir_all(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    pub(in crate::voices::studio) fn candidate(id: &str) -> VoiceCandidate {
        candidate_inner(id, Some("清晰的女声，语速适中"))
    }
    fn candidate_inner(id: &str, described: Option<&str>) -> VoiceCandidate {
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
        for _ in 0..2400 {
            writer.write_sample(100i16).unwrap();
        }
        writer.finalize().unwrap();
        VoiceCandidate::new(
            id,
            "参考声音",
            bytes.into_inner(),
            "准确转写",
            described,
            talechime::VoiceSource::Imported,
        )
        .unwrap()
    }
    pub(in crate::voices::studio) fn plain_candidate(id: &str) -> VoiceCandidate {
        candidate_inner(id, None)
    }
    pub(in crate::voices::studio) fn described_candidate(id: &str) -> VoiceCandidate {
        candidate_inner(id, Some("清晰的女声，语速适中"))
    }
    #[test]
    fn save_replay_and_busy_discard_preserve_validated_candidate() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::new(root.path().join("cache")).unwrap();
        let library = VoiceLibrary::open(root.path().join("library")).unwrap();
        let view = store.add(candidate("candidate-one")).unwrap();
        assert!(library.list().unwrap().is_empty());
        let held = store.reference(&view.id).unwrap();
        assert!(store.discard(&view.id).is_err());
        drop(held);
        store
            .media
            .get_mut(&view.audio)
            .unwrap()
            .leases
            .insert("test".into());
        assert!(store.discard(&view.id).is_err());
        store.media.get_mut(&view.audio).unwrap().leases.clear();
        assert_eq!(
            store.save(&view.id, &library).unwrap().id,
            store.save(&view.id, &library).unwrap().id
        );
        assert_eq!(library.list().unwrap().len(), 1);
        store.discard(&view.id).unwrap();
        assert!(store.media.is_empty());
        assert_eq!(library.list().unwrap().len(), 1);
    }
    #[test]
    fn budget_failure_does_not_remove_old_candidates() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::new(root.path().into()).unwrap();
        for index in 0..8 {
            store.add(candidate(&format!("voice-{index}"))).unwrap();
        }
        assert!(store.add(candidate("overflow")).is_err());
        assert_eq!(store.candidates().len(), 8);
    }
    #[test]
    fn failed_save_keeps_candidate_and_existing_files() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::new(root.path().join("cache")).unwrap();
        let view = store.add(candidate("voice-one")).unwrap();
        let blocked = root.path().join("blocked");
        let library = VoiceLibrary::open(&blocked).unwrap();
        std::fs::write(&blocked, b"keep").unwrap();
        assert!(store.save(&view.id, &library).is_err());
        assert!(store.candidates()[0].saved_id.is_none());
        assert_eq!(std::fs::read(blocked).unwrap(), b"keep");
    }
    #[test]
    fn recovery_keeps_active_sessions_and_unrelated_files() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().into()).unwrap();
        let cache = root.path().join("voice-studio");
        let stale = cache.join("session-orphan");
        std::fs::create_dir_all(&stale).unwrap();
        std::fs::write(stale.join(".lease"), b"").unwrap();
        let unrelated = cache.join("user-file");
        std::fs::write(&unrelated, b"keep").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.path(), cache.join("session-link01")).unwrap();
            let linked_lease = cache.join("session-linked");
            std::fs::create_dir(&linked_lease).unwrap();
            std::os::unix::fs::symlink(&unrelated, linked_lease.join(".lease")).unwrap();
        }
        assert_eq!(recover(&cache, std::time::Duration::ZERO).unwrap(), 1);
        assert!(store.root.path().exists());
        assert!(!stale.exists());
        assert_eq!(std::fs::read(unrelated).unwrap(), b"keep");
        #[cfg(unix)]
        assert!(cache.join("session-linked").exists());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_refuses_a_symlinked_cache_directory() {
        let root = tempfile::tempdir().unwrap();
        let other = root.path().join("other");
        std::fs::create_dir(&other).unwrap();
        std::fs::write(other.join("keep"), b"user data").unwrap();
        let link = root.path().join("voice-studio");
        std::os::unix::fs::symlink(&other, &link).unwrap();
        assert!(recover(&link, std::time::Duration::ZERO).is_err());
        assert_eq!(std::fs::read(other.join("keep")).unwrap(), b"user data");
    }

    #[test]
    fn save_rejects_candidates_without_description() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::new(root.path().join("cache")).unwrap();
        let library = VoiceLibrary::open(root.path().join("library")).unwrap();
        let view = store.add(plain_candidate("plain")).unwrap();
        let error = store.save(&view.id, &library).unwrap_err();
        assert_eq!(error, "voice description is required");
        assert!(library.list().unwrap().is_empty());
        let described = store.add(described_candidate("described")).unwrap();
        let saved = store.save(&described.id, &library).unwrap();
        assert!(saved.description.is_some());
    }
}
