//! One atomic recovery envelope owns draft, graph position, diagnostic records and receipts.
use super::{
    detection::{self, HeadingRule, ImportIssue},
    diagnostics::DiagnosticRecord,
    encoding::decode,
    types::*,
};
use crate::project::{self, ProjectDocument, ProjectError};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UndoState {
    pub document: ProjectDocument,
    pub rules: Vec<HeadingRule>,
    pub single_chapter_sources: Vec<String>,
    pub issues: Vec<ImportIssue>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Recovery {
    pub version: u32,
    pub local_id: String,
    pub document: ProjectDocument,
    pub rules: Vec<HeadingRule>,
    pub single_chapter_sources: Vec<String>,
    pub issues: Vec<ImportIssue>,
    pub undo: Option<UndoState>,
    pub filename: Option<String>,
    pub diagnostics: Vec<DiagnosticRecord>,
    pub sequence: u32,
    pub receipts: HashMap<String, String>,
    pub diagnostic_commands: HashMap<String, String>,
}
impl Recovery {
    pub(super) fn capture_undo(&self) -> UndoState {
        UndoState {
            document: self.document.clone(),
            rules: self.rules.clone(),
            single_chapter_sources: self.single_chapter_sources.clone(),
            issues: self.issues.clone(),
        }
    }

    fn regroup_chapters(&mut self) {
        let project = &mut self.document.project;
        for chapter in &mut project.chapters {
            let line = chapter.heading.unwrap_or(0);
            let explicit_group = project
                .corrections
                .iter()
                .find(|correction| {
                    correction.source_id == chapter.source_id
                        && Some(correction.line) == chapter.heading
                })
                .and_then(|correction| correction.volume_id.clone());
            chapter.volume_id = explicit_group.or_else(|| {
                project
                    .volumes
                    .iter()
                    .filter(|volume| volume.source_id == chapter.source_id && volume.line <= line)
                    .max_by_key(|volume| volume.line)
                    .map(|volume| volume.id.clone())
            });
        }
    }
    pub fn snapshot(&self) -> ImportSnapshot {
        let p = &self.document.project;
        ImportSnapshot {
            id: self.local_id.clone(),
            title: p.title.clone(),
            description: p.description.clone(),
            revision: p.revision,
            sources: p.sources.iter().map(SourceInfo::from).collect(),
            chapters: p.chapters.clone(),
            volumes: p.volumes.clone(),
            corrections: p.corrections.clone(),
            rules: self.rules.clone(),
            issues: self.issues.clone(),
            filename: self.filename.clone(),
            can_undo: self.undo.is_some(),
        }
    }
    pub fn validate(&self) -> Result<(), ProjectError> {
        if self.version != 1 {
            return Err(ProjectError::UnsupportedVersion);
        }
        uuid(&self.local_id)?;
        self.document.validate_draft()?;
        if let Some(undo) = &self.undo {
            undo.document.validate_draft()?;
        }
        if self
            .single_chapter_sources
            .iter()
            .any(|id| !self.document.project.sources.iter().any(|s| &s.id == id))
        {
            return Err(ProjectError::InvalidProject);
        }
        if self.diagnostics.len() > 32 || self.receipts.len() > 4096 {
            return Err(ProjectError::TooLarge);
        }
        Ok(())
    }
    /// A line edit changes the existing partition; only an explicit rule operation re-detects headings.
    pub fn patch_boundaries(
        &mut self,
        patches: Vec<project::Correction>,
        token: &CancellationToken,
    ) -> Result<(), ProjectError> {
        let affected: std::collections::HashSet<_> =
            patches.iter().map(|p| p.source_id.clone()).collect();
        for patch in patches {
            self.document
                .project
                .corrections
                .retain(|c| c.source_id != patch.source_id || c.line != patch.line);
            self.document.project.corrections.push(patch);
        }
        for source in self
            .document
            .project
            .sources
            .iter()
            .filter(|s| affected.contains(&s.id))
        {
            let previous: Vec<_> = self
                .document
                .project
                .chapters
                .iter()
                .filter(|c| c.source_id == source.id)
                .cloned()
                .collect();
            let mut boundaries: Vec<_> = previous
                .iter()
                .filter_map(|c| {
                    c.heading.map(|line| project::Correction {
                        source_id: source.id.clone(),
                        line,
                        include: true,
                        title: Some(c.title.clone()),
                        volume_id: c.volume_id.clone(),
                    })
                })
                .collect();
            boundaries.extend(
                self.document
                    .project
                    .corrections
                    .iter()
                    .filter(|c| c.source_id == source.id)
                    .cloned(),
            );
            let detection::Detection {
                mut chapters,
                issues,
                ..
            } = detection::detect(source, &[], &boundaries, &previous, token)?;
            for chapter in &mut chapters {
                if let Some(line) = chapter.heading {
                    if chapter.volume_id.is_none() {
                        chapter.volume_id = self
                            .document
                            .project
                            .volumes
                            .iter()
                            .filter(|v| v.source_id == source.id && v.line <= line)
                            .max_by_key(|v| v.line)
                            .map(|v| v.id.clone());
                    }
                } else if let Some(old) = previous
                    .iter()
                    .find(|old| old.heading.is_none() && old.start == chapter.start)
                {
                    chapter.title = old.title.clone();
                }
            }
            let position = self
                .document
                .project
                .chapters
                .iter()
                .position(|c| c.source_id == source.id)
                .ok_or(ProjectError::InvalidProject)?;
            self.document
                .project
                .chapters
                .retain(|c| c.source_id != source.id);
            self.document
                .project
                .chapters
                .splice(position..position, chapters);
            self.issues.retain(|i| i.source_id != source.id);
            self.issues.extend(issues);
        }
        self.document.validate()
    }
    pub fn recalculate(&mut self, token: &CancellationToken) -> Result<(), ProjectError> {
        let p = &mut self.document.project;
        let mut chapters = Vec::new();
        let mut volumes: Vec<_> = p.volumes.iter().filter(|v| v.manual).cloned().collect();
        let mut issues = Vec::new();
        for source in &p.sources {
            let detection::Detection {
                chapters: c,
                volumes: v,
                issues: i,
            } = detection::detect(
                source,
                if self.single_chapter_sources.contains(&source.id) {
                    &[]
                } else {
                    &self.rules
                },
                &p.corrections,
                &p.chapters,
                token,
            )?;
            chapters.extend(c);
            volumes.extend(v.into_iter().filter(|volume| {
                !p.volumes
                    .iter()
                    .any(|v| v.manual && v.source_id == volume.source_id && v.line == volume.line)
            }));
            issues.extend(i);
        }
        p.chapters = chapters;
        p.volumes = volumes;
        self.regroup_chapters();
        self.issues = issues;
        self.document.validate()
    }
}

pub(crate) struct ImportState {
    root: PathBuf,
    writer: Mutex<()>,
    pub(super) running: Mutex<HashMap<String, CancellationToken>>,
    pub(super) cancelled_starts: Mutex<HashSet<String>>,
    pub(super) subscribers:
        Mutex<HashMap<String, tauri::ipc::Channel<super::diagnostics::DiagnosticSnapshot>>>,
}
fn uuid(value: &str) -> Result<(), ProjectError> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| ProjectError::NotFound)
}

