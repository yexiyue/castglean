//! Typed wire contract for isolated task-efficiency evaluation.
use super::{Profile, Snapshot};
use crate::{ai, llm, project};
use rig_core::completion::GenerationOptions;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CaseInput {
    pub case_id: String,
    pub text: String,
    pub source_hash: String,
    pub request: String,
    #[serde(default)]
    pub corrections: Vec<project::Correction>,
}
impl CaseInput {
    pub fn input_hash(&self) -> String {
        project::hash(
            &serde_json::to_vec(&(&self.text, &self.request, &self.corrections))
                .expect("serializable evaluation input"),
        )
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Job {
    pub config_path: PathBuf,
    pub selection: llm::ModelSelection,
    pub profile: Profile,
    #[serde(flatten)]
    pub input: CaseInput,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModelContext {
    pub model: llm::LlmModel,
    pub revision: u32,
    pub completion_options: GenerationOptions,
    pub model_id: String,
    pub reasoning: String,
    pub configuration_snapshot_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetupFailure {
    pub ok: bool,
    pub error: llm::LlmError,
    pub requests_unknown: bool,
    pub profile: Profile,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolAudit {
    pub name: String,
    pub state: ai::messages::ToolState,
    pub input_hash: String,
    pub result: Option<ai::messages::ResultReference>,
    pub error: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EvaluationResult {
    pub format_version: u32,
    pub case_id: String,
    pub profile: Profile,
    pub ok: bool,
    pub error: Option<ai::RunFailure>,
    pub distinct_rule_trials: usize,
    pub implementation_hash: String,
    pub input_hash: String,
    pub configuration: ModelContext,
    pub elapsed_ms: u64,
    pub meter: Snapshot,
    pub tools: Vec<ToolAudit>,
    pub headings: Option<Vec<u32>>,
    pub candidate_count: u64,
    pub unchanged: bool,
    pub pending: bool,
    pub coverage: bool,
    pub assistant_messages: usize,
    pub complete: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn input_hash_canonicalizes_corrections_and_preserves_unicode_constraints() {
        let input: CaseInput = serde_json::from_value(json!({
            "caseId": "unicode", "text": "第一章 开始\n🙂\n第二章 后续\n正文",
            "sourceHash": "not-used-in-input-hash", "request": "检查",
            "corrections": [{"title":"人工🙂", "include":true, "line":1, "sourceId":"source"}]
        }))
        .unwrap();
        assert_eq!(
            input.input_hash(),
            "89ddba995880d3de28b63a2ac545ee275b37fffc51cdb261203b1279c34e7e98"
        );
        let changed = CaseInput {
            request: "检查但不要改人工修正".into(),
            ..input
        };
        assert_ne!(
            changed.input_hash(),
            "89ddba995880d3de28b63a2ac545ee275b37fffc51cdb261203b1279c34e7e98"
        );
    }
}
