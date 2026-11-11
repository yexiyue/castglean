//! Source-bound chapter attribution. No engine or UI state belongs in this domain.
mod agent_core;
mod agent_runtime;
mod candidates;
mod checkpoint;
pub(crate) use checkpoint::{Generation, WindowRecord};
mod characters;
pub(crate) use characters::{narrator_usage, usage as character_usage};
pub(crate) mod commands;
mod edits;
mod evidence;
pub(crate) use evidence::{FrozenExcerpt, freeze_character_evidence, read_frozen_evidence};
mod execution;
mod observation;
mod publication;
#[cfg(test)]
pub(crate) use agent_runtime::fixture_response;
mod execution_agent;
pub(crate) use execution::execute;
mod input;
pub(crate) use input::freeze as freeze_input;
#[cfg(test)]
mod evaluation;
mod history;
mod query;
mod review;
mod source;
mod store;
mod types;
pub(crate) use types::AnalysisError;
mod validation;
mod windows;

pub(crate) use query::inspect;
// 章节音频域只读复用：采用分析、来源绑定与定位，不进入分析内部协议。
pub(crate) use query::{
    binding as analysis_binding, characters as analysis_characters,
    read_text as read_analysis_text, version as analysis_version,
};
pub(crate) use source::line_at;
pub(crate) use store::state as analysis_state;
pub(crate) use types::{Attribution, ByteRange, Character, Segment};
pub(crate) use validation::validate as validate_analysis;
