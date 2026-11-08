//! Persisted observational counters. Attempts retain totals without product quotas.
use super::{AiError, Budget};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Ledger {
    version: u32,
    total: Budget,
    turn_requests: u32,
    request_input_bytes: Option<u32>,
}

pub(crate) enum Charge {
    Request { input_bytes: u32 },
    Wire { input_bytes: u32 },
    ToolAttempt,
    ToolOutput { bytes: u32 },
}

impl Ledger {
    pub(crate) fn new(total: Budget) -> Self {
        Self {
            version: 1,
            total,
            turn_requests: 0,
            request_input_bytes: None,
        }
    }

    pub(crate) fn total(&self) -> Result<Budget, AiError> {
        if self.version != 1 {
            return Err(AiError::StorageFailed);
        }
        Ok(self.total.clone())
    }

    pub(crate) fn charge(&mut self, charge: Charge) -> Result<Budget, AiError> {
        self.total()?;
        let mut next = self.clone();
        match charge {
            Charge::Request { input_bytes } => {
                next.total.requests = next
                    .total
                    .requests
                    .checked_add(1)
                    .ok_or(AiError::BudgetExhausted)?;
                next.turn_requests = next
                    .turn_requests
                    .checked_add(1)
                    .ok_or(AiError::BudgetExhausted)?;
                next.total.input_bytes = next
                    .total
                    .input_bytes
                    .checked_add(input_bytes)
                    .ok_or(AiError::BudgetExhausted)?;
                next.request_input_bytes = Some(input_bytes);
            }
            Charge::Wire { input_bytes } => {
                let reserved = next.request_input_bytes.ok_or(AiError::Conflict)?;
                next.total.input_bytes = next
                    .total
                    .input_bytes
                    .checked_sub(reserved)
                    .ok_or(AiError::StorageFailed)?
                    .checked_add(input_bytes)
                    .ok_or(AiError::BudgetExhausted)?;
                next.request_input_bytes = Some(input_bytes);
            }
            Charge::ToolAttempt => {
                next.total.tool_calls = next
                    .total
                    .tool_calls
                    .checked_add(1)
                    .ok_or(AiError::BudgetExhausted)?;
            }
            Charge::ToolOutput { bytes } => {
                next.total.tool_bytes = next
                    .total
                    .tool_bytes
                    .checked_add(bytes)
                    .ok_or(AiError::BudgetExhausted)?;
            }
        }
        *self = next;
        self.total()
    }
}
