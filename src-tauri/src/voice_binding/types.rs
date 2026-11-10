//! Application-level binding contracts; engine and library types never leak here.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Library asset ids are ASCII `[A-Za-z0-9_-]`, at most 64 characters.
pub(crate) const LIBRARY_ID_MAX: usize = 64;
/// Preset tuple fields and display names stay short, single-line strings.
pub(crate) const PRESET_FIELD_MAX: usize = 128;
/// Character ids are host-generated UUID strings.
pub(crate) const CHARACTER_ID_MAX: usize = 64;
/// Profile text and design prompts are human-scale texts.
pub(crate) const PROFILE_TEXT_MAX: usize = 2000;
/// Suggestion reasons are short explanations.
pub(crate) const SUGGESTION_REASON_MAX: usize = 1000;

fn is_portable_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= LIBRARY_ID_MAX
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn is_single_line(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.contains(['\n', '\r']) && !s.chars().any(char::is_control)
}

/// Voice binding target: the project-wide narrator role or a character identity.
/// Narrator is a binding-side concept only; attribution keeps it a segment state.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum BindingTarget {
    Narrator,
    Character { character_id: String },
}

impl BindingTarget {
    /// Column projection. Narrator stores an empty character id so per-project
    /// uniqueness works without relying on SQLite NULL comparison rules.
    pub(crate) fn columns(&self) -> (&'static str, &str) {
        match self {
            BindingTarget::Narrator => ("narrator", ""),
            BindingTarget::Character { character_id } => ("character", character_id.as_str()),
        }
    }

    pub(crate) fn from_columns(kind: &str, character_id: &str) -> Option<Self> {
        match kind {
            "narrator" if character_id.is_empty() => Some(BindingTarget::Narrator),
            "character" if !character_id.is_empty() => Some(BindingTarget::Character {
                character_id: character_id.to_owned(),
            }),
            _ => None,
        }
    }

    /// Storage key used inside frozen snapshots: `narrator` or `character:<id>`.
    pub(crate) fn storage_key(&self) -> String {
        match self {
            BindingTarget::Narrator => "narrator".to_owned(),
            BindingTarget::Character { character_id } => format!("character:{character_id}"),
        }
    }

    #[cfg(test)]
    pub(crate) fn from_storage_key(key: &str) -> Option<Self> {
        if key == "narrator" {
            return Some(BindingTarget::Narrator);
        }
        key.strip_prefix("character:")
            .filter(|id| !id.is_empty())
            .map(|id| BindingTarget::Character {
                character_id: id.to_owned(),
            })
    }

    pub(crate) fn character_id(&self) -> Option<&str> {
        match self {
            BindingTarget::Narrator => None,
            BindingTarget::Character { character_id } => Some(character_id),
        }
    }
}

/// A reference to an actual voice: a library asset by stable id, or a preset
/// voice resolved by its backend, model and voice name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum VoiceRef {
    Library {
        id: String,
    },
    Preset {
        backend: String,
        model: String,
        voice: String,
    },
}

impl VoiceRef {
    /// Stable identity key used for snapshots, digests and deduplication.
    pub(crate) fn key(&self) -> String {
        match self {
            VoiceRef::Library { id } => format!("library:{id}"),
            VoiceRef::Preset {
                backend,
                model,
                voice,
            } => {
                format!("preset:{}", serde_json::json!([backend, model, voice]))
            }
        }
    }
}

/// How a binding came to be: direct human action or adoption of a suggestion run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "origin", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum BindingOrigin {
    Manual,
    Suggestion { run_id: String },
}

/// `voice_bindings.content`. `voice: None` marks an unbound target whose row and
/// history are kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredBinding {
    pub format_version: u32,
    pub voice: Option<VoiceRef>,
    pub origin: Option<BindingOrigin>,
    pub updated_at: String,
}

/// How the current profile text came to be; suggestion adoption never overwrites
/// human edits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "source", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ProfileProvenance {
    Human,
    Suggestion { run_id: String },
}

/// `character_voice_profiles.content`. Empty text means no profile; profiles are
/// advice-layer data and never part of character identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredProfile {
    pub format_version: u32,
    pub text: String,
    pub provenance: Option<ProfileProvenance>,
    pub updated_at: String,
}

/// A library voice as seen by the matcher: real name and optional description.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CatalogVoice {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

