use crate::engine::InferenceDevice;
use serde::{Deserialize, Serialize};

/// Bounded mono display peaks; playback still reads the original WAV.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub(crate) struct VoiceWaveform {
    pub duration: f64,
    pub peaks: Vec<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum VoiceSelection {
    Preset { voice: String },
    Library { id: String },
    Candidate { id: String },
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum StudioRequest {
    PrepareDesign {
        engine: String,
    },
    Design {
        engine: String,
        device: InferenceDevice,
        name: String,
        description: String,
        text: String,
        seed: Option<u32>,
    },
    Audition {
        backend: String,
        model: String,
        device: InferenceDevice,
        voice: VoiceSelection,
        text: String,
        style: Option<String>,
    },
}
#[derive(Debug, Clone, Serialize, specta::Type)]
pub(crate) struct CandidateView {
    pub id: String,
    pub voice: super::super::LibraryVoice,
    pub audio: String,
    pub saved_id: Option<String>,
}
#[derive(Debug, Clone, Copy, Serialize, specta::Type, PartialEq)]
pub(crate) enum JobState {
    Queued,
    Running,
    Cancelling,
    Cancelled,
    Failed,
    Succeeded,
}
impl JobState {
    pub(super) fn terminal(self) -> bool {
        matches!(self, Self::Cancelled | Self::Failed | Self::Succeeded)
    }
}
#[derive(Debug, Clone, Serialize, specta::Type)]
pub(crate) struct StudioJob {
    pub id: u32,
    pub sequence: u32,
    pub request: StudioRequest,
    pub state: JobState,
    pub stage: String,
    pub resource: Option<crate::engine::ResourceState>,
    pub error: Option<String>,
    pub candidate: Option<String>,
    pub audio: Option<String>,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
pub(crate) struct StudioSnapshot {
    pub sequence: u32,
    pub jobs: Vec<StudioJob>,
    pub candidates: Vec<CandidateView>,
}
#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
pub(crate) struct StudioUpdate(pub StudioJob);

#[derive(Default)]
pub(super) struct JobOutput {
    pub candidate: Option<String>,
    pub audio: Option<String>,
}
pub(super) type JobResult = Result<JobOutput, String>;
