//! Immutable source files. Paths are derived from verified digests, never database paths.
use super::{ProjectError, Source, hash};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};

fn path(root: &Path, digest: &str, extension: &str) -> Result<PathBuf, ProjectError> {
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(ProjectError::InvalidProject);
    }
    Ok(root.join(format!("{digest}.{extension}")))
}

fn read(root: &Path, digest: &str, extension: &str, limit: usize) -> Result<Vec<u8>, ProjectError> {
    let mut bytes = Vec::new();
    std::fs::File::open(path(root, digest, extension)?)
        .map_err(|_| ProjectError::ReadFailed)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ProjectError::ReadFailed)?;
    if bytes.len() > limit {
        return Err(ProjectError::TooLarge);
    }
    if hash(&bytes) != digest {
        return Err(ProjectError::ChecksumMismatch);
    }
    Ok(bytes)
}

fn write(root: &Path, digest: &str, extension: &str, bytes: &[u8]) -> Result<(), ProjectError> {
    if hash(bytes) != digest {
        return Err(ProjectError::ChecksumMismatch);
    }
    let target = path(root, digest, extension)?;
    if target.exists() {
        let existing = read(root, digest, extension, bytes.len())?;
        if existing != bytes {
            return Err(ProjectError::ChecksumMismatch);
        }
        return Ok(());
    }
    std::fs::create_dir_all(root).map_err(|_| ProjectError::WriteFailed)?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(root).map_err(|_| ProjectError::WriteFailed)?;
    temporary
        .write_all(bytes)
        .map_err(|_| ProjectError::WriteFailed)?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| ProjectError::WriteFailed)?;
    match temporary.persist_noclobber(&target) {
        Ok(_) => Ok(()),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            if read(root, digest, extension, bytes.len())? == bytes {
                Ok(())
            } else {
                Err(ProjectError::ChecksumMismatch)
            }
        }
        Err(_) => Err(ProjectError::WriteFailed),
    }
}

pub(crate) fn publish_source(root: &Path, source: &Source, raw: &[u8]) -> Result<(), ProjectError> {
    if raw.len() > 32 * 1024 * 1024 || source.text.len() > super::MAX_SOURCE {
        return Err(ProjectError::TooLarge);
    }
    if crate::novel_import::decode_source(raw, &source.encoding)? != source.text {
        return Err(ProjectError::ChecksumMismatch);
    }
    write(root, &source.raw_sha256, "raw", raw)?;
    write(root, &source.sha256, "txt", source.text.as_bytes())
}

pub(crate) fn text(root: &Path, digest: &str) -> Result<String, ProjectError> {
    String::from_utf8(read(root, digest, "txt", super::MAX_SOURCE)?)
        .map_err(|_| ProjectError::InvalidEncoding)
}

pub(super) fn verify(root: &Path, source: &Source) -> Result<usize, ProjectError> {
    if text(root, &source.sha256)? != source.text {
        return Err(ProjectError::ChecksumMismatch);
    }
    Ok(read(root, &source.raw_sha256, "raw", 32 * 1024 * 1024)?.len())
}

/// Read bounded display prefixes from an already-published immutable source.
/// Execution still verifies the full digest through `text`; this preview API
/// never authorizes synthesis or editing from unverified display text.
pub(crate) fn prefixes(
    root: &Path,
    digest: &str,
    ranges: &[(u32, u32)],
    chars: usize,
) -> Result<Vec<String>, ProjectError> {
    use std::io::{Seek, SeekFrom};
    if ranges.len() > 128 || chars > 80 {
        return Err(ProjectError::TooLarge);
    }
    let mut file =
        std::fs::File::open(path(root, digest, "txt")?).map_err(|_| ProjectError::ReadFailed)?;
    let len = file.metadata().map_err(|_| ProjectError::ReadFailed)?.len();
    if len > super::MAX_SOURCE as u64 {
        return Err(ProjectError::TooLarge);
    }
    ranges
        .iter()
        .map(|&(start, end)| {
            if start > end || u64::from(end) > len {
                return Err(ProjectError::InvalidProject);
            }
            file.seek(SeekFrom::Start(u64::from(start)))
                .map_err(|_| ProjectError::ReadFailed)?;
            let count = (end - start) as usize;
            let mut bytes = vec![0; count.min(chars * 4)];
            file.read_exact(&mut bytes)
                .map_err(|_| ProjectError::ReadFailed)?;
            let text = match std::str::from_utf8(&bytes) {
                Ok(text) => text,
                Err(e) if e.error_len().is_none() && bytes.len() < count => {
                    std::str::from_utf8(&bytes[..e.valid_up_to()])
                        .map_err(|_| ProjectError::InvalidEncoding)?
                }
                Err(_) => return Err(ProjectError::InvalidEncoding),
            };
            Ok(text.chars().take(chars).collect())
        })
        .collect()
}

#[cfg(test)]
mod prefix_tests {
    use super::*;
    #[test]
    fn preview_is_bounded_unicode_safe_and_rejects_invalid_ranges() {
        let root = tempfile::tempdir().unwrap();
        let text = format!("{}{}", "甲".repeat(99), "🌲".repeat(6));
        let digest = hash(text.as_bytes());
        std::fs::write(root.path().join(format!("{digest}.txt")), &text).unwrap();
        let result = prefixes(root.path(), &digest, &[(0, text.len() as u32)], 80).unwrap();
        assert_eq!(result[0], "甲".repeat(80));
        assert!(prefixes(root.path(), &digest, &[(1, 9)], 80).is_err());
        assert!(prefixes(root.path(), &digest, &[(0, 2)], 80).is_err());
        assert!(prefixes(root.path(), &digest, &[(0, text.len() as u32 + 1)], 80).is_err());
        assert!(prefixes(root.path(), &digest, &[(0, 3)], 81).is_err());
        assert!(prefixes(root.path(), "../outside", &[(0, 3)], 80).is_err());
    }
}
