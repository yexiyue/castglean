//! Serializable host DTOs and source/identity validation; no experiment envelope.
use anyhow::{Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Confirmed identity plus lossless application-owned role context.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(in crate::chapter_analysis) struct CoreCharacter {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::chapter_analysis) struct NewCharacter {
    pub reference: String,
    pub id: String,
    pub name: String,
    pub evidence: Vec<CoreRange>,
}
/// Completed analysis only. No duplicate analyzed source or runtime configuration.
/// Application-provided aliases/overlap context is preserved verbatim and may contain text.
/// Checkpoints are untrusted on reload and must pass `Draft::review`/`restore_analysis`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::chapter_analysis) struct ValidatedAnalysis {
    pub protocol_version: String,
    pub prompt_hash: String,
    pub source_hash: String,
    pub characters: Vec<CoreCharacter>,
    pub new_characters: Vec<NewCharacter>,
    pub character_refs: BTreeMap<String, String>,
    pub aliases: Value,
    pub segments: Vec<CoreSegment>,
    pub revision: u64,
}
#[derive(Clone)]
pub(in crate::chapter_analysis) struct Source {
    pub text: String,
    pub sha256: String,
}
#[derive(Clone)]
pub(in crate::chapter_analysis) struct InputState {
    pub source: Source,
    pub characters: Vec<CoreCharacter>,
    pub aliases: Value,
    pub new_characters: Vec<NewCharacter>,
    pub evaluation_task: String,
    pub review_input: Option<Analysis>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(in crate::chapter_analysis) struct CoreRange {
    pub start: usize,
    pub end: usize,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(in crate::chapter_analysis) struct CoreSegment {
    pub start: usize,
    pub end: usize,
    pub kind: String,
    pub speaker: String,
    pub evidence: Vec<CoreRange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(in crate::chapter_analysis) struct CoreSuggestion {
    pub kind: String,
    pub speaker: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(in crate::chapter_analysis) struct CoreIssue {
    pub start: usize,
    pub end: usize,
    pub category: String,
    pub certainty: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<CoreSuggestion>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(in crate::chapter_analysis) struct Analysis {
    pub segments: Vec<CoreSegment>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(in crate::chapter_analysis) struct CoreReview {
    pub issues: Vec<CoreIssue>,
}

impl InputState {
    pub fn validate(&self) -> Result<()> {
        ensure!(!self.source.text.is_empty(), "source_empty");
        ensure!(
            hash(self.source.text.as_bytes()) == self.source.sha256,
            "source_hash"
        );
        let mut ids = BTreeSet::new();
        for c in &self.characters {
            ensure!(
                !c.id.trim().is_empty()
                    && !["unknown", "narrator", "ambiguous"].contains(&c.id.as_str())
                    && ids.insert(&c.id),
                "character_identity"
            );
            ensure!(!c.name.trim().is_empty(), "character_name");
            ensure!(
                !c.extra.contains_key("id")
                    && !c.extra.contains_key("name")
                    && !c.extra.contains_key("description")
                    && !c.extra.contains_key("canonicalId"),
                "character_context_reserved_key"
            );
        }
        Ok(())
    }
    pub fn range(&self, range: CoreRange) -> bool {
        range.start < range.end && self.source.text.get(range.start..range.end).is_some()
    }

    pub fn validate_segments(&self, segments: &[CoreSegment], range: CoreRange) -> Result<()> {
        let ids: BTreeSet<_> = self.characters.iter().map(|c| c.id.as_str()).collect();
        let mut cursor = range.start;
        for s in segments {
            ensure!(
                s.start == cursor
                    && s.end <= range.end
                    && self.range(CoreRange {
                        start: s.start,
                        end: s.end
                    }),
                "coverage_or_utf8"
            );
            ensure!(
                ["narration", "speech", "thought"].contains(&s.kind.as_str()),
                "kind"
            );
            match s.speaker.as_str() {
                "narrator" => ensure!(
                    s.kind == "narration" && s.candidates.is_empty(),
                    "kind_identity"
                ),
                "unknown" if !s.candidates.is_empty() => {
                    let candidates: BTreeSet<_> = s.candidates.iter().collect();
                    ensure!(
                        candidates.len() >= 2
                            && candidates.len() == s.candidates.len()
                            && candidates.iter().all(|c| ids.contains(c.as_str())),
                        "ambiguous_candidates"
                    );
                }
                "unknown" => {}
                id => ensure!(ids.contains(id) && s.candidates.is_empty(), "identity"),
            }
            ensure!(
                !s.evidence.is_empty() && s.evidence.iter().all(|r| self.range(*r)),
                "evidence"
            );
            ensure!(
                s.kind != "narration" || s.speaker == "narrator",
                "narration_identity"
            );
            cursor = s.end;
        }
        ensure!(cursor == range.end, "coverage");
        Ok(())
    }

    pub fn validate_review(&self, review: &CoreReview, segments: &[CoreSegment]) -> Result<()> {
        let mut seen = BTreeSet::new();
        for issue in &review.issues {
            ensure!(
                segments
                    .iter()
                    .any(|s| s.start == issue.start && s.end == issue.end),
                "review_reference"
            );
            ensure!(
                ["kind", "speaker", "evidence"].contains(&issue.category.as_str())
                    && ["definite", "uncertain"].contains(&issue.certainty.as_str()),
                "review_shape"
            );
            if let Some(suggestion) = &issue.suggestion {
                let segment = CoreSegment {
                    start: issue.start,
                    end: issue.end,
                    kind: suggestion.kind.clone(),
                    speaker: suggestion.speaker.clone(),
                    evidence: vec![CoreRange {
                        start: issue.start,
                        end: issue.end,
                    }],
                    candidates: suggestion.candidates.clone(),
                };
                self.validate_segments(
                    &[segment],
                    CoreRange {
                        start: issue.start,
                        end: issue.end,
                    },
                )?;
            }
            if !seen.insert((issue.start, issue.end, &issue.category)) {
                bail!("review_duplicate");
            }
        }
        Ok(())
    }
}

/// Stable opaque candidate namespace, independent of display names.
pub(super) fn candidate_id(source_hash: &str, reference: &str) -> String {
    let digest = Sha256::digest(format!("{source_hash}:{reference}").as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    // RFC 9562 version 8, RFC variant: application-defined deterministic UUID.
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!("candidate:{}", uuid::Uuid::from_bytes(bytes))
}
