//! Character-to-voice binding: targets, voice references, profiles and casting suggestions.
mod catalog;
pub(crate) mod commands;
mod profile;
mod query;
mod store;
pub(crate) mod suggest;
mod types;

// Cross-module surface: only what other domains consume. Everything else stays
// module-internal and is re-exported here when a consumer appears.
pub(crate) use catalog::{read as read_catalog, snapshot as catalog_snapshot};
pub(crate) use query::{VoiceReferenceView, references_with_titles};
#[cfg(test)]
pub(crate) use types::StoredCastingInput;
pub(crate) use types::{BindingError, CatalogSnapshot, VoiceRef};
