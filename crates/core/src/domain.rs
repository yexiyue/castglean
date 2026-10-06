//! Editable draft DTOs. Parsing these types does not validate a book.

use crate::{Error, SourceMetadata};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt};

/// Draft document version; not yet a frozen external protocol.
pub const FORMAT_VERSION: u32 = 1;

/// Explicit application-specific JSON fields, outside the core contract.
pub type Extensions = BTreeMap<String, serde_json::Value>;

macro_rules! identifier {
    ($name:ident, $description:literal) => {
        #[doc = $description]
        #[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, JsonSchema)]
        #[serde(transparent)]
        pub struct $name(#[schemars(length(min = 1), pattern(r"\S"))] String);

        impl $name {
            /// Construct an opaque ID, rejecting empty or whitespace-only values.
            pub fn new(value: impl Into<String>) -> Result<Self, Error> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(Error::invalid(stringify!($name), "ID must not be blank"));
                }
                Ok(Self(value))
            }
            /// Exact ID text; IDs are never interpreted as paths or indices.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
            }
        }
    };
}

identifier!(BookId, "Opaque book identity, separate from a title.");
identifier!(
    ChapterId,
    "Opaque chapter identity, separate from ordering."
);
identifier!(
    CharacterId,
    "Stable character identity, separate from names and voices."
);
identifier!(
    SegmentId,
    "Opaque segment identity within one source version."
);

/// Human review, independent of whether attribution is resolved.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewStatus {
    /// Not yet confirmed by a human.
    Unreviewed,
    /// Confirmed by a human; future model workflows must protect corrections.
    Confirmed,
}

/// Reference to a segment in an explicitly supplied chapter.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRef {
    /// Chapter containing the evidence.
    pub chapter_id: ChapterId,
    /// Evidence segment within that chapter.
    pub segment_id: SegmentId,
}

/// Optional draft semantic voice description; contains no backend voice IDs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VoiceProfile {
    /// Evidence-grounded description, absent or `unknown` if unspecified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    /// Evidence-grounded age description, absent or `unknown` if unspecified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_band: Option<String>,
    /// Free-text semantic impressions, not synthesis parameters.
    #[serde(default)]
    pub impressions: Vec<String>,
    /// Evidence supporting non-unknown profile claims.
    #[serde(default)]
    pub evidence: Vec<EvidenceRef>,
}

/// An editable draft character record, untrusted until book validation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Character {
    /// Stable identity.
    pub id: CharacterId,
    /// Current display name; need not be unique.
    pub display_name: String,
    /// Other names; the same alias can refer to multiple identities.
    pub aliases: Vec<String>,
    /// Human confirmation state.
    pub review_status: ReviewStatus,
    /// Evidence of this character in supplied chapters.
    pub evidence: Vec<EvidenceRef>,
    /// Optional semantic description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_profile: Option<VoiceProfile>,
    /// Application-specific additions.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: Extensions,
}

/// Editable versioned character registry for one book.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CharacterRegistry {
    /// Only draft format 1 is supported.
    #[schemars(range(min = 1, max = 1))]
    pub format_version: u32,
    /// Identity shared by all chapters.
    pub book_id: BookId,
    /// Positive character revision referenced by annotations.
    #[schemars(range(min = 1))]
    pub revision: u64,
    /// Characters with unique IDs, but potentially shared names.
    pub characters: Vec<Character>,
    /// Application-specific additions.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: Extensions,
}

/// Expression function, independent from character identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExpressionKind {
    /// Narrative text, possibly spoken by a known first-person narrator.
    Narration,
    /// Spoken dialogue.
    Speech,
    /// Internal thought.
    Thought,
    /// Quoted text that need not be character dialogue.
    QuotedText,
}

/// Draft attribution payload; states cannot mix resolved and unknown fields.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Attribution {
    /// One identified character.
    Resolved {
        /// Existing character identity.
        character_id: CharacterId,
        /// Evidence IDs in the same chapter.
        evidence_segment_ids: Vec<SegmentId>,
        /// Human confirmation, separate from resolution.
        review_status: ReviewStatus,
    },
    /// At least two distinct possible characters.
    Ambiguous {
        /// Existing candidate identities.
        #[schemars(length(min = 2))]
        candidate_ids: Vec<CharacterId>,
        /// Evidence IDs in the same chapter.
        evidence_segment_ids: Vec<SegmentId>,
        /// Human confirmation, separate from resolution.
        review_status: ReviewStatus,
    },
    /// No identified speaker; this is not automatically narration.
    Unknown {
        /// Optional supporting evidence IDs in the same chapter.
        evidence_segment_ids: Vec<SegmentId>,
        /// Human confirmation of the unknown status.
        review_status: ReviewStatus,
    },
}

impl Attribution {
    pub(crate) fn evidence(&self) -> &[SegmentId] {
        match self {
            Self::Resolved {
                evidence_segment_ids,
                ..
            }
            | Self::Ambiguous {
                evidence_segment_ids,
                ..
            }
            | Self::Unknown {
                evidence_segment_ids,
                ..
            } => evidence_segment_ids,
        }
    }
}

/// An editable source partition segment, not yet a checked byte range.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Segment {
    /// Unique chapter-local segment identity.
    pub id: SegmentId,
    /// Inclusive starting byte offset.
    pub start: usize,
    /// Exclusive ending byte offset.
    pub end: usize,
    /// Expression function.
    pub kind: ExpressionKind,
    /// Required for speech and thought; optional for other kinds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
    /// Application-specific additions.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: Extensions,
}

/// Editable draft annotations bound to one normalized source version.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ChapterAnnotations {
    /// Only draft format 1 is supported.
    #[schemars(range(min = 1, max = 1))]
    pub format_version: u32,
    /// Owning book identity.
    pub book_id: BookId,
    /// Chapter identity.
    pub chapter_id: ChapterId,
    /// Registry revision used by this annotation.
    #[schemars(range(min = 1))]
    pub character_revision: u64,
    /// Digest and coordinate convention for saved text.
    pub source: SourceMetadata,
    /// Ordered, complete source partition.
    pub segments: Vec<Segment>,
    /// Application-specific additions.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: Extensions,
}
