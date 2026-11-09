//! Typed JSON persistence boundary for one C7 window. No source bodies or in-flight drafts.
use super::{
    agent_core::{CoreReview, ValidatedAnalysis},
    agent_runtime::Trace,
    types::{Character, Segment},
    windows::WindowIdentity,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(super) const WINDOW_VERSION: u32 = 6;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Generation {
    pub model: crate::llm::LlmModel,
    pub completion_options: rig_core::completion::GenerationOptions,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Identity {
    pub plan: WindowIdentity,
    pub implementation_hash: String,
    pub context_hash: String,
    pub configuration_hash: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct WindowReview {
    pub source_offset: u32,
    pub result: CoreReview,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Checkpoint {
    pub identity: Identity,
    pub analysis: Option<ValidatedAnalysis>,
    pub local: BTreeMap<String, Character>,
    pub segments: Vec<Segment>,
    pub review: Option<WindowReview>,
    pub generation: Option<Generation>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, sea_orm::FromJsonQueryResult)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WindowRecord {
    pub(super) format_version: u32,
    pub(super) plan: WindowIdentity,
    pub(super) checkpoint: Option<Checkpoint>,
    pub(super) traces: BTreeMap<String, Trace>,
}
impl WindowRecord {
    pub(super) fn planned(plan: WindowIdentity) -> Self {
        Self {
            format_version: WINDOW_VERSION,
            plan,
            checkpoint: None,
            traces: BTreeMap::new(),
        }
    }
    pub(super) fn validate(&self) -> bool {
        self.format_version == WINDOW_VERSION
            && self.checkpoint.as_ref().is_none_or(|c| {
                c.identity.plan == self.plan
                    && c.review.as_ref().is_none_or(|r| {
                        c.analysis.is_some() && r.source_offset == self.plan.owned.start
                    })
            })
            && self.traces.iter().all(|(id, trace)| id == &trace.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> WindowIdentity {
        WindowIdentity {
            id: "c7w0".into(),
            owned: super::super::types::ByteRange { start: 0, end: 3 },
            context: super::super::types::ByteRange { start: 0, end: 3 },
            anchor_hash: "hash".into(),
        }
    }
    #[test]
    fn json_boundary_rejects_old_and_unstructured_windows() {
        let record = WindowRecord::planned(plan());
        let mut document = serde_json::to_value(&record).unwrap();
        document["analysis"] = serde_json::json!({});
        assert!(serde_json::from_value::<WindowRecord>(document).is_err());
        let mut old = record;
        old.format_version = 5;
        assert!(!old.validate());
    }
    #[test]
    fn review_cannot_exist_without_its_analysis_or_point_to_another_window() {
        let mut record = WindowRecord::planned(plan());
        record.checkpoint = Some(Checkpoint {
            identity: Identity {
                plan: plan(),
                implementation_hash: "impl".into(),
                context_hash: "roles".into(),
                configuration_hash: "config".into(),
            },
            analysis: None,
            local: BTreeMap::new(),
            segments: vec![],
            review: Some(WindowReview {
                source_offset: 0,
                result: CoreReview { issues: vec![] },
            }),
            generation: None,
        });
        assert!(!record.validate());
        let checkpoint = record.checkpoint.as_mut().unwrap();
        checkpoint.review = None;
        checkpoint.identity.plan.id = "another".into();
        assert!(!record.validate());
    }
}