/// A preset voice as seen by the matcher, with its resolving tuple and label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PresetCatalogEntry {
    pub backend: String,
    pub model: String,
    pub voice: String,
    pub name: String,
}

/// Frozen catalog snapshot used by casting inputs and stale computation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CatalogSnapshot {
    pub library: Vec<CatalogVoice>,
    pub presets: Vec<PresetCatalogEntry>,
}

impl CatalogSnapshot {
    /// Digest over sorted voice identity keys with name and description, so any
    /// matching-relevant catalog change invalidates frozen suggestions while
    /// catalog enumeration order does not.
    pub(crate) fn digest(&self) -> String {
        let mut library: Vec<_> = self
            .library
            .iter()
            .map(|voice| {
                (
                    voice.id.as_str(),
                    voice.name.as_str(),
                    voice.description.as_deref(),
                )
            })
            .collect();
        let mut presets: Vec<_> = self
            .presets
            .iter()
            .map(|preset| {
                (
                    preset.backend.as_str(),
                    preset.model.as_str(),
                    preset.voice.as_str(),
                    preset.name.as_str(),
                )
            })
            .collect();
        library.sort();
        presets.sort();
        let encoded = serde_json::json!([library, presets]).to_string();
        format!("{:x}", Sha256::digest(encoded.as_bytes()))
    }
}

/// One piece of frozen evidence about a character, sampled from attribution
/// results. `kind` states how the excerpt relates to the character.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CastingEvidence {
    pub kind: String,
    pub excerpt: String,
}

/// A confirmed character frozen for a casting run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CastingCharacterInput {
    pub character_id: String,
    pub display_name: String,
    pub aliases: Vec<String>,
    pub revision: u32,
    pub evidence: Vec<CastingEvidence>,
}

/// A binding as frozen for a casting run, by storage keys.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BindingSnapshot {
    pub target_key: String,
    pub voice_key: String,
}

/// A current profile as frozen for a casting run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProfileSnapshot {
    pub target_key: String,
    pub text: String,
}

/// `casting_inputs.content`: the complete frozen input of one suggestion run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredCastingInput {
    pub format_version: u32,
    pub project_id: String,
    /// User instructions from the triggering message, frozen verbatim within
    /// the documented bound. Runs frozen before this field existed fail to
    /// deserialize honestly instead of silently ignoring the difference.
    pub instructions: String,
    pub characters: Vec<CastingCharacterInput>,
    pub evidence_sources:
        std::collections::BTreeMap<String, Vec<crate::chapter_analysis::FrozenExcerpt>>,
    pub narrator: bool,
    pub bindings: Vec<BindingSnapshot>,
    pub profiles: Vec<ProfileSnapshot>,
    pub catalog: CatalogSnapshot,
    pub character_digest: String,
}

/// Digest over confirmed character ids and revisions, sorted, so any identity or
/// confirmation change invalidates frozen suggestions.
pub(crate) fn character_digest(characters: &[(String, u32)]) -> String {
    let mut rows: Vec<String> = characters
        .iter()
        .map(|(id, revision)| format!("{id}:{revision}"))
        .collect();
    rows.sort();
    let mut hasher = Sha256::new();
    for row in rows {
        hasher.update(row.as_bytes());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

/// A suggested voice with the reason the model gave.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SuggestedVoice {
    pub voice: VoiceRef,
    pub label: String,
    pub reason: String,
}

/// A design draft suggested for a target; the engine hint is advisory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesignDraft {
    pub engine: Option<String>,
    pub prompt: String,
}

/// Per-target suggestion content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TargetSuggestion {
    pub target: BindingTarget,
    pub profile: Option<String>,
    pub voice_candidates: Vec<SuggestedVoice>,
    pub design: Option<DesignDraft>,
}

/// A suggested entry the host rejected, kept for honest reporting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RejectedEntry {
    pub target: Option<BindingTarget>,
    pub voice_key: String,
    pub reason: String,
}

/// `casting_suggestions.content`: the immutable suggestion record of one run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredCastingSuggestion {
    pub format_version: u32,
    pub targets: Vec<TargetSuggestion>,
    pub rejected: Vec<RejectedEntry>,
    pub character_digest: String,
    pub catalog_digest: String,
}

