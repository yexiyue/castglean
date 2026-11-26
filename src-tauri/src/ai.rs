//! Shared AI conversation contracts, independent of chapter-splitting business results.
pub(crate) mod agent;
pub(crate) mod assistant;
pub(crate) mod budget;
pub(crate) mod dispatch;
#[cfg(test)]
pub(crate) mod efficiency;
pub(crate) mod failure;
pub(crate) mod history;
pub(crate) mod hook;
pub(crate) mod interrupts;
pub(crate) mod invocations;
pub(crate) mod messages;
pub(crate) mod output;
mod projection;
pub(crate) mod protocol;
pub(crate) mod runs;
mod service;
pub(crate) mod split_execution;
pub(crate) mod stream;
pub(crate) mod tasks;
#[cfg(test)]
mod test_support;
pub(crate) mod tool_input;
pub(crate) mod tools;
mod types;
pub(crate) use history::active_tasks;
pub(crate) use history::model_input;
pub(crate) use history::page as history_page;
pub(crate) use history::task_input;
#[cfg(test)]
pub(crate) use service::start as start_run;
pub(crate) use service::{
    create as create_session, replay as replay_request, run_configuration,
    start_analysis as start_analysis_run, start_desktop as start_desktop_run,
};
pub(crate) use types::{
    AiError, Budget, Configuration, CreateSession, HistoryPage, Message, RunFailure, RunInfo,
    RunStatus, SessionCursor, SessionInfo, SessionPage, StartRun, Trigger, WorkspaceAction,
    WorkspaceContext,
};
