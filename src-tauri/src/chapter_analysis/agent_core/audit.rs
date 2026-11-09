//! Redacted host observations. Tool arguments, names from source, and source bodies are excluded.
use super::*;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::chapter_analysis) struct Audit {
    conflict_count: Option<u64>,
    conflicts: Option<Vec<ConflictSummary>>,
    pub(super) tool: &'static str,
    pub(super) status: Status,
    error: Option<Code>,
    revision_before: u64,
    revision_after: u64,
    missing_count: Option<u64>,
    elapsed_ms: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictSummary {
    segment_indices: Vec<usize>,
    piece_count: Option<u64>,
}
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Status {
    Completed,
    Rejected,
}
impl Audit {
    pub(super) fn observe(
        tool: &str,
        value: &Value,
        revision_before: u64,
        revision_after: u64,
        elapsed_ms: f64,
    ) -> Self {
        Self {
            tool: match tool {
                "read_source" => "read_source",
                "patch_annotations" => "patch_annotations",
                "finish_analysis" => "finish_analysis",
                _ => "unknown_tool",
            },
            status: if value["ok"] == true {
                Status::Completed
            } else {
                Status::Rejected
            },
            error: value
                .get("error")
                .cloned()
                .and_then(|v| serde_json::from_value(v).ok()),
            conflict_count: value["conflictCount"].as_u64(),
            conflicts: value["conflicts"].as_array().map(|groups| {
                groups
                    .iter()
                    .map(|group| ConflictSummary {
                        segment_indices: group["segmentIndices"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_u64)
                            .filter_map(|n| usize::try_from(n).ok())
                            .collect(),
                        piece_count: group["pieceCount"].as_u64(),
                    })
                    .collect()
            }),
            missing_count: value["missingCount"].as_u64(),
            revision_before,
            revision_after,
            elapsed_ms,
        }
    }
}