impl ImportState {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            writer: Mutex::new(()),
            running: Mutex::new(HashMap::new()),
            cancelled_starts: Mutex::new(HashSet::new()),
            subscribers: Mutex::new(HashMap::new()),
        }
    }
    fn path(&self, id: &str) -> Result<PathBuf, ProjectError> {
        uuid(id)?;
        Ok(self.root.join(id).join("recovery.json"))
    }
    pub fn active(&self) -> u32 {
        self.running.lock().map(|r| r.len() as u32).unwrap_or(1)
    }
    pub(super) fn read(&self, id: &str) -> Result<Recovery, ProjectError> {
        read(&self.path(id)?)
    }
    pub fn create(
        &self,
        title: String,
        description: String,
    ) -> Result<ImportSnapshot, ProjectError> {
        if title.trim().is_empty()
            || title.chars().count() > 80
            || description.chars().count() > 500
            || title.contains('\0')
            || description.contains('\0')
        {
            return Err(ProjectError::InvalidProject);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let record = Recovery {
            version: 1,
            local_id: id.clone(),
            document: ProjectDocument::new(id.clone(), title, description),
            rules: detection::builtin(),
            single_chapter_sources: Vec::new(),
            issues: Vec::new(),
            undo: None,
            filename: None,
            diagnostics: Vec::new(),
            sequence: 0,
            receipts: HashMap::new(),
            diagnostic_commands: HashMap::new(),
        };
        let path = self.path(&id)?;
        std::fs::create_dir_all(path.parent().ok_or(ProjectError::WriteFailed)?)
            .map_err(|_| ProjectError::WriteFailed)?;
        write(&path, &record)?;
        Ok(record.snapshot())
    }
    pub(crate) fn export_document(&self, id: &str) -> Result<ProjectDocument, ProjectError> {
        let record = self.read(id)?;
        record.document.validate()?;
        Ok(record.document)
    }
    pub(crate) fn save_to(
        &self,
        id: &str,
        revision: u32,
        path: &Path,
    ) -> Result<ImportSnapshot, ProjectError> {
        self.update(id, Some(revision), |r| {
            project::save(path, &r.document)?;
            r.filename = Some(
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
            );
            Ok(())
        })?;
        Ok(self.read(id)?.snapshot())
    }
    pub fn install(
        &self,
        document: ProjectDocument,
        filename: String,
    ) -> Result<ImportSnapshot, ProjectError> {
        document.validate()?;
        // File identity must not select or overwrite a local recovery directory.
        let id = uuid::Uuid::new_v4().to_string();
        let record = Recovery {
            version: 1,
            local_id: id.clone(),
            document,
            rules: detection::builtin(),
            single_chapter_sources: Vec::new(),
            issues: Vec::new(),
            undo: None,
            filename: Some(filename),
            diagnostics: Vec::new(),
            sequence: 0,
            receipts: HashMap::new(),
            diagnostic_commands: HashMap::new(),
        };
        let path = self.path(&id)?;
        std::fs::create_dir_all(path.parent().ok_or(ProjectError::WriteFailed)?)
            .map_err(|_| ProjectError::WriteFailed)?;
        write(&path, &record)?;
        Ok(record.snapshot())
    }
    pub(super) fn update<T>(
        &self,
        id: &str,
        revision: Option<u32>,
        edit: impl FnOnce(&mut Recovery) -> Result<T, ProjectError>,
    ) -> Result<T, ProjectError> {
        let _guard = self.writer.lock().map_err(|_| ProjectError::WriteFailed)?;
        let path = self.path(id)?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(path.with_extension("lock"))
            .map_err(|_| ProjectError::WriteFailed)?;
        fs2::FileExt::lock_exclusive(&lock).map_err(|_| ProjectError::Busy)?;
        let mut record = read(&path)?;
        if revision.is_some_and(|v| v != record.document.project.revision) {
            return Err(ProjectError::Conflict);
        }
        let result = edit(&mut record)?;
        record.validate()?;
        record.sequence = record
            .sequence
            .checked_add(1)
            .ok_or(ProjectError::TooLarge)?;
        write(&path, &record)?;
        Ok(result)
    }
    /// User mutations take the active-run lock before the writer lock, through publication.
    pub(super) fn update_idle<T>(
        &self,
        id: &str,
        revision: Option<u32>,
        edit: impl FnOnce(&mut Recovery) -> Result<T, ProjectError>,
    ) -> Result<T, ProjectError> {
        let active = self.running.lock().map_err(|_| ProjectError::Busy)?;
        if active.contains_key(id) {
            return Err(ProjectError::Busy);
        }
        self.update(id, revision, edit)
    }
    pub fn edit(
        &self,
        id: &str,
        revision: u32,
        edit: DraftEdit,
    ) -> Result<ImportSnapshot, ProjectError> {
        self.update_idle(id, Some(revision), |r| {
            let before = r.capture_undo();
            let undoing = matches!(&edit, DraftEdit::Undo);
            match edit {
                DraftEdit::Info { title, description } => {
                    r.document.project.title = title;
                    r.document.project.description = description;
                }
                DraftEdit::Boundary { correction } => {
                    r.patch_boundaries(vec![correction], &CancellationToken::new())?;
                }
                DraftEdit::Rules { rules } => {
                    r.rules = rules;
                    r.recalculate(&CancellationToken::new())?;
                }
                DraftEdit::Volume {
                    source_id,
                    line,
                    title,
                } => {
                    let id = format!("{source_id}-v-{line}");
                    r.document.project.volumes.retain(|v| v.id != id);
                    r.document.project.volumes.push(crate::project::Volume {
                        id,
                        source_id,
                        line,
                        title,
                        manual: true,
                    });
                    r.regroup_chapters();
                }
                DraftEdit::Undo => {
                    let before = r.undo.take().ok_or(ProjectError::NotFound)?;
                    r.document = before.document;
                    r.rules = before.rules;
                    r.single_chapter_sources = before.single_chapter_sources;
                    r.issues = before.issues;
                }
            }
            r.document.project.revision = revision.checked_add(1).ok_or(ProjectError::TooLarge)?;
            r.filename = None;
            r.undo = (!undoing).then_some(before);
            Ok(())
        })?;
        Ok(self.read(id)?.snapshot())
    }
    pub fn list(&self) -> Result<Vec<ImportSnapshot>, ProjectError> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(ProjectError::ReadFailed),
        };
        let mut snapshots = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|_| ProjectError::ReadFailed)?;
            if !entry
                .file_type()
                .map_err(|_| ProjectError::ReadFailed)?
                .is_dir()
            {
                continue;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            if uuid(&id).is_err() {
                continue;
            }
            // A corrupt record is an error, never silently replaced with an empty draft.
            snapshots.push(self.read(&id)?.snapshot());
        }
        Ok(snapshots)
    }
    pub fn release_selection(&self, id: &str) -> Result<(), ProjectError> {
        uuid(id)?;
        for extension in ["txt", "json"] {
            let path = self
                .root
                .join("selections")
                .join(format!("{id}.{extension}"));
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(ProjectError::WriteFailed),
            }
        }
        Ok(())
    }
    pub fn select(&self, path: &Path, encoding: Option<&str>) -> Result<FilePreview, ProjectError> {
        if !path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("txt"))
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
        let id = uuid::Uuid::new_v4().to_string();
        let root = self.root.join("selections");
        std::fs::create_dir_all(&root).map_err(|_| ProjectError::WriteFailed)?;
        let filename = path
            .file_name()
            .ok_or(ProjectError::InvalidFormat)?
            .to_string_lossy()
            .into_owned();
        let selected = (|| {
            project::publish(&root.join(format!("{id}.txt")), |file| {
                file.write_all(&bytes)
            })?;
            project::publish(&root.join(format!("{id}.json")), |file| {
                serde_json::to_writer(file, &filename).map_err(std::io::Error::other)
            })?;
            self.preview(
                &id,
                encoding.unwrap_or(if std::str::from_utf8(&bytes).is_ok() {
                    "utf-8"
                } else {
                    "gb18030"
                }),
            )
        })();
        if selected.is_err() {
            let _ = self.release_selection(&id);
        }
        selected
    }
    pub fn preview(&self, id: &str, encoding: &str) -> Result<FilePreview, ProjectError> {
        uuid(id)?;
        let root = self.root.join("selections");
        let bytes =
            std::fs::read(root.join(format!("{id}.txt"))).map_err(|_| ProjectError::ReadFailed)?;
        let text = decode(&bytes, encoding)?;
        let lines = project::line_ranges(&text);
        let mut samples = Vec::new();
        for line in [0, lines.len() / 2, lines.len().saturating_sub(4)] {
            if let Some(&(a, _)) = lines.get(line) {
                let end = lines
                    .get((line + 4).min(lines.len()).saturating_sub(1))
                    .map(|r| r.1)
                    .unwrap_or(text.len() as u32);
                samples.push(text[a as usize..end as usize].chars().take(1000).collect());
            }
        }
        let filename: String = serde_json::from_slice(
            &std::fs::read(root.join(format!("{id}.json")))
                .map_err(|_| ProjectError::ReadFailed)?,
        )
        .map_err(|_| ProjectError::ReadFailed)?;
        Ok(FilePreview {
            id: id.into(),
            filename,
            encoding: encoding.into(),
            bytes: bytes.len() as u32,
            samples,
        })
    }
    pub fn confirm(
        &self,
        id: &str,
        revision: u32,
        selection: &str,
        encoding: &str,
        split: bool,
    ) -> Result<ImportSnapshot, ProjectError> {
        uuid(selection)?;
        let preview = self.preview(selection, encoding)?;
        let raw = std::fs::read(
            self.root
                .join("selections")
                .join(format!("{selection}.txt")),
        )
        .map_err(|_| ProjectError::ReadFailed)?;
        let text = decode(&raw, encoding)?;
        let source = project::Source {
            id: uuid::Uuid::new_v4().to_string(),
            filename: preview.filename,
            encoding: encoding.into(),
            raw_sha256: project::hash(&raw),
            sha256: project::hash(text.as_bytes()),
            text,
        };
        self.update_idle(id, Some(revision), |r| {
            let p = &mut r.document.project;
            if p.sources.iter().any(|s| s.sha256 == source.sha256) {
                return Err(ProjectError::Conflict);
            }
            if p.sources.len() >= 128
                || p.sources.iter().map(|s| s.text.len()).sum::<usize>() + source.text.len()
                    > project::MAX_TOTAL
            {
                return Err(ProjectError::TooLarge);
            }
            let before = r.capture_undo();
            let detection::Detection {
                chapters,
                volumes,
                issues,
            } = detection::detect(
                &source,
                if split { &r.rules } else { &[] },
                &[],
                &[],
                &CancellationToken::new(),
            )?;
            if !split {
                r.single_chapter_sources.push(source.id.clone());
            }
            r.document.project.sources.push(source);
            r.document.project.chapters.extend(chapters);
            r.document.project.volumes.extend(volumes);
            r.issues.extend(issues);
            r.document.project.revision += 1;
            r.filename = None;
            r.undo = Some(before);
            Ok(())
        })?;
        Ok(self.read(id)?.snapshot())
    }
    pub fn text(
        &self,
        id: &str,
        source_id: &str,
        line: u32,
        count: u32,
    ) -> Result<TextPage, ProjectError> {
        let record = self.read(id)?;
        let source = record
            .document
            .project
            .sources
            .iter()
            .find(|s| s.id == source_id)
            .ok_or(ProjectError::NotFound)?;
        text_page(source, line, count)
    }
}
use std::io::Write;