/// Domain validation and persistence errors, named for stable IPC classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BindingError {
    #[error("voice_binding_invalid_target")]
    InvalidTarget,
    #[error("voice_binding_invalid_voice")]
    InvalidVoiceRef,
    #[error("voice_binding_invalid_data")]
    InvalidData,
    #[error("voice_binding_not_found")]
    NotFound,
    #[error("voice_binding_conflict")]
    Conflict,
    #[error("voice_binding_read_failed")]
    ReadFailed,
    #[error("voice_binding_write_failed")]
    WriteFailed,
}

pub(crate) fn validate_binding_target(target: &BindingTarget) -> Result<(), BindingError> {
    match target {
        BindingTarget::Narrator => Ok(()),
        BindingTarget::Character { character_id } => {
            if character_id.len() <= CHARACTER_ID_MAX
                && character_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            {
                Ok(())
            } else {
                Err(BindingError::InvalidTarget)
            }
        }
    }
}

pub(crate) fn validate_voice_ref(voice: &VoiceRef) -> Result<(), BindingError> {
    match voice {
        VoiceRef::Library { id } => {
            if is_portable_id(id) {
                Ok(())
            } else {
                Err(BindingError::InvalidVoiceRef)
            }
        }
        VoiceRef::Preset {
            backend,
            model,
            voice,
        } => {
            if [backend, model, voice]
                .iter()
                .all(|field| is_single_line(field, PRESET_FIELD_MAX))
            {
                Ok(())
            } else {
                Err(BindingError::InvalidVoiceRef)
            }
        }
    }
}

/// Profile text may be empty (clearing); non-empty values are bounded.
pub(crate) fn validate_profile_text(text: &str) -> Result<(), BindingError> {
    if text.chars().count() <= PROFILE_TEXT_MAX {
        Ok(())
    } else {
        Err(BindingError::InvalidData)
    }
}

/// Design prompts must be non-empty and bounded.
pub(crate) fn validate_design_prompt(text: &str) -> Result<(), BindingError> {
    let trimmed = text.trim();
    if !trimmed.is_empty() && trimmed.chars().count() <= PROFILE_TEXT_MAX {
        Ok(())
    } else {
        Err(BindingError::InvalidData)
    }
}

