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
pub(crate) use store::{BindingView, bindings as project_bindings};
#[cfg(test)]
pub(crate) use types::StoredCastingInput;
pub(crate) use types::{BindingError, BindingTarget, CatalogSnapshot, VoiceRef};
#[cfg(test)]
pub(crate) use {
    catalog::CatalogView as TestCatalogView,
    store::{BindingEdit as TestBindingEdit, apply as test_apply_binding},
    types::BindingOrigin as TestBindingOrigin,
};