pub(crate) fn text_page(
    source: &project::Source,
    line: u32,
    count: u32,
) -> Result<TextPage, ProjectError> {
    if count == 0 || count > 100 {
        return Err(ProjectError::TooLarge);
    }
    let ranges = project::line_ranges(&source.text);
    if line as usize >= ranges.len() {
        return Err(ProjectError::NotFound);
    }
    let mut lines = Vec::new();
    let mut bytes = 0;
    for (i, &(a, b)) in ranges
        .iter()
        .enumerate()
        .skip(line as usize)
        .take(count as usize)
    {
        if b - a > 8192 {
            return Err(ProjectError::TooLarge);
        }
        if bytes + (b - a) > 8192 {
            break;
        }
        bytes += b - a;
        lines.push(TextLine {
            line: i as u32,
            start: a,
            end: b,
            text: source.text[a as usize..b as usize].into(),
        });
    }
    let next = line + lines.len() as u32;
    Ok(TextPage {
        source_id: source.id.clone(),
        sha256: source.sha256.clone(),
        lines,
        next_line: (next < ranges.len() as u32).then_some(next),
    })
}
fn read(path: &Path) -> Result<Recovery, ProjectError> {
    super::storage::read(path)
}
fn write(path: &Path, record: &Recovery) -> Result<(), ProjectError> {
    super::storage::write(path, record)
}
