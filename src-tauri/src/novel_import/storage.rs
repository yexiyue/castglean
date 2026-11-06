//! Recovery metadata references immutable content-addressed source blobs.
//! Publish blobs first and the recovery envelope last; failed publication leaves the previous record valid.
use super::store::Recovery;
use crate::project::{self, ProjectError};
use serde_json::Value;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};

fn blob_path(recovery: &Path, digest: &str) -> Result<PathBuf, ProjectError> {
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(ProjectError::InvalidProject);
    }
    Ok(recovery
        .parent()
        .ok_or(ProjectError::InvalidProject)?
        .join("sources")
        .join(format!("{digest}.txt")))
}
fn documents(value: &mut Value) -> impl Iterator<Item = &mut Value> {
    let object = value.as_object_mut().into_iter().flat_map(|v| v.iter_mut());
    object.filter_map(|(key, value)| match key.as_str() {
        "document" => Some(value),
        "undo" => value.get_mut("document"),
        _ => None,
    })
}
fn sources(document: &mut Value) -> Result<&mut Vec<Value>, ProjectError> {
    document
        .pointer_mut("/project/sources")
        .and_then(Value::as_array_mut)
        .ok_or(ProjectError::InvalidFormat)
}
pub(super) fn read(path: &Path) -> Result<Recovery, ProjectError> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| ProjectError::ReadFailed)?
        .take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ProjectError::ReadFailed)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(ProjectError::TooLarge);
    }
    let mut value: Value =
        serde_json::from_slice(&bytes).map_err(|_| ProjectError::InvalidFormat)?;
    for document in documents(&mut value) {
        for source in sources(document)? {
            if source.get("text").is_some() {
                return Err(ProjectError::InvalidFormat);
            }
            let digest = source
                .get("sha256")
                .and_then(Value::as_str)
                .ok_or(ProjectError::InvalidFormat)?;
            let blob = blob_path(path, digest)?;
            let mut text = String::new();
            std::fs::File::open(blob)
                .map_err(|_| ProjectError::ReadFailed)?
                .take(project::MAX_SOURCE as u64 + 1)
                .read_to_string(&mut text)
                .map_err(|_| ProjectError::ReadFailed)?;
            if text.len() > project::MAX_SOURCE {
                return Err(ProjectError::TooLarge);
            }
            if project::hash(text.as_bytes()) != digest {
                return Err(ProjectError::ChecksumMismatch);
            }
            source
                .as_object_mut()
                .ok_or(ProjectError::InvalidFormat)?
                .insert("text".into(), Value::String(text));
        }
    }
    let record: Recovery =
        serde_json::from_value(value).map_err(|_| ProjectError::InvalidFormat)?;
    record.validate()?;
    Ok(record)
}
pub(super) fn write(path: &Path, record: &Recovery) -> Result<(), ProjectError> {
    record.validate()?;
    let mut value = serde_json::to_value(record).map_err(|_| ProjectError::InvalidFormat)?;
    for document in documents(&mut value) {
        for source in sources(document)? {
            let digest = source
                .get("sha256")
                .and_then(Value::as_str)
                .ok_or(ProjectError::InvalidFormat)?;
            let blob = blob_path(path, digest)?;
            let text = source
                .get("text")
                .and_then(Value::as_str)
                .ok_or(ProjectError::InvalidFormat)?;
            if !blob.exists() {
                std::fs::create_dir_all(blob.parent().ok_or(ProjectError::WriteFailed)?)
                    .map_err(|_| ProjectError::WriteFailed)?;
                project::publish(&blob, |file| file.write_all(text.as_bytes()))?;
            } else {
                // Never overwrite a corrupted or unexpected immutable source.
                let bytes = std::fs::read(&blob).map_err(|_| ProjectError::ReadFailed)?;
                if bytes != text.as_bytes() {
                    return Err(ProjectError::ChecksumMismatch);
                }
            }
            source
                .as_object_mut()
                .ok_or(ProjectError::InvalidFormat)?
                .remove("text");
        }
    }
    let bytes = serde_json::to_vec(&value).map_err(|_| ProjectError::InvalidFormat)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(ProjectError::TooLarge);
    }
    project::publish(path, |file| file.write_all(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::novel_import::store::ImportState;

    #[test]
    fn source_blobs_are_shared_by_undo_and_detect_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let state = ImportState::new(dir.path().join("drafts"));
        let draft = state
            .create("Synthetic novel".into(), String::new())
            .unwrap();
        let input = dir.path().join("book.txt");
        std::fs::write(&input, "第一章 开始\r\n正文🙂\n第二章 继续\n原文\n").unwrap();
        let selected = state.select(&input, Some("utf-8")).unwrap();
        let snapshot = state
            .confirm(&draft.id, draft.revision, &selected.id, "utf-8", true)
            .unwrap();
        let path = dir
            .path()
            .join("drafts")
            .join(&draft.id)
            .join("recovery.json");
        let envelope = std::fs::read_to_string(&path).unwrap();
        assert!(!envelope.contains("正文"));
        let record = read(&path).unwrap();
        assert!(record.document.project.sources[0].text.contains("正文🙂"));
        let blob = blob_path(&path, &snapshot.sources[0].sha256).unwrap();
        std::fs::write(&blob, "damaged").unwrap();
        assert!(matches!(read(&path), Err(ProjectError::ChecksumMismatch)));
        assert!(matches!(
            write(&path, &record),
            Err(ProjectError::ChecksumMismatch)
        ));
        assert_eq!(std::fs::read_to_string(path).unwrap(), envelope);
    }
}
