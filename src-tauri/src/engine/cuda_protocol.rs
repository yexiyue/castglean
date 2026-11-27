//! Private, bounded protocol for one desktop-owned CUDA engine session.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const VERSION: u16 = 1;
pub const BACKEND: &str = "kokoro";
pub const MODEL: &str = "1.1-zh-g2pw";
pub const MAX_FRAME: usize = 64 * 1024;
pub const MAX_PCM_BYTES: usize = 64 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u16,
    pub id: u32,
    pub command: Command,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Probe,
    Load { model: String, hub_cache: PathBuf },
    Synthesize { text: String, voice: String },
    Shutdown,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub version: u16,
    pub id: u32,
    pub outcome: Outcome,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Outcome {
    Available,
    Loaded,
    Audio,
    Closed,
    Failed { reason: Failure },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Failure {
    DeviceUnavailable,
    ModelUnavailable,
    UnexpectedCommand,
    SynthesisFailed,
    OutputFailed,
}
