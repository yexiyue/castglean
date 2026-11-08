//! Shared AI conversation contracts, independent of chapter-splitting business results.
pub(crate) mod budget;
pub(crate) mod commands;
pub(crate) mod dispatch;
mod history;
pub(crate) mod messages;
pub(crate) mod output;
mod projection;
pub(crate) mod runs;
mod service;
pub(crate) mod stream;
#[cfg(test)]
mod test_support;
pub(crate) mod tools;
mod types;
pub(crate) use history::active_tasks;
pub(crate) use history::model_input;
pub(crate) use history::page as history_page;
pub(crate) use service::{
    create as create_session, replay as replay_request, start as start_run,
    start_analysis as start_analysis_run,
};
pub(crate) use types::{
    AiError, Budget, Configuration, CreateSession, HistoryPage, Message, RunFailure, RunInfo,
    RunStatus, SessionCursor, SessionInfo, SessionPage, StartRun, Trigger, WorkspaceAction,
    WorkspaceContext,
};
