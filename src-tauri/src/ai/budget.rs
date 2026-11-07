//! Persisted counters. A new attempt carries the session total but gets a fresh turn allowance.
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
        if self.version != 1
            || self.turn_requests > 8
            || self.total.requests > 64
            || self.total.input_bytes > 512 * 1024
            || self.total.tool_calls > 24
            || self.total.tool_bytes > 64 * 1024
            || self
                .request_input_bytes
                .is_some_and(|bytes| bytes > 128 * 1024)
        {
            return Err(AiError::StorageFailed);
        }
        Ok(self.total.clone())
    }

    pub(crate) fn charge(&mut self, charge: Charge) -> Result<Budget, AiError> {
        self.total()?;
        let mut next = self.clone();
        match charge {
            Charge::Request { input_bytes } => {
                if input_bytes > 128 * 1024 || next.turn_requests >= 8 || next.total.requests >= 64
                {
                    return Err(AiError::BudgetExhausted);
                }
                next.total.requests += 1;
                next.turn_requests += 1;
                next.total.input_bytes = next
                    .total
                    .input_bytes
                    .checked_add(input_bytes)
                    .ok_or(AiError::BudgetExhausted)?;
                next.request_input_bytes = Some(input_bytes);
            }
            Charge::Wire { input_bytes } => {
                if input_bytes > 128 * 1024 {
                    return Err(AiError::BudgetExhausted);
                }
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
                if bytes > 8192 {
                    return Err(AiError::BudgetExhausted);
                }
                next.total.tool_bytes = next
                    .total
                    .tool_bytes
                    .checked_add(bytes)
                    .ok_or(AiError::BudgetExhausted)?;
            }
        }
        if next.total.input_bytes > 512 * 1024
            || next.total.tool_calls > 24
            || next.total.tool_bytes > 64 * 1024
        {
            return Err(AiError::BudgetExhausted);
        }
        *self = next;
        self.total()
    }
}
