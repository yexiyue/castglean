//! Concrete chapter-level JSON journal; no provider configuration or implicit IO.
#[cfg(test)]
mod tests;
use crate::{
    AnalysisError, AnalysisModel, AnalysisOptions, AnalysisStats, BookAction, BookAnalysisInput,
    BookAnalysisMode, BookDocument, BookError, BookState, CancellationToken, ChapterId,
    SEGMENTATION_VERSION, SourceMetadata, SourceSnapshot,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, TryLockError},
    io::{self, Write},
    path::{Path, PathBuf},
};

/// Public, non-secret model settings. Never put credentials in these fields.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RunModel {
    /// Provider/backend identity.
    pub backend: String,
    /// Actual model identifier.
    pub model: String,
    /// Non-secret endpoint; must not contain authentication information.
    pub endpoint: String,
    /// Explicit reasoning mode.
    pub reasoning_effort: String,
    /// Actual output mode.
    pub output_mode: String,
}
/// Frozen analysis configuration. Hosts must change implementation when behavior changes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RunConfig {
    /// Non-secret provider settings, checked by the host against its model.
    pub model: RunModel,
    /// Complete per-chapter limits and evidence policy.
    pub options: AnalysisOptions,
    /// Prompt version in use.
    pub prompt_version: u32,
    /// Partition protocol version.
    pub segmentation_version: u32,
    /// Host-controlled implementation identity; bump after behavior changes.
    pub implementation: String,
}
impl RunConfig {
    /// Construct explicit configuration using this library's protocol versions.
    pub fn new(model: RunModel, options: AnalysisOptions, implementation: String) -> Self {
        Self {
            prompt_version: options.evidence_mode.prompt_version(),
            segmentation_version: SEGMENTATION_VERSION,
            model,
            options,
            implementation,
        }
    }
    fn validate(&self) -> Result<(), RunError> {
        if self.prompt_version != self.options.evidence_mode.prompt_version()
            || self.segmentation_version != SEGMENTATION_VERSION
            || self.implementation.trim().is_empty()
        {
            return Err(RunError::Configuration);
        }
        self.options.validate()?;
        Ok(())
    }
}
/// One frozen, normalized chapter. Source metadata binds the UTF-8 text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RunChapter {
    /// Unique identity within the complete book.
    pub chapter_id: ChapterId,
    /// Saved normalized text, never an external path.
    pub text: String,
    /// Source hashes and normalization convention.
    pub source: SourceMetadata,
}
impl RunChapter {
    /// Freeze an immutable source snapshot.
    pub fn new(chapter_id: ChapterId, source: SourceSnapshot) -> Self {
        Self {
            chapter_id,
            text: source.text().to_owned(),
            source: source.metadata().clone(),
        }
    }
    fn snapshot(&self) -> Result<SourceSnapshot, RunError> {
        SourceSnapshot::from_saved(self.text.clone(), self.source.clone())
            .map_err(|_| RunError::Invalid("invalid planned source"))
    }
}
/// Editable run input; validated on creation and every recovery.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RunPlan {
    /// Draft run format, currently 1.
    pub format_version: u32,
    /// Fully validated starting book, including human corrections.
    pub base: BookDocument,
    /// Chapters in execution order; only append is supported.
    pub chapters: Vec<RunChapter>,
    /// Frozen non-secret model and analysis configuration.
    pub config: RunConfig,
}
impl RunPlan {
    fn validate(&self) -> Result<BookState, RunError> {
        if self.format_version != 1 || self.chapters.is_empty() || self.chapters.len() > 99_999_999
        {
            return Err(RunError::Invalid("invalid run format or chapter count"));
        }
        self.config.validate()?;
        let state = BookState::from_document(self.base.clone())?;
        let mut ids: HashSet<_> = self
            .base
            .chapters
            .iter()
            .map(|c| &c.annotations.chapter_id)
            .collect();
        for chapter in &self.chapters {
            if !ids.insert(&chapter.chapter_id) {
                return Err(RunError::Invalid("duplicate planned chapter"));
            }
            chapter.snapshot()?;
        }
        state
            .revision()
            .checked_add(self.chapters.len() as u64)
            .ok_or(BookError::RevisionOverflow)?;
        Ok(state)
    }
    /// Content fingerprint including source, configuration and the entire base book.
    pub fn fingerprint(&self) -> Result<String, RunError> {
        digest(self)
    }
}
/// Errors contain categories, never raw serialized inputs or model output.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    /// A cooperating process already owns this run.
    #[error("run is busy")]
    Busy,
    /// A frozen configuration or protocol no longer matches.
    #[error("run configuration mismatch")]
    Configuration,
    /// Invalid or corrupted journal data; description is program-generated.
    #[error("invalid run: {0}")]
    Invalid(&'static str),
    /// Filesystem operation, excluding private file contents.
    #[error("run IO: {0}")]
    Io(#[from] io::Error),
    /// Validated book operation failed.
    #[error(transparent)]
    Book(#[from] BookError),
    /// Analysis or cancellation failed.
    #[error(transparent)]
    Analysis(#[from] AnalysisError),
}
/// Safe progress; success statistics exclude uncommitted or interrupted calls.
#[derive(Clone, Debug, Serialize)]
pub struct RunProgress {
    /// Immutable plan digest, also the run identity.
    pub fingerprint: String,
    /// Number of complete durable chapter commits.
    pub completed: usize,
    /// Number of planned chapters.
    pub total: usize,
    /// Latest common book revision.
    pub revision: u64,
    /// Actual successful chapter statistics in order; unknown usage stays null.
    pub committed_stats: Vec<AnalysisStats>,
    /// Costs of uncommitted calls are unknown; never count them as zero.
    pub uncommitted_usage: Option<crate::TokenUsage>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    fingerprint: String,
    plan: RunPlan,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Commit {
    fingerprint: String,
    parent: String,
    sequence: usize,
    book: BookDocument,
    stats: AnalysisStats,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    digest: String,
    commit: Commit,
}

/// Exclusively owned concrete JSON run. Drop releases its OS file lock.
///
/// Complete chapter directories are authoritative; staging directories are ignored.
/// Use a trusted local filesystem with cooperating writers. This is not a signature
/// or a guarantee of power-loss durability on every filesystem.
pub struct BookRun {
    path: PathBuf,
    _lock: File,
    manifest: Manifest,
    state: BookState,
    parent: String,
    stats: Vec<AnalysisStats>,
    poisoned: bool,
}
impl BookRun {
    /// Publish a new frozen plan at an absent path, then exclusively open it.
    pub fn create(path: &Path, plan: RunPlan) -> Result<Self, RunError> {
        plan.validate()?;
        absent(path)?;
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let staging = tempfile::Builder::new()
            .prefix(".castglean-run-")
            .tempdir_in(parent)?;
        let manifest = Manifest {
            fingerprint: plan.fingerprint()?,
            plan,
        };
        save(&staging.path().join("manifest.json"), &manifest)?;
        fs::create_dir(staging.path().join("commits"))?;
        sync_dir(staging.path())?;
        absent(path)?;
        fs::rename(staging.path(), path)?;
        sync_dir(parent)?;
        Self::open(path)
    }
    /// Acquire an exclusive OS lock and validate the complete committed prefix.
    /// Does not load any provider or environment configuration.
    pub fn open(path: &Path) -> Result<Self, RunError> {
        directory(path)?;
        let lock = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.join("run.lock"))?;
        match lock.try_lock() {
            Ok(()) => (),
            Err(TryLockError::WouldBlock) => return Err(RunError::Busy),
            Err(TryLockError::Error(e)) => return Err(e.into()),
        }
        let manifest: Manifest = load(&path.join("manifest.json"))?;
        let mut state = manifest.plan.validate()?;
        if manifest.fingerprint != manifest.plan.fingerprint()? {
            return Err(RunError::Invalid("plan digest mismatch"));
        }
        let commits = path.join("commits");
        directory(&commits)?;
        let mut names = Vec::new();
        for entry in fs::read_dir(&commits)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| RunError::Invalid("invalid commit path"))?;
            if name.starts_with(".pending-") && entry.file_type()?.is_dir() {
                continue;
            }
            directory(&entry.path())?;
            names.push(name);
        }
        names.sort();
        if names.len() > manifest.plan.chapters.len() {
            return Err(RunError::Invalid("too many commits"));
        }
        let mut parent = manifest.fingerprint.clone();
        let mut stats = Vec::new();
        for (index, name) in names.into_iter().enumerate() {
            if name != format!("{:08}", index + 1) {
                return Err(RunError::Invalid("noncontiguous commit sequence"));
            }
            let receipt: Receipt = load(&commits.join(name).join("commit.json"))?;
            let commit = &receipt.commit;
            if commit.sequence != index + 1
                || commit.parent != parent
                || commit.fingerprint != manifest.fingerprint
                || receipt.digest != digest(commit)?
            {
                return Err(RunError::Invalid("commit digest or lineage mismatch"));
            }
            check_transition(
                &state.document(),
                &commit.book,
                &manifest.plan.chapters[index],
            )?;
            state = BookState::from_document(commit.book.clone())?;
            parent = receipt.digest;
            stats.push(receipt.commit.stats);
        }
        Ok(Self {
            path: path.into(),
            _lock: lock,
            manifest,
            state,
            parent,
            stats,
            poisoned: false,
        })
    }
    /// Frozen inputs. They cannot be edited through a running handle.
    pub fn plan(&self) -> &RunPlan {
        &self.manifest.plan
    }
    /// Latest completely validated committed state, or the frozen base.
    pub fn state(&self) -> &BookState {
        &self.state
    }
    /// Safe progress derived from the committed prefix.
    pub fn progress(&self) -> RunProgress {
        RunProgress {
            fingerprint: self.manifest.fingerprint.clone(),
            completed: self.stats.len(),
            total: self.manifest.plan.chapters.len(),
            revision: self.state.revision(),
            committed_stats: self.stats.clone(),
            uncommitted_usage: None,
        }
    }
    /// Reject configuration drift before starting a request, including for complete runs.
    pub fn check_config(&self, config: &RunConfig) -> Result<(), RunError> {
        config.validate()?;
        if config != &self.manifest.plan.config {
            return Err(RunError::Configuration);
        }
        Ok(())
    }
    /// Analyze and commit the next chapter. Returns false when already complete.
    /// Failed/interrupted calls do not commit; after an IO failure reopen to reconcile
    /// whether a directory rename already completed. External requests may repeat.
    pub async fn advance<M: AnalysisModel>(
        &mut self,
        model: &M,
        config: &RunConfig,
        cancel: &CancellationToken,
    ) -> Result<bool, RunError> {
        self.advance_detailed(model, config, cancel)
            .await
            .map_err(crate::RunFailure::into_error)
    }
    /// Commit the next complete chapter, retaining diagnostics for failed analysis.
    pub async fn advance_detailed<M: AnalysisModel>(
        &mut self,
        model: &M,
        config: &RunConfig,
        cancel: &CancellationToken,
    ) -> Result<bool, crate::RunFailure> {
        if self.poisoned {
            return Err(RunError::Invalid("reopen after commit IO failure").into());
        }
        self.check_config(config).map_err(crate::RunFailure::from)?;
        if cancel.is_cancelled() {
            return Err(RunError::Analysis(AnalysisError::Cancelled).into());
        }
        let Some(chapter) = self.manifest.plan.chapters.get(self.stats.len()) else {
            return Ok(false);
        };
        let result = self
            .state
            .analyze_detailed(
                model,
                BookAnalysisInput {
                    chapter_id: chapter.chapter_id.clone(),
                    source: chapter.snapshot().map_err(crate::RunFailure::from)?,
                    expected_revision: self.state.revision(),
                    mode: BookAnalysisMode::Append,
                },
                &config.options,
                cancel,
            )
            .await
            .map_err(|f| f.map(RunError::Book))?;
        if cancel.is_cancelled() {
            return Err(RunError::Analysis(AnalysisError::Cancelled).into());
        }
        let commit = Commit {
            fingerprint: self.manifest.fingerprint.clone(),
            parent: self.parent.clone(),
            sequence: self.stats.len() + 1,
            book: result.state.document(),
            stats: result.stats,
        };
        check_transition(&self.state.document(), &commit.book, chapter)
            .map_err(crate::RunFailure::from)?;
        let receipt = Receipt {
            digest: digest(&commit).map_err(crate::RunFailure::from)?,
            commit,
        };
        let commits = self.path.join("commits");
        let destination = commits.join(format!("{:08}", receipt.commit.sequence));
        self.poisoned = true;
        let staging = tempfile::Builder::new()
            .prefix(".pending-")
            .tempdir_in(&commits)?;
        save(&staging.path().join("commit.json"), &receipt)?;
        sync_dir(staging.path())?;
        if cancel.is_cancelled() {
            self.poisoned = false;
            return Err(RunError::Analysis(AnalysisError::Cancelled).into());
        }
        absent(&destination)?;
        fs::rename(staging.path(), destination)?;
        sync_dir(&commits)?;
        self.state = result.state;
        self.parent = receipt.digest;
        self.stats.push(receipt.commit.stats);
        self.poisoned = false;
        Ok(true)
    }
}
fn check_transition(
    before: &BookDocument,
    after: &BookDocument,
    chapter: &RunChapter,
) -> Result<(), RunError> {
    let revision = before
        .registry
        .revision
        .checked_add(1)
        .ok_or(BookError::RevisionOverflow)?;
    let mut prefix = after.clone();
    let last = prefix
        .chapters
        .pop()
        .ok_or(RunError::Invalid("missing appended chapter"))?;
    if after.registry.revision != revision
        || last.annotations.chapter_id != chapter.chapter_id
        || last.text != chapter.text
        || last.annotations.source != chapter.source
        || after.changes.last().is_none_or(|c| {
            c.revision != revision
                || c.action
                    != (BookAction::Appended {
                        chapter_id: chapter.chapter_id.clone(),
                    })
        })
    {
        return Err(RunError::Invalid("unexpected chapter transition"));
    }
    prefix.changes.pop();
    if prefix.registry.characters.len() < before.registry.characters.len() {
        return Err(RunError::Invalid("removed existing identities"));
    }
    prefix
        .registry
        .characters
        .truncate(before.registry.characters.len());
    prefix.registry.revision = before.registry.revision;
    for chapter in &mut prefix.chapters {
        chapter.annotations.character_revision = before.registry.revision;
    }
    if &prefix != before {
        return Err(RunError::Invalid("changed committed base data"));
    }
    Ok(())
}
fn digest(value: &impl Serialize) -> Result<String, RunError> {
    let bytes =
        serde_json::to_vec(value).map_err(|_| RunError::Invalid("cannot serialize run data"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
fn load<T: DeserializeOwned>(path: &Path) -> Result<T, RunError> {
    let file = File::open(path)?;
    serde_json::from_reader(file).map_err(|_| RunError::Invalid("invalid saved JSON"))
}
fn save(path: &Path, value: &impl Serialize) -> Result<(), RunError> {
    let mut file = File::create_new(path)?;
    serde_json::to_writer_pretty(&mut file, value)
        .map_err(|_| RunError::Invalid("cannot serialize run data"))?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}
fn absent(path: &Path) -> Result<(), RunError> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
        Ok(_) => Err(io::Error::from(io::ErrorKind::AlreadyExists).into()),
    }
}
fn directory(path: &Path) -> Result<(), RunError> {
    if !fs::symlink_metadata(path)?.is_dir() {
        return Err(RunError::Invalid("expected real directory"));
    }
    Ok(())
}
fn sync_dir(path: &Path) -> Result<(), RunError> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
