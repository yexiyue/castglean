//! Portable source snapshots and chapter partitions. Only this version is supported.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Write},
    path::Path,
};

pub(crate) const MAX_SOURCE: usize = 64 * 1024 * 1024;
pub(crate) const MAX_TOTAL: usize = 128 * 1024 * 1024;
const MAX_DOCUMENT: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Source {
    pub id: String,
    pub filename: String,
    pub encoding: String,
    pub raw_sha256: String,
    pub text: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Chapter {
    pub id: String,
    pub source_id: String,
    pub title: String,
    pub start: u32,
    pub end: u32,
    pub heading: Option<u32>,
    pub volume_id: Option<String>,
    pub predecessor_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Volume {
    pub id: String,
    pub source_id: String,
    pub title: String,
    pub line: u32,
    pub manual: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Correction {
    pub source_id: String,
    pub line: u32,
    pub include: bool,
    pub title: Option<String>,
    pub volume_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectData {
    pub id: String,
    pub title: String,
    pub description: String,
    pub revision: u32,
    pub sources: Vec<Source>,
    pub chapters: Vec<Chapter>,
    pub volumes: Vec<Volume>,
    pub corrections: Vec<Correction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectDocument {
    pub format: String,
    pub format_version: u32,
    pub project: ProjectData,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type, thiserror::Error,
)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProjectError {
    #[error("invalid_format")]
    InvalidFormat,
    #[error("unsupported_version")]
    UnsupportedVersion,
    #[error("invalid_project")]
    InvalidProject,
    #[error("checksum_mismatch")]
    ChecksumMismatch,
    #[error("too_large")]
    TooLarge,
    #[error("read_failed")]
    ReadFailed,
    #[error("write_failed")]
    WriteFailed,
    #[error("dialog_failed")]
    DialogFailed,
    #[error("conflict")]
    Conflict,
    #[error("busy")]
    Busy,
    #[error("invalid_encoding")]
    InvalidEncoding,
    #[error("invalid_rule")]
    InvalidRule,
    #[error("cancelled")]
    Cancelled,
    #[error("not_found")]
    NotFound,
}

pub(crate) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn text(value: &str, max: usize) -> bool {
    !value
        .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .is_empty()
        && value.chars().count() <= max
        && !value.contains('\0')
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Each entry includes its original line ending. The final newline creates no extra empty line.
pub(crate) fn line_ranges(text: &str) -> Vec<(u32, u32)> {
    let bytes = text.as_bytes();
    let mut ranges = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' => {
                i += 1;
                if bytes.get(i) == Some(&b'\n') {
                    i += 1;
                }
                ranges.push((start as u32, i as u32));
                start = i;
            }
            b'\n' => {
                i += 1;
                ranges.push((start as u32, i as u32));
                start = i;
            }
            _ => i += 1,
        }
    }
    if start < bytes.len() {
        ranges.push((start as u32, bytes.len() as u32));
    }
    ranges
}

impl ProjectDocument {
    pub(crate) fn new(id: String, title: String, description: String) -> Self {
        Self {
            format: "castglean-project".into(),
            format_version: 2,
            project: ProjectData {
                id,
                title,
                description,
                revision: 1,
                sources: Vec::new(),
                chapters: Vec::new(),
                volumes: Vec::new(),
                corrections: Vec::new(),
            },
        }
    }

    pub(crate) fn validate(&self) -> Result<(), ProjectError> {
        self.validate_draft()?;
        if self.project.sources.is_empty() || self.project.chapters.is_empty() {
            return Err(ProjectError::InvalidProject);
        }
        Ok(())
    }

    pub(crate) fn validate_draft(&self) -> Result<(), ProjectError> {
        if self.format != "castglean-project" {
            return Err(ProjectError::InvalidFormat);
        }
        if self.format_version != 2 {
            return Err(ProjectError::UnsupportedVersion);
        }
        let p = &self.project;
        if !text(&p.id, 128)
            || p.id == "sample"
            || !text(&p.title, 80)
            || p.description.chars().count() > 500
            || p.description.contains('\0')
            || p.revision == 0
            || p.sources.len() > 128
            || p.chapters.len() > 10_000
        {
            return Err(ProjectError::InvalidProject);
        }
        let mut sources = HashMap::new();
        let mut total = 0;
        for s in &p.sources {
            if !text(&s.id, 128)
                || sources.insert(&s.id, s).is_some()
                || !text(&s.filename, 255)
                || !text(&s.text, usize::MAX)
                || !matches!(s.encoding.as_str(), "utf-8" | "gb18030" | "gbk")
                || !digest(&s.raw_sha256)
            {
                return Err(ProjectError::InvalidProject);
            }
            total += s.text.len();
            if s.text.len() > MAX_SOURCE || total > MAX_TOTAL {
                return Err(ProjectError::TooLarge);
            }
            if hash(s.text.as_bytes()) != s.sha256 {
                return Err(ProjectError::ChecksumMismatch);
            }
        }
        let indexes: HashMap<_, _> = p
            .sources
            .iter()
            .map(|s| (&s.id, line_ranges(&s.text)))
            .collect();
        let mut volumes = HashSet::new();
        for v in &p.volumes {
            if !text(&v.id, 128)
                || !volumes.insert(&v.id)
                || !text(&v.title, 120)
                || indexes
                    .get(&v.source_id)
                    .and_then(|lines| lines.get(v.line as usize))
                    .is_none()
            {
                return Err(ProjectError::InvalidProject);
            }
        }
        let mut ids = HashSet::new();
        let mut ends: HashMap<&String, u32> = HashMap::new();
        for c in &p.chapters {
            let s = sources
                .get(&c.source_id)
                .ok_or(ProjectError::InvalidProject)?;
            if !text(&c.id, 128)
                || !ids.insert(&c.id)
                || !text(&c.title, 120)
                || c.start >= c.end
                || c.end as usize > s.text.len()
                || !s.text.is_char_boundary(c.start as usize)
                || !s.text.is_char_boundary(c.end as usize)
                || *ends.get(&c.source_id).unwrap_or(&0) != c.start
                || s.text[c.start as usize..c.end as usize]
                    .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
                    .is_empty()
            {
                return Err(ProjectError::InvalidProject);
            }
            let mut predecessors = HashSet::new();
            if c.predecessor_ids.len() > 10_000
                || c.predecessor_ids
                    .iter()
                    .any(|id| !text(id, 128) || id == &c.id || !predecessors.insert(id))
            {
                return Err(ProjectError::InvalidProject);
            }
            if let Some(line) = c.heading {
                let (start, end) = *indexes[&c.source_id]
                    .get(line as usize)
                    .ok_or(ProjectError::InvalidProject)?;
                if start < c.start || end > c.end {
                    return Err(ProjectError::InvalidProject);
                }
            }
            if c.volume_id.as_ref().is_some_and(|id| {
                !p.volumes
                    .iter()
                    .any(|v| &v.id == id && v.source_id == c.source_id)
            }) {
                return Err(ProjectError::InvalidProject);
            }
            ends.insert(&c.source_id, c.end);
        }
        for s in &p.sources {
            if ends.get(&s.id).copied() != Some(s.text.len() as u32) {
                return Err(ProjectError::InvalidProject);
            }
        }
        let mut corrections = HashSet::new();
        for c in &p.corrections {
            if !corrections.insert((&c.source_id, c.line))
                || indexes
                    .get(&c.source_id)
                    .and_then(|lines| lines.get(c.line as usize))
                    .is_none()
                || c.title.as_ref().is_some_and(|t| !text(t, 120))
                || c.volume_id.as_ref().is_some_and(|id| {
                    !p.volumes
                        .iter()
                        .any(|v| &v.id == id && v.source_id == c.source_id)
                })
            {
                return Err(ProjectError::InvalidProject);
            }
        }
        Ok(())
    }
}

pub(crate) fn read(path: &Path) -> Result<ProjectDocument, ProjectError> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| ProjectError::ReadFailed)?
        .take(MAX_DOCUMENT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ProjectError::ReadFailed)?;
    if bytes.len() as u64 > MAX_DOCUMENT {
        return Err(ProjectError::TooLarge);
    }
    // Check the version before decoding version-specific fields; no migration layer.
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| ProjectError::InvalidFormat)?;
    if value.get("formatVersion").and_then(|v| v.as_u64()) != Some(2) {
        return Err(ProjectError::UnsupportedVersion);
    }
    let document: ProjectDocument =
        serde_json::from_value(value).map_err(|_| ProjectError::InvalidFormat)?;
    document.validate()?;
    Ok(document)
}

