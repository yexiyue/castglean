//! Portable project domain. Import/diagnostic sessions own mutable local drafts.
pub(crate) mod commands;
mod document;
pub(crate) use document::{
    Chapter, Correction, MAX_SOURCE, MAX_TOTAL, ProjectDocument, ProjectError, Source, Volume,
    filename, hash, line_ranges, publish, read, save,
};
