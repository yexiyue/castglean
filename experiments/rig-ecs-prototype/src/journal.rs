//! Experiment-only atomic JSON checkpoint; no product database or session replacement.
use crate::contract::{Analysis, Review};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
}
impl From<&rig_core::completion::Usage> for Usage {
    fn from(u: &rig_core::completion::Usage) -> Self {
        Self {
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
            cached_input_tokens: u.cached_input_tokens,
            reasoning_tokens: u.reasoning_tokens,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Span {
    pub run_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub stage: String,
    pub route: String,
    pub attempt: u32,
    pub status: String,
    pub started_at: String,
    pub elapsed_ms: u64,
    pub is_request: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Metadata>,
    pub started_unix_ms: u64,
    pub elapsed_ms_is_lower_bound: bool,
    pub usage: Usage,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Metadata {
    pub model: String,
    #[serde(default)]
    pub boundary_mode: String,
    #[serde(default)]
    pub capabilities_verified: bool,
    pub configuration_hash: String,
    pub prompt_version: String,
    pub prompt_hash: String,
    pub protocol_version: String,
    pub source_hash: String,
    pub dataset_hash: String,
    pub dataset_version: String,
    pub code_revision: String,
    pub character_snapshot_hash: String,
    pub identity_scope: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum State {
    #[default]
    Pending,
    InFlight,
    Completed,
    Failed,
    Cancelled,
    TimedOut,
    Unknown,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct Slot {
    pub state: State,
    pub analysis: Option<Analysis>,
    pub review: Option<Review>,
    pub span_id: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Journal {
    pub version: u32,
    pub fingerprint: String,
    pub run_id: String,
    pub slots: Vec<Slot>,
    pub trace: Vec<Span>,
}
impl Journal {
    pub fn load(path: &Path, fingerprint: &str) -> Result<Self> {
        let mut journal: Self = serde_json::from_slice(&fs::read(path)?)?;
        ensure!(
            journal.version == 1 && journal.fingerprint == fingerprint && journal.slots.len() == 4,
            "checkpoint_identity"
        );
        for slot in &mut journal.slots {
            if slot.state == State::InFlight {
                slot.state = State::Unknown;
                if let Some(span) = journal
                    .trace
                    .iter_mut()
                    .find(|s| Some(&s.span_id) == slot.span_id.as_ref())
                {
                    span.status = "interrupted".into();
                    span.elapsed_ms_is_lower_bound = true;
                    // Only elapsed time observed before the crash is known.
                }
            }
        }
        for span in &mut journal.trace {
            if span.status == "running" {
                span.status = "interrupted".into();
                span.elapsed_ms_is_lower_bound = true;
            }
        }
        Ok(journal)
    }
    pub fn save(&self, path: &Path) -> Result<()> {
        let parent = path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("checkpoint_parent"))?;
        fs::create_dir_all(parent)?;
        let temporary = path.with_extension("pending");
        let mut file = File::create(&temporary)?;
        file.write_all(&serde_json::to_vec(self)?)?;
        file.sync_all()?;
        fs::rename(temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    }
}

/// Refuse outputs outside this package's ignored target tree, including symlink escapes.
pub(crate) fn target_path(path: &Path) -> Result<PathBuf> {
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
    fs::create_dir_all(&target)?;
    let target = target.canonicalize()?;
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    ensure!(
        absolute.starts_with(&target),
        "outputs_must_be_in_package_target"
    );
    // Resolve every existing ancestor before creating missing directories.
    let parent = absolute
        .parent()
        .ok_or_else(|| anyhow::anyhow!("output_parent"))?;
    let mut ancestor = parent;
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| anyhow::anyhow!("output_ancestor"))?;
    }
    ensure!(
        ancestor.canonicalize()?.starts_with(&target),
        "output_symlink_escape"
    );
    ensure!(
        !absolute
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir)),
        "output_parent_escape"
    );
    fs::create_dir_all(parent)?;
    ensure!(
        parent.canonicalize()?.starts_with(&target),
        "output_symlink_escape"
    );
    if absolute.exists() {
        ensure!(
            absolute.canonicalize()?.starts_with(&target),
            "output_symlink_escape"
        );
    }
    Ok(absolute)
}

/// OS-held ownership; a process crash releases the lock without deleting diagnostics.
pub(crate) fn lock(path: &Path) -> Result<File> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("checkpoint_parent"))?;
    fs::create_dir_all(parent)?;
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path.with_extension("lock"))?;
    fs2::FileExt::try_lock_exclusive(&file)?;
    Ok(file)
}
