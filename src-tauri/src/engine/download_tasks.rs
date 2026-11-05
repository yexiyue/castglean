//! Durable host task views, scoped to a cache directory. Transfer checkpoints
//! remain owned by TaleChime; this file never stores credentials or remote URLs.
use super::ResourceState;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    cache_dir: PathBuf,
    backend: String,
    model: String,
    state: ResourceState,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Stored {
    version: u32,
    tasks: Vec<Record>,
}
pub(super) struct DownloadTasks {
    path: PathBuf,
    cache: PathBuf,
    records: Vec<Record>,
    last_save: Option<Instant>,
    load_error: Option<String>,
}
impl DownloadTasks {
    pub fn load(path: PathBuf, cache: PathBuf) -> Self {
        let result = (|| -> anyhow::Result<Vec<Record>> {
            if !path.exists() {
                return Ok(vec![]);
            }
            anyhow::ensure!(
                std::fs::metadata(&path)?.len() <= 4 * 1024 * 1024,
                "download task journal too large"
            );
            let stored: Stored = serde_json::from_slice(&std::fs::read(&path)?)?;
            anyhow::ensure!(
                stored.version == 1 && stored.tasks.len() <= 1024,
                "unsupported download task journal"
            );
            let mut keys = std::collections::HashSet::new();
            for record in &stored.tasks {
                anyhow::ensure!(
                    record.cache_dir.is_absolute()
                        && record.backend.len() <= 256
                        && record.model.len() <= 256
                        && keys.insert((
                            record.cache_dir.clone(),
                            record.backend.clone(),
                            record.model.clone()
                        ))
                        && valid(&record.state),
                    "invalid download task journal"
                );
            }
            Ok(stored.tasks)
        })();
        let (records, load_error) = match result {
            Ok(records) => (records, None),
            Err(error) => (vec![], Some(error.to_string())),
        };
        Self {
            path,
            cache,
            records,
            last_save: None,
            load_error,
        }
    }
    pub fn restored(&self) -> HashMap<(String, String), ResourceState> {
        self.records
            .iter()
            .filter(|r| r.cache_dir == self.cache)
            .map(|r| {
                (
                    (r.backend.clone(), r.model.clone()),
                    paused(&r.state).unwrap_or_else(|| r.state.clone()),
                )
            })
            .collect()
    }
    pub fn switch_cache(&mut self, cache: PathBuf) -> HashMap<(String, String), ResourceState> {
        self.cache = cache;
        self.restored()
    }
    pub fn save(
        &mut self,
        states: &HashMap<(String, String), ResourceState>,
        force: bool,
    ) -> anyhow::Result<()> {
        if let Some(error) = &self.load_error {
            anyhow::bail!("download task journal unavailable: {error}");
        }
        if !force
            && self
                .last_save
                .is_some_and(|t| t.elapsed() < Duration::from_secs(1))
        {
            return Ok(());
        }
        let mut records: Vec<_> = self
            .records
            .iter()
            .filter(|r| r.cache_dir != self.cache)
            .cloned()
            .collect();
        for ((backend, model), state) in states {
            records.push(Record {
                cache_dir: self.cache.clone(),
                backend: backend.clone(),
                model: model.clone(),
                state: state.clone(),
            });
        }
        anyhow::ensure!(records.len() <= 1024, "too many saved download tasks");
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let parent = self.path.parent().unwrap_or(Path::new("."));
        let mut temp = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer(
            &mut temp,
            &Stored {
                version: 1,
                tasks: records.clone(),
            },
        )?;
        anyhow::ensure!(
            temp.as_file().metadata()?.len() <= 4 * 1024 * 1024,
            "download task journal too large"
        );
        temp.as_file_mut().sync_all()?;
        temp.persist(&self.path)?;
        #[cfg(unix)]
        std::fs::File::open(parent)?.sync_all()?;
        self.records = records;
        self.last_save = Some(Instant::now());
        Ok(())
    }
}
fn valid(state: &ResourceState) -> bool {
    match state {
        ResourceState::Downloading {
            downloaded_bytes,
            total_bytes,
            ..
        }
        | ResourceState::Paused {
            downloaded_bytes,
            total_bytes,
            ..
        } => {
            downloaded_bytes.is_finite()
                && total_bytes.is_finite()
                && *downloaded_bytes >= 0.0
                && *total_bytes >= *downloaded_bytes
        }
        ResourceState::Failed { missing_bytes, .. } => {
            missing_bytes.is_finite() && *missing_bytes >= 0.0
        }
        _ => false,
    }
}
pub(super) fn paused(state: &ResourceState) -> Option<ResourceState> {
    match state {
        ResourceState::Downloading {
            downloaded_bytes,
            total_bytes,
            current_file,
            ..
        }
        | ResourceState::Paused {
            downloaded_bytes,
            total_bytes,
            current_file,
        } => Some(ResourceState::Paused {
            downloaded_bytes: *downloaded_bytes,
            total_bytes: *total_bytes,
            current_file: current_file.clone(),
        }),
        _ => None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_pauses_downloads_and_cache_switch_preserves_other_records() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("tasks.json");
        let cache = root.path().join("cache-a");
        let cache_b = root.path().join("cache-b");
        let state = ResourceState::Downloading {
            downloaded_bytes: 12.0,
            total_bytes: 100.0,
            current_file: Some("weights".into()),
            bytes_per_second: Some(3.0),
            remaining_seconds: Some(30.0),
            stalled: false,
        };
        let states = [(("moss".into(), "nano".into()), state.clone())].into();
        let mut journal = DownloadTasks::load(path.clone(), cache.clone());
        journal.save(&states, true).unwrap();
        let mut restarted = DownloadTasks::load(path.clone(), cache.clone());
        assert_eq!(
            restarted.restored().values().next(),
            paused(&state).as_ref()
        );
        assert!(restarted.switch_cache(cache_b).is_empty());
        restarted.save(&HashMap::new(), true).unwrap();
        assert_eq!(restarted.switch_cache(cache).len(), 1);
        restarted.save(&HashMap::new(), true).unwrap();
        assert!(
            DownloadTasks::load(path, root.path().join("cache-a"))
                .restored()
                .is_empty()
        );
    }
    #[test]
    fn invalid_journal_is_never_overwritten() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("tasks.json");
        std::fs::write(&path, b"private invalid data").unwrap();
        let mut journal = DownloadTasks::load(path.clone(), root.path().join("cache"));
        assert!(journal.save(&HashMap::new(), true).is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"private invalid data");
    }
}
