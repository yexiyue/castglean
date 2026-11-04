//! 工程文件域：`.castglean` 快照的校验、原子发布与 IPC 命令。
pub(crate) mod commands;
mod document;

pub(crate) use document::{
    ProjectDocument, ProjectError, ProjectInput, ProjectReceipt, filename, read, save,
};
