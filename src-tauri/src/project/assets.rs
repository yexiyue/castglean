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

pub(super) fn text(root: &Path, digest: &str) -> Result<String, ProjectError> {
    String::from_utf8(read(root, digest, "txt", super::MAX_SOURCE)?)
        .map_err(|_| ProjectError::InvalidEncoding)
}

pub(super) fn verify(root: &Path, source: &Source) -> Result<usize, ProjectError> {
    if text(root, &source.sha256)? != source.text {
        return Err(ProjectError::ChecksumMismatch);
    }
    Ok(read(root, &source.raw_sha256, "raw", 32 * 1024 * 1024)?.len())
}
