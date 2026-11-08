//! Persistable message parts; tool execution facts have one authoritative representation.
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Clone, PartialEq, Serialize, Deserialize, sea_orm::FromJsonQueryResult, specta::Type,
)]
#[serde(try_from = "PartsDocument")]
pub(crate) struct MessageParts {
    version: u32,
    parts: Vec<MessagePart>,
}

#[derive(Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
struct PartsDocument {
    version: u32,
    parts: Vec<MessagePart>,
}

impl TryFrom<PartsDocument> for MessageParts {
    type Error = String;

    fn try_from(document: PartsDocument) -> Result<Self, Self::Error> {
        if document.version != 1 {
            return Err("unsupported or oversized message parts".into());
        }
        if serde_json::to_vec(&document.parts)
            .map_err(|_| "invalid message parts")?
            .len()
            > 16 * 1024 * 1024
        {
            return Err("oversized message parts".into());
        }
        let mut calls = std::collections::HashSet::new();
        for part in &document.parts {
            if let MessagePart::Result { reference } = part
                && (reference.kind.is_empty()
                    || reference.kind.len() > 128
                    || reference.id.is_empty()
                    || reference.id.len() > 256
                    || reference.summary.len() > 4096)
            {
                return Err("invalid business result reference".into());
            }
            if let MessagePart::Tool {
                id,
                name,
                state,
                output,
                result,
                ..
            } = part
            {
                if id.is_empty()
                    || id.len() > 256
                    || name.is_empty()
                    || name.len() > 128
                    || !calls.insert(id)
                {
                    return Err("invalid or duplicate tool call identity".into());
                }
                if matches!(state, ToolState::Completed) && output.is_none() {
                    return Err("completed tool is missing its result".into());
                }
                if !matches!(state, ToolState::Completed) && result.is_some() {
                    return Err("unfinished tool cannot publish a business result".into());
                }
                if matches!(state, ToolState::Running) && output.is_some() {
                    return Err("running tool cannot have a completed output".into());
                }
                if result.as_ref().is_some_and(|r| {
                    r.kind.is_empty()
                        || r.kind.len() > 128
                        || r.id.is_empty()
                        || r.id.len() > 256
                        || r.summary.len() > 4096
                }) {
                    return Err("invalid business result reference".into());
                }
            }
        }
        Ok(Self {
            version: document.version,
            parts: document.parts,
        })
    }
}

impl MessageParts {
    pub(crate) fn new(parts: Vec<MessagePart>) -> Result<Self, String> {
        PartsDocument { version: 1, parts }.try_into()
    }

    pub(crate) fn parts(&self) -> &[MessagePart] {
        &self.parts
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn invalid_tool_lifecycle_is_rejected() {
        let part = json!({"type":"tool", "id":"call", "name":"test_rules", "input":{}, "state":"completed", "output":null, "result":null});
        assert!(
            serde_json::from_value::<MessageParts>(json!({"version":1, "parts":[part]})).is_err()
        );
        assert!(serde_json::from_value::<MessageParts>(json!({"version":2, "parts":[]})).is_err());
    }

    #[test]
    fn tool_result_is_stored_once_with_typed_reference() {
        let value = json!({"version":1, "parts":[{"type":"text","text":"已生成方案"}, {"type":"tool","id":"call", "name":"test_rules", "input":{}, "state":"completed", "output":{"count":2}, "result":{"kind":"chapter_split_proposal", "id":"p", "summary":"两章"}}]});
        let parts: MessageParts = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parts).unwrap(), value);
    }

    #[test]
    fn duplicate_tool_facts_and_running_results_are_rejected() {
        let part = json!({"type":"tool", "id":"call", "name":"directory", "input":{}, "state":"running", "output":null, "result":null});
        assert!(
            serde_json::from_value::<MessageParts>(
                json!({"version":1, "parts":[part.clone(), part.clone()]})
            )
            .is_err()
        );
        let mut part = part;
        part["output"] = json!({"count":2});
        assert!(
            serde_json::from_value::<MessageParts>(json!({"version":1, "parts":[part]})).is_err()
        );
    }

    #[test]
    fn unknown_result_kind_preserves_a_bounded_summary() {
        let value = json!({"version":1, "parts":[{"type":"tool", "id":"call", "name":"future_tool", "input":{}, "state":"completed", "output":{}, "result":{"kind":"future_result", "id":"p", "summary":"供人工审阅的摘要"}}]});
        let parts: MessageParts = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parts).unwrap(), value);
        let mut invalid = value;
        invalid["parts"][0]["result"]["id"] = json!("");
        assert!(serde_json::from_value::<MessageParts>(invalid).is_err());
    }

    #[test]
    fn message_size_is_bounded_before_persistence() {
        let value =
            json!({"version":1, "parts":[{"type":"text", "text":"x".repeat(16*1024*1024)}]});
        assert!(serde_json::from_value::<MessageParts>(value).is_err());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum MessagePart {
    Text {
        text: String,
    },
    Result {
        reference: ResultReference,
    },
    Tool {
        id: String,
        name: String,
        // Tool JSON has no frontend schema. It must remain untrusted and must
        // never enable a global i64/u64 -> JavaScript number conversion.
        #[specta(type = specta_typescript::Unknown)]
        input: serde_json::Value,
        state: ToolState,
        #[specta(type = Option<specta_typescript::Unknown>)]
        output: Option<serde_json::Value>,
        result: Option<ResultReference>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ToolState {
    Running,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResultReference {
    pub kind: String,
    pub id: String,
    pub summary: String,
}
