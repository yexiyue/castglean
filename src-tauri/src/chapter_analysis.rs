//! Source-bound chapter attribution. No engine or UI state belongs in this domain.
mod agent_core;
mod agent_runtime;
mod candidates;
mod checkpoint;
pub(crate) use checkpoint::{Generation, WindowRecord};
mod characters;
pub(crate) mod commands;
mod edits;
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
mod validation;
mod windows;

pub(crate) use query::inspect;
