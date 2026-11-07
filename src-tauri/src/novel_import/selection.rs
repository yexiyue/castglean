//! Transient, immutable file selections. Confirmed sources publish into project storage.
use super::encoding::decode;
use serde::Serialize;
pub(crate) mod commands;
use crate::project::{self, ProjectError};
use std::{
    collections::HashMap,
    io::Read,
    path::Path,
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePreview {
    pub id: String,
    pub filename: String,
    pub encoding: String,
    pub bytes: u32,
    pub samples: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct SelectedSource {
    pub id: String,
    pub filename: String,
    pub raw: Arc<Vec<u8>>,
}

#[derive(Default)]
pub(crate) struct Selections(Mutex<HashMap<String, SelectedSource>>);

impl Selections {
    pub(crate) fn select(&self, path: &Path) -> Result<FilePreview, ProjectError> {
        if !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("txt"))
        {
            return Err(ProjectError::InvalidFormat);
        }
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|_| ProjectError::ReadFailed)?
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ProjectError::ReadFailed)?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err(ProjectError::TooLarge);
        }
        let encoding = if std::str::from_utf8(&bytes).is_ok() {
            "utf-8"
        } else {
            "gb18030"
        };
        let filename = path
            .file_name()
            .ok_or(ProjectError::InvalidFormat)?
            .to_string_lossy()
            .into_owned();
        if filename.chars().count() > 255 || filename.chars().any(char::is_control) {
            return Err(ProjectError::InvalidFormat);
        }
        let selected = SelectedSource {
            id: uuid::Uuid::new_v4().to_string(),
            filename,
            raw: Arc::new(bytes),
        };
        let preview = selected.preview(encoding)?;
        let mut selections = self.0.lock().map_err(|_| ProjectError::Busy)?;
        if selections.len() >= 128
            || selections.values().map(|s| s.raw.len()).sum::<usize>() + selected.raw.len()
                > project::MAX_TOTAL
        {
            return Err(ProjectError::TooLarge);
        }
        selections.insert(selected.id.clone(), selected);
        Ok(preview)
    }
    pub(crate) fn get(&self, id: &str) -> Result<SelectedSource, ProjectError> {
        self.0
            .lock()
            .map_err(|_| ProjectError::Busy)?
            .get(id)
            .cloned()
            .ok_or(ProjectError::NotFound)
    }
    pub(crate) fn preview(&self, id: &str, encoding: &str) -> Result<FilePreview, ProjectError> {
        self.get(id)?.preview(encoding)
    }
    pub(crate) fn release(&self, id: &str) -> Result<(), ProjectError> {
        self.0.lock().map_err(|_| ProjectError::Busy)?.remove(id);
        Ok(())
    }
}
impl SelectedSource {
    fn preview(&self, encoding: &str) -> Result<FilePreview, ProjectError> {
        let text = decode(&self.raw, encoding)?;
        let lines = project::line_ranges(&text);
        let samples = [0, lines.len() / 2, lines.len().saturating_sub(4)]
            .into_iter()
            .filter_map(|line| {
                let &(start, _) = lines.get(line)?;
                let end = lines[(line + 4).min(lines.len()) - 1].1;
                Some(
                    text[start as usize..end as usize]
                        .chars()
                        .take(1000)
                        .collect(),
                )
            })
            .collect();
        Ok(FilePreview {
            id: self.id.clone(),
            filename: self.filename.clone(),
            encoding: encoding.into(),
            bytes: self.raw.len() as u32,
            samples,
        })
    }
}
