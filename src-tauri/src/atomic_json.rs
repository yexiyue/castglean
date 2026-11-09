//! Replace mutable JSON documents through a synced temporary file in the same directory.
//! Locks, revisions and immutable-source no-clobber publication belong to callers.
use serde::Serialize;
use std::{io::Write, path::Path};

pub(crate) fn save(
    path: &Path,
    value: &impl Serialize,
    max_bytes: Option<u64>,
) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer(&mut temp, value)?;
    if let Some(limit) = max_bytes {
        anyhow::ensure!(
            temp.as_file().metadata()?.len() <= limit,
            "JSON document too large"
        );
    }
    temp.flush()?;
    temp.as_file().sync_all()?;
    temp.persist(path)?;
    // The replacement has committed. A directory sync failure cannot be reported as
    // a failed write: configuration callers would retain the wrong in-memory version.
    #[cfg(unix)]
    if let Ok(directory) = std::fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn oversized_replacement_keeps_the_previous_document() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        super::save(&path, &vec![1], None).unwrap();
        assert!(super::save(&path, &vec![2; 100], Some(3)).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "[1]");
        super::save(&path, &vec![3], None).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "[3]");
    }
}
