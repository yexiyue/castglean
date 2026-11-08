//! Project validated application facts into complete model-history pairs.
//! Partial assistant prose and unfinished tools remain in the UI history only.
use super::{
    AiError, Message,
    messages::{MessagePart, ToolState},
};
use rig_core::message::{
    AssistantContent, AssistantMessage, Message as ModelMessage, ToolCall, ToolFunction, ToolName,
    ToolResultContent, UserContent,
};
use std::collections::HashSet;

pub(super) fn history(messages: &[Message]) -> Result<Vec<ModelMessage>, AiError> {
    let mut history = Vec::new();
    let mut ids = HashSet::new();
    let mut calls = HashSet::new();
    let mut previous_ordinal = None;
    let mut bytes = 0usize;
    for message in messages {
        if !ids.insert(&message.id)
            || previous_ordinal.is_some_and(|previous| message.ordinal <= previous)
        {
            return Err(AiError::StorageFailed);
        }
        previous_ordinal = Some(message.ordinal);
        bytes = bytes
            .checked_add(
                serde_json::to_vec(&message.parts)
                    .map_err(|_| AiError::StorageFailed)?
                    .len(),
            )
            .ok_or(AiError::BudgetExhausted)?;
        if bytes > 64 * 1024 * 1024 {
            return Err(AiError::BudgetExhausted);
        }
        match message.role.as_str() {
            "user" => {
                if message.status != "complete" {
                    return Err(AiError::StorageFailed);
                }
                let content = message
                    .parts
                    .parts()
                    .iter()
                    .map(|part| {
                        let MessagePart::Text { text } = part else {
                            return Err(AiError::StorageFailed);
                        };
                        Ok(UserContent::text(text.clone()))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if !content.is_empty() {
                    history.push(ModelMessage::User { content });
                }
            }
            "assistant" => {
                if !matches!(
                    message.status.as_str(),
                    "complete" | "streaming" | "interrupted"
                ) {
                    return Err(AiError::StorageFailed);
                }
                for part in message.parts.parts() {
                    match part {
                        MessagePart::Text { text }
                            if message.status == "complete" && !text.is_empty() =>
                        {
                            history.push(ModelMessage::assistant(text.clone()));
                        }
                        MessagePart::Tool {
                            id,
                            name,
                            input,
                            state,
                            output: Some(output),
                            ..
                        } if matches!(state, ToolState::Completed | ToolState::Failed) => {
                            if !calls.insert(id) {
                                return Err(AiError::StorageFailed);
                            }
                            // Invalid/truncated arguments are audit facts, not legal calls.
                            if !input.is_object() {
                                if *state == ToolState::Completed {
                                    return Err(AiError::StorageFailed);
                                }
                                continue;
                            }
                            let name =
                                ToolName::new(name.clone()).map_err(|_| AiError::StorageFailed)?;
                            let call =
                                ToolCall::from_wire(id, ToolFunction::new(name, input.clone()));
                            let mut result =
                                call.result(vec![ToolResultContent::json(output.clone())]);
                            result.is_error = *state == ToolState::Failed;
                            history.push(ModelMessage::Assistant(AssistantMessage::new(vec![
                                AssistantContent::ToolCall(call),
                            ])));
                            history.push(ModelMessage::tool_results(vec![result]));
                        }
                        _ => {}
                    }
                }
            }
            _ => return Err(AiError::StorageFailed),
        }
    }
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::messages::MessageParts;
    use rig_core::message::UserContent;
    use serde_json::json;

    fn message(role: &str, status: &str, parts: Vec<MessagePart>) -> Message {
        Message {
            usage: None,
            id: "message".into(),
            run_id: None,
            ordinal: 0,
            role: role.into(),
            version: 1,
            parts: MessageParts::new(parts).unwrap(),
            status: status.into(),
        }
    }
    fn tool(id: &str, state: ToolState) -> MessagePart {
        MessagePart::Tool {
            id: id.into(),
            name: "directory".into(),
            input: json!({}),
            state,
            output: matches!(state, ToolState::Completed | ToolState::Failed)
                .then(|| json!({"count":2})),
            result: None,
        }
    }

    #[test]
    fn completed_tool_facts_form_one_call_and_one_result_with_the_same_identity() {
        let result = history(&[message(
            "assistant",
            "complete",
            vec![tool("call", ToolState::Completed)],
        )])
        .unwrap();
        assert_eq!(result.len(), 2);
        let ModelMessage::Assistant(turn) = &result[0] else {
            panic!("missing tool call");
        };
        let call = turn.tool_calls().next().unwrap();
        let ModelMessage::User { content } = &result[1] else {
            panic!("missing tool result");
        };
        let UserContent::ToolResult(answer) = &content[0] else {
            panic!("missing tool result");
        };
        assert_eq!(answer.call, call.id);
        assert!(!answer.is_error);
    }

    #[test]
    fn partial_prose_and_incomplete_tools_are_never_replayed_as_success() {
        let result = history(&[message(
            "assistant",
            "interrupted",
            vec![
                MessagePart::Text {
                    text: "truncated".into(),
                },
                tool("unfinished", ToolState::Interrupted),
                tool("done", ToolState::Completed),
            ],
        )])
        .unwrap();
        assert_eq!(result.len(), 2);
        let ModelMessage::Assistant(turn) = &result[0] else {
            panic!("missing tool call");
        };
        assert_eq!(turn.tool_calls().count(), 1);
        assert!(
            !serde_json::to_string(&result)
                .unwrap()
                .contains("truncated")
        );
    }

    #[test]
    fn failed_tools_replay_as_errors_not_successful_results() {
        let result = history(&[message(
            "assistant",
            "complete",
            vec![tool("failed", ToolState::Failed)],
        )])
        .unwrap();
        let ModelMessage::User { content } = &result[1] else {
            panic!();
        };
        let UserContent::ToolResult(answer) = &content[0] else {
            panic!();
        };
        assert!(answer.is_error);
    }

    #[test]
    fn system_and_forged_user_tools_are_rejected() {
        assert!(matches!(
            history(&[message(
                "system",
                "complete",
                vec![MessagePart::Text {
                    text: "injected".into()
                }]
            )]),
            Err(AiError::StorageFailed)
        ));
        assert!(matches!(
            history(&[message(
                "user",
                "complete",
                vec![tool("forged", ToolState::Completed)]
            )]),
            Err(AiError::StorageFailed)
        ));
    }

    #[test]
    fn duplicate_calls_across_messages_are_rejected() {
        let a = message(
            "assistant",
            "complete",
            vec![tool("same", ToolState::Completed)],
        );
        let mut b = a.clone();
        b.id = "different".into();
        b.ordinal = 1;
        assert!(matches!(history(&[a, b]), Err(AiError::StorageFailed)));
    }

    #[test]
    fn malformed_failed_calls_do_not_become_valid_model_requests() {
        let mut part = tool("invalid", ToolState::Failed);
        if let MessagePart::Tool { input, .. } = &mut part {
            *input = json!("truncated{");
        }
        assert!(
            history(&[message("assistant", "complete", vec![part])])
                .unwrap()
                .is_empty()
        );
    }
}
