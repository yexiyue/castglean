//! 应用语义 DTO；事件和快照共用同一份权威任务事实。
use serde::{Deserialize, Serialize};
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub(crate) enum VoiceFailure {
    UnsupportedFormat,
    InvalidPackage,
    LimitExceeded,
    InvalidAudio,
    ContentMismatch,
    Conflict,
    StalePreview,
    MissingDescription,
    Busy,
    Cancelled,
    Disk,
    Io,
    Unavailable,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct VoiceError {
    pub code: VoiceFailure,
    pub input_index: Option<u32>,
}
impl VoiceError {
    pub(crate) fn new(code: VoiceFailure) -> Self {
        Self {
            code,
            input_index: None,
        }
    }
}
impl From<talechime::VoiceLibraryError> for VoiceError {
    fn from(error: talechime::VoiceLibraryError) -> Self {
        use talechime::VoiceLibraryError as E;
        let code = match error {
            E::Input { index, error } => {
                let mut result = Self::from(*error);
                result.input_index = Some(index as u32);
                return result;
            }
            E::UnsupportedFormat(_) => VoiceFailure::UnsupportedFormat,
            E::InvalidPackage(_) => VoiceFailure::InvalidPackage,
            E::LimitExceeded(_) => VoiceFailure::LimitExceeded,
            E::InvalidAudio(_) => VoiceFailure::InvalidAudio,
            E::ContentMismatch => VoiceFailure::ContentMismatch,
            E::Conflict(_) => VoiceFailure::Conflict,
            E::StalePreview => VoiceFailure::StalePreview,
            E::Busy => VoiceFailure::Busy,
            E::Cancelled => VoiceFailure::Cancelled,
            E::Disk(_) => VoiceFailure::Disk,
            E::Io(_) => VoiceFailure::Io,
        };
        Self::new(code)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct LibraryVoice {
    pub id: String,
    pub name: String,
    pub transcript: String,
    pub description: Option<String>,
    pub source: Option<String>,
    pub created_at: f64,
    pub imported_at: f64,
    pub bytes: f64,
    pub duration: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct VoiceDiagnostic {
    pub id: String,
    pub error: VoiceError,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct VoiceInventory {
    pub voices: Vec<LibraryVoice>,
    pub diagnostics: Vec<VoiceDiagnostic>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct SelectedVoiceFile {
    pub index: u32,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct VoiceFileSelection {
    pub id: u32,
    pub files: Vec<SelectedVoiceFile>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) enum VoiceConflict {
    AlreadyPresent,
    MetadataDifference,
    IdentityConflict,
    SameName,
    DuplicateContent,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct ImportVoiceEntry {
    pub index: u32,
    pub voice: LibraryVoice,
    pub sources: Vec<u32>,
    pub conflicts: Vec<VoiceConflict>,
    pub existing_id: Option<String>,
    pub existing_voice: Option<LibraryVoice>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct VoiceImportPreview {
    pub id: u32,
    pub entries: Vec<ImportVoiceEntry>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub(crate) enum VoiceImportAction {
    Import,
    ImportAsNew,
    Skip,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub(crate) struct VoiceImportDecision {
    pub entry: u32,
    pub action: VoiceImportAction,
    /// Required for entries whose package description is empty; applied to the
    /// imported asset after publication.
    #[serde(default)]
    pub description: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) enum VoiceItemStatus {
    Imported,
    AlreadyPresent,
    Skipped,
    Failed,
    Cancelled,
    NotAttempted,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct VoiceItemResult {
    pub name: String,
    pub entry: u32,
    pub files: Vec<String>,
    pub local_id: Option<String>,
    pub status: VoiceItemStatus,
    pub error: Option<VoiceError>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
pub(crate) enum VoiceTaskState {
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) enum VoiceTaskKind {
    Inspect,
    Import,
    Export,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) enum VoiceTaskStage {
    Checking,
    Planning,
    Writing,
    Committing,
    Completed,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct VoiceTaskSnapshot {
    pub id: u32,
    pub sequence: u32,
    pub kind: VoiceTaskKind,
    pub state: VoiceTaskState,
    pub stage: VoiceTaskStage,
    pub completed: u32,
    pub total: u32,
    pub bytes: f64,
    pub preview: Option<VoiceImportPreview>,
    pub items: Vec<VoiceItemResult>,
    pub error: Option<VoiceError>,
    pub filename: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub(crate) struct VoiceTransferEvent {
    pub task: VoiceTaskSnapshot,
}
impl VoiceTransferEvent {
    pub(crate) fn publish(task: VoiceTaskSnapshot, app: &tauri::AppHandle) {
        let _ = Self { task }.emit(app);
    }
}
