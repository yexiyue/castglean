//! Portable project snapshots. Source bytes are preserved; hashes bind future annotations.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    path::Path,
};

const MAX_FILE: usize = 5 * 1024 * 1024;
const MAX_TOTAL: usize = 20 * 1024 * 1024;
const MAX_DOCUMENT: u64 = 128 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChapterInput {
    pub id: String,
    pub title: String,
    pub filename: String,
    pub source: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectInput {
    pub id: String,
    pub title: String,
    pub description: String,
    pub chapters: Vec<ChapterInput>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavedChapter {
    pub id: String,
    pub title: String,
    pub filename: String,
    pub source: String,
    pub source_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectData {
    pub id: String,
    pub title: String,
    pub description: String,
    pub chapters: Vec<SavedChapter>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectDocument {
    pub format: String,
    pub format_version: u32,
    pub project: ProjectData,
}
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectReceipt {
    pub document: ProjectDocument,
    pub filename: String,
}
#[derive(Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProjectError {
    InvalidFormat,
    UnsupportedVersion,
    InvalidProject,
    ChecksumMismatch,
    TooLarge,
    ReadFailed,
    WriteFailed,
    DialogFailed,
}
fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.contains('\0')
}
fn hash(source: &str) -> String {
    format!("{:x}", Sha256::digest(source.as_bytes()))
}

impl ProjectDocument {
    pub(crate) fn create(input: ProjectInput) -> Result<Self, ProjectError> {
        let document = Self {
            format: "castglean-project".into(),
            format_version: 1,
            project: ProjectData {
                id: input.id,
                title: input.title,
                description: input.description,
                chapters: input
                    .chapters
                    .into_iter()
                    .map(|c| SavedChapter {
                        source_sha256: hash(&c.source),
                        id: c.id,
                        title: c.title,
                        filename: c.filename,
                        source: c.source,
                    })
                    .collect(),
            },
        };
        document.validate()?;
        Ok(document)
    }
    pub(crate) fn validate(&self) -> Result<(), ProjectError> {
        if self.format != "castglean-project" {
            return Err(ProjectError::InvalidFormat);
        }
        if self.format_version != 1 {
            return Err(ProjectError::UnsupportedVersion);
        }
        let p = &self.project;
        if !text(&p.id, 128)
            || p.id == "sample"
            || !text(&p.title, 80)
            || p.description.chars().count() > 500
            || p.description.contains('\0')
            || p.chapters.is_empty()
            || p.chapters.len() > 50
        {
            return Err(ProjectError::InvalidProject);
        }
        let mut ids = HashSet::new();
        let mut total = 0;
        for c in &p.chapters {
            if !text(&c.id, 128)
                || !ids.insert(&c.id)
                || !text(&c.title, 120)
                || !text(&c.filename, 255)
                || !text(&c.source, usize::MAX)
            {
                return Err(ProjectError::InvalidProject);
            }
            total += c.source.len();
            if c.source.len() > MAX_FILE || total > MAX_TOTAL {
                return Err(ProjectError::TooLarge);
            }
            if hash(&c.source) != c.source_sha256 {
                return Err(ProjectError::ChecksumMismatch);
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
    let document: ProjectDocument =
        serde_json::from_slice(&bytes).map_err(|_| ProjectError::InvalidFormat)?;
    document.validate()?;
    Ok(document)
}
fn publish(
    path: &Path,
    write: impl FnOnce(&mut File) -> std::io::Result<()>,
) -> Result<(), ProjectError> {
    let parent = path.parent().ok_or(ProjectError::WriteFailed)?;
    let mut temp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| ProjectError::WriteFailed)?;
    write(temp.as_file_mut()).map_err(|_| ProjectError::WriteFailed)?;
    temp.as_file_mut()
        .flush()
        .map_err(|_| ProjectError::WriteFailed)?;
    temp.as_file()
        .sync_all()
        .map_err(|_| ProjectError::WriteFailed)?;
    temp.persist(path).map_err(|_| ProjectError::WriteFailed)?;
    Ok(())
}
pub(crate) fn save(path: &Path, document: &ProjectDocument) -> Result<(), ProjectError> {
    document.validate()?;
    let bytes = serde_json::to_vec_pretty(document).map_err(|_| ProjectError::InvalidFormat)?;
    publish(path, |file| file.write_all(&bytes))
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
    fn input() -> ProjectInput {
        ProjectInput {
            id: "project-1".into(),
            title: "夜航灯".into(),
            description: "公开测试".into(),
            chapters: vec![
                ChapterInput {
                    id: "ch-1".into(),
                    title: "第一章".into(),
                    filename: "01.txt".into(),
                    source: "\u{feff}灯亮了。\r\n下一段。\n".into(),
                },
                ChapterInput {
                    id: "ch-2".into(),
                    title: "第二章".into(),
                    filename: "02.txt".into(),
                    source: "第二章正文。".into(),
                },
            ],
        }
    }
    #[test]
    fn roundtrip_preserves_source_and_order() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.castglean");
        let doc = ProjectDocument::create(input()).unwrap();
        save(&path, &doc).unwrap();
        let restored = read(&path).unwrap();
        assert_eq!(
            restored.project.chapters[0].source,
            input().chapters[0].source
        );
        assert_eq!(restored.project.chapters[1].id, "ch-2");
        assert_eq!(restored.project.id, "project-1");
    }
    #[test]
    fn detects_corruption() {
        let mut doc = ProjectDocument::create(input()).unwrap();
        doc.project.chapters[0].source.push('!');
        assert_eq!(doc.validate(), Err(ProjectError::ChecksumMismatch));
    }
    #[test]
    fn rejects_duplicate_and_empty_chapters() {
        let mut p = input();
        p.chapters[1].id = "ch-1".into();
        assert_eq!(
            ProjectDocument::create(p).unwrap_err(),
            ProjectError::InvalidProject
        );
        let mut p = input();
        p.chapters.clear();
        assert_eq!(
            ProjectDocument::create(p).unwrap_err(),
            ProjectError::InvalidProject
        );
    }
    #[test]
    fn rejects_oversize_source() {
        let mut p = input();
        p.chapters[0].source = "x".repeat(MAX_FILE + 1);
        assert_eq!(
            ProjectDocument::create(p).unwrap_err(),
            ProjectError::TooLarge
        );
    }
    #[test]
    fn rejects_unknown_fields_and_versions() {
        let doc = ProjectDocument::create(input()).unwrap();
        let mut value = serde_json::to_value(&doc).unwrap();
        value["unexpected"] = true.into();
        assert!(serde_json::from_value::<ProjectDocument>(value).is_err());
        let mut doc = doc;
        doc.format_version = 99;
        assert_eq!(doc.validate(), Err(ProjectError::UnsupportedVersion));
    }
    #[test]
    fn failed_write_keeps_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.castglean");
        std::fs::write(&path, b"original").unwrap();
        let result = publish(&path, |file| {
            file.write_all(b"partial")?;
            Err(std::io::Error::other("injected failure"))
        });
        assert_eq!(result, Err(ProjectError::WriteFailed));
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn replaces_complete_file_and_rejects_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.castglean");
        std::fs::write(&path, b"broken").unwrap();
        assert_eq!(read(&path).unwrap_err(), ProjectError::InvalidFormat);
        save(&path, &ProjectDocument::create(input()).unwrap()).unwrap();
        assert!(read(&path).is_ok());
    }
    #[test]
    fn sanitized_filename_has_no_path() {
        assert_eq!(filename("../夜航:灯"), "..夜航灯.castglean");
    }
}