pub(crate) fn publish(
    path: &Path,
    write: impl FnOnce(&mut File) -> std::io::Result<()>,
) -> Result<(), ProjectError> {
    let parent = path.parent().ok_or(ProjectError::WriteFailed)?;
    let mut temp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| ProjectError::WriteFailed)?;
    write(temp.as_file_mut()).map_err(|_| ProjectError::WriteFailed)?;
    temp.flush()
        .and_then(|()| temp.as_file().sync_all())
        .map_err(|_| ProjectError::WriteFailed)?;
    temp.persist(path).map_err(|_| ProjectError::WriteFailed)?;
    Ok(())
}

pub(crate) fn save(path: &Path, document: &ProjectDocument) -> Result<(), ProjectError> {
    document.validate()?;
    publish(path, |file| {
        serde_json::to_writer(file, document).map_err(std::io::Error::other)
    })
}

pub(crate) fn filename(title: &str) -> String {
    let name: String = title
        .chars()
        .filter(|c| !c.is_control() && !"/\\:*?\"<>|".contains(*c))
        .take(60)
        .collect();
    format!(
        "{}.castglean",
        if name.trim().is_empty() {
            "project"
        } else {
            name.trim()
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn doc() -> ProjectDocument {
        let mut doc = ProjectDocument::new("project".into(), "测试".into(), "".into());
        let source = "\u{feff}第一章\r\n原文😀e\u{301}\r结束\n".to_owned();
        doc.project.sources.push(Source {
            id: "s".into(),
            filename: "book.txt".into(),
            encoding: "utf-8".into(),
            raw_sha256: hash(source.as_bytes()),
            sha256: hash(source.as_bytes()),
            text: source.clone(),
        });
        doc.project.chapters.push(Chapter {
            id: "c".into(),
            source_id: "s".into(),
            title: "第一章".into(),
            start: 0,
            end: source.len() as u32,
            heading: Some(0),
            volume_id: None,
            predecessor_ids: Vec::new(),
        });
        doc
    }
    #[test]
    fn exact_source_roundtrip_without_original_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.castglean");
        let input = doc();
        save(&path, &input).unwrap();
        let moved = tempfile::tempdir().unwrap();
        let destination = moved.path().join("moved.castglean");
        std::fs::rename(&path, &destination).unwrap();
        assert_eq!(
            read(&destination).unwrap().project.sources[0].text,
            input.project.sources[0].text
        );
    }
    #[test]
    fn rejects_missing_overlapping_and_mid_character_ranges() {
        for start in [1, 3, 999] {
            let mut d = doc();
            d.project.chapters[0].start = start;
            assert_eq!(d.validate(), Err(ProjectError::InvalidProject));
        }
        let mut d = doc();
        d.project.chapters[0].end -= 1;
        assert_eq!(d.validate(), Err(ProjectError::InvalidProject));
    }
    #[test]
    fn bom_only_source_is_not_accepted_through_a_portable_document() {
        let mut d = doc();
        let source = &mut d.project.sources[0];
        source.text = "\u{feff}\r\n ".into();
        source.sha256 = hash(source.text.as_bytes());
        source.raw_sha256 = source.sha256.clone();
        d.project.chapters[0].end = source.text.len() as u32;
        assert_eq!(d.validate(), Err(ProjectError::InvalidProject));
    }

    #[test]
    fn invalid_partition_and_source_references_are_rejected() {
        for mode in 0..6 {
            let mut d = doc();
            match mode {
                0 => d.project.chapters.clear(),
                1 => {
                    let mut duplicate = d.project.chapters[0].clone();
                    duplicate.id = "other".into();
                    d.project.chapters.push(duplicate);
                }
                2 => d.project.chapters[0].source_id = "missing".into(),
                3 => d.project.chapters[0].end = u32::MAX,
                4 => {
                    d.project.chapters[0].start = 6;
                    d.project.chapters[0].end = 3;
                }
                _ => {
                    d.project.chapters[0].start = 0;
                    d.project.chapters[0].end = 0;
                }
            }
            assert_eq!(
                d.validate(),
                Err(ProjectError::InvalidProject),
                "case {mode}"
            );
        }
    }

    #[test]
    fn corruption_and_old_version_are_rejected_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.castglean");
        let bytes = b"{\"formatVersion\":1}";
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(read(&path).unwrap_err(), ProjectError::UnsupportedVersion);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let mut unknown = serde_json::to_value(doc()).unwrap();
        unknown["project"]["unknown"] = true.into();
        std::fs::write(&path, serde_json::to_vec(&unknown).unwrap()).unwrap();
        assert_eq!(read(&path).unwrap_err(), ProjectError::InvalidFormat);
        let mut d = doc();
        d.project.sources[0].text.push('!');
        assert_eq!(d.validate(), Err(ProjectError::ChecksumMismatch));
    }
    #[test]
    fn failed_write_preserves_previous_target() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book");
        std::fs::write(&path, b"original").unwrap();
        assert_eq!(
            publish(&path, |f| {
                f.write_all(b"partial")?;
                Err(std::io::Error::other("injected"))
            }),
            Err(ProjectError::WriteFailed)
        );
        assert_eq!(std::fs::read(path).unwrap(), b"original");
    }
}
