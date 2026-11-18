//! Typed JSON persistence boundary for one chapter attribution window. No source bodies or in-flight drafts.
use super::{
    agent_core::{CoreReview, ValidatedAnalysis},
    windows::WindowIdentity,
};
use serde::{Deserialize, Serialize};

// Bump for changes to persisted analysis semantics. See docs/engineering.md.
pub(super) const WINDOW_VERSION: u32 = 7;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Generation {
    pub model: crate::llm::LlmModel,
    pub completion_options: rig_core::completion::GenerationOptions,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct WindowReview {
    pub source_offset: u32,
    pub result: CoreReview,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Outcome {
    pub analysis: ValidatedAnalysis,
    pub review: WindowReview,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, sea_orm::FromJsonQueryResult)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WindowRecord {
    pub(super) format_version: u32,
    pub(super) plan: WindowIdentity,
    pub(super) context_hash: String,
    pub(super) configuration_hash: String,
    pub(super) outcome: Option<Outcome>,
}
impl WindowRecord {
    pub(super) fn planned(
        plan: WindowIdentity,
        context_hash: String,
        configuration_hash: String,
    ) -> Self {
        Self {
            format_version: WINDOW_VERSION,
            plan,
            context_hash,
            configuration_hash,
            outcome: None,
        }
    }

    pub(super) fn validate(&self) -> bool {
        self.format_version == WINDOW_VERSION
            && self
                .outcome
                .as_ref()
                .is_none_or(|outcome| outcome.review.source_offset == self.plan.owned.start)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> WindowIdentity {
        WindowIdentity {
            id: "attribution-window-0".into(),
            owned: super::super::types::ByteRange { start: 0, end: 3 },
            context: super::super::types::ByteRange { start: 0, end: 3 },
            anchor_hash: "hash".into(),
        }
    }
    #[test]
    fn json_boundary_rejects_old_and_unstructured_windows() {
        let record = WindowRecord::planned(plan(), "context".into(), "config".into());
        let mut document = serde_json::to_value(&record).unwrap();
        document["analysis"] = serde_json::json!({});
        assert!(serde_json::from_value::<WindowRecord>(document).is_err());
        let mut old = record;
        old.format_version = 6;
        assert!(!old.validate());
    }
    #[test]
    fn v6_window_is_rejected_at_json_boundary() {
        let value =
            serde_json::json!({"formatVersion":6,"plan":plan(),"checkpoint":null,"traces":{}});
        assert!(serde_json::from_value::<WindowRecord>(value).is_err());
    }
}