pub(crate) fn validate_suggestion_reason(text: &str) -> Result<(), BindingError> {
    if text.chars().count() <= SUGGESTION_REASON_MAX {
        Ok(())
    } else {
        Err(BindingError::InvalidData)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_columns_and_storage_keys_roundtrip() {
        for target in [
            BindingTarget::Narrator,
            BindingTarget::Character {
                character_id: "abc-123".to_owned(),
            },
        ] {
            let (kind, character_id) = target.columns();
            assert_eq!(
                BindingTarget::from_columns(kind, character_id).as_ref(),
                Some(&target)
            );
            assert_eq!(
                BindingTarget::from_storage_key(&target.storage_key()).as_ref(),
                Some(&target)
            );
        }
        assert!(BindingTarget::from_columns("narrator", "leftover").is_none());
        assert!(BindingTarget::from_columns("character", "").is_none());
        assert!(BindingTarget::from_storage_key("character:").is_none());
        assert!(BindingTarget::from_storage_key("unknown").is_none());
    }

    #[test]
    fn voice_refs_reject_empty_long_and_control_fields() {
        assert!(
            validate_voice_ref(&VoiceRef::Library {
                id: "voice-123_ab".to_owned()
            })
            .is_ok()
        );
        assert!(validate_voice_ref(&VoiceRef::Library { id: String::new() }).is_err());
        assert!(
            validate_voice_ref(&VoiceRef::Library {
                id: "x".repeat(LIBRARY_ID_MAX + 1)
            })
            .is_err()
        );
        assert!(
            validate_voice_ref(&VoiceRef::Library {
                id: "bad id".to_owned()
            })
            .is_err()
        );
        let preset = |voice: &str| VoiceRef::Preset {
            backend: "cpu".to_owned(),
            model: "m".to_owned(),
            voice: voice.to_owned(),
        };
        assert!(validate_voice_ref(&preset("zf_xiaoxiao")).is_ok());
        assert!(validate_voice_ref(&preset("")).is_err());
        assert!(validate_voice_ref(&preset(&"v".repeat(PRESET_FIELD_MAX + 1))).is_err());
        assert!(validate_voice_ref(&preset("two\nlines")).is_err());
    }

    #[test]
    fn binding_targets_reject_malformed_character_ids() {
        assert!(
            validate_binding_target(&BindingTarget::Character {
                character_id: "0f8d2a67-4c1b-4d1b-9f6e-a1f2a3b4c5d6".to_owned()
            })
            .is_ok()
        );
        assert!(
            validate_binding_target(&BindingTarget::Character {
                character_id: "spaces in id".to_owned()
            })
            .is_err()
        );
        assert!(
            validate_binding_target(&BindingTarget::Character {
                character_id: "x".repeat(CHARACTER_ID_MAX + 1)
            })
            .is_err()
        );
        assert!(validate_binding_target(&BindingTarget::Narrator).is_ok());
    }

    #[test]
    fn profile_and_prompt_validation_allow_empty_profile_but_not_empty_prompt() {
        assert!(validate_profile_text("").is_ok());
        assert!(validate_profile_text(&"t".repeat(PROFILE_TEXT_MAX + 1)).is_err());
        assert!(validate_design_prompt("").is_err());
        assert!(validate_design_prompt("  \n ").is_err());
        assert!(validate_design_prompt("沉稳的中年男声").is_ok());
        assert!(validate_suggestion_reason(&"r".repeat(SUGGESTION_REASON_MAX + 1)).is_err());
    }

    #[test]
    fn catalog_digest_tracks_content_not_order() {
        let left = CatalogSnapshot {
            library: vec![
                CatalogVoice {
                    id: "voice-a".to_owned(),
                    name: "A".to_owned(),
                    description: Some("低沉男声".to_owned()),
                },
                CatalogVoice {
                    id: "voice-b".to_owned(),
                    name: "B".to_owned(),
                    description: None,
                },
            ],
            presets: vec![PresetCatalogEntry {
                backend: "cpu".to_owned(),
                model: "kokoro".to_owned(),
                voice: "zf_1".to_owned(),
                name: "晓晓".to_owned(),
            }],
        };
        let mut right = left.clone();
        right.library.reverse();
        assert_eq!(left.digest(), right.digest());
        right.presets[0].name = "改名".to_owned();
        assert_ne!(left.digest(), right.digest());
        right.presets[0].name = left.presets[0].name.clone();
        right.library[0].description = Some("补描述".to_owned());
        assert_ne!(left.digest(), right.digest());
    }

    #[test]
    fn catalog_digest_preserves_metadata_field_boundaries() {
        let left = CatalogSnapshot {
            library: vec![CatalogVoice {
                id: "voice-a".into(),
                name: "a|b".into(),
                description: Some("c".into()),
            }],
            presets: vec![],
        };
        let mut right = left.clone();
        right.library[0].name = "a".into();
        right.library[0].description = Some("b|c".into());
        assert_ne!(left.digest(), right.digest());
    }

    #[test]
    fn preset_identity_and_digest_preserve_tuple_boundaries() {
        let left = VoiceRef::Preset {
            backend: "a/b".into(),
            model: "c".into(),
            voice: "d".into(),
        };
        let right = VoiceRef::Preset {
            backend: "a".into(),
            model: "b/c".into(),
            voice: "d".into(),
        };
        assert!(validate_voice_ref(&left).is_ok());
        assert!(validate_voice_ref(&right).is_ok());
        assert_ne!(left.key(), right.key());
        let first = CatalogSnapshot {
            library: vec![],
            presets: vec![PresetCatalogEntry {
                backend: "a/b".into(),
                model: "c".into(),
                voice: "d".into(),
                name: "Preset".into(),
            }],
        };
        let mut second = first.clone();
        second.presets[0].backend = "a".into();
        second.presets[0].model = "b/c".into();
        assert_ne!(first.digest(), second.digest());
    }

    #[test]
    fn character_digest_tracks_identities_and_revisions() {
        let left = character_digest(&[("a".to_owned(), 1), ("b".to_owned(), 2)]);
        assert_eq!(
            left,
            character_digest(&[("b".to_owned(), 2), ("a".to_owned(), 1)])
        );
        assert_ne!(
            left,
            character_digest(&[("a".to_owned(), 2), ("b".to_owned(), 2)])
        );
        assert_ne!(left, character_digest(&[("a".to_owned(), 1)]));
    }
}
