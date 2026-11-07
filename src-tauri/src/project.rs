//! Local project domain, immutable sources, and database-owned editing use cases.
mod assets;
pub(crate) mod edits;
pub(crate) mod local;
mod query;
pub(crate) mod receipts;
pub(crate) mod store;
mod text;
pub(crate) use text::{TextPage, page as source_text_page, read as read_source_text};
#[cfg(test)]
pub(crate) mod test_support;
pub(crate) use assets::publish_source;
mod document;
pub(crate) use document::{
    Chapter, Correction, MAX_SOURCE, MAX_TOTAL, ProjectDocument, ProjectError, Source, Volume,
    hash, line_ranges,
};
