//! Pure budget rules, shared by lifecycle hooks and the serialized-wire transport boundary.
use super::{DiagnosticRecord, ModelCallRecord, ModelCallStatus};
use crate::project::ProjectError;

pub(super) fn reserve_request(d: &mut DiagnosticRecord, bytes: usize) -> Result<(), ProjectError> {
    if bytes > 128 * 1024
        || d.requests >= 64
        || d.turn_requests >= 8
        || d.input_bytes as usize + bytes > 512 * 1024
    {
        return Err(ProjectError::TooLarge);
    }
    d.requests += 1;
    d.turn_requests += 1;
    d.input_bytes += bytes as u32;
    d.in_flight = true;
    d.calls.push(ModelCallRecord {
        id: uuid::Uuid::new_v4().to_string(),
        run_id: d.run_id.clone(),
        selection: d.selection.clone(),
        configuration_revision: d.configuration_revision,
        input_bytes: bytes as u32,
        status: ModelCallStatus::Started,
        input_tokens: None,
        output_tokens: None,
    });
    Ok(())
}
pub(super) fn account_wire(d: &mut DiagnosticRecord, bytes: usize) -> Result<(), ProjectError> {
    let call = d.calls.last_mut().ok_or(ProjectError::Conflict)?;
    let total = (d.input_bytes as usize)
        .checked_sub(call.input_bytes as usize)
        .ok_or(ProjectError::Conflict)?
        .checked_add(bytes)
        .ok_or(ProjectError::TooLarge)?;
    if bytes > 128 * 1024 || total > 512 * 1024 {
        return Err(ProjectError::TooLarge);
    }
    call.input_bytes = bytes as u32;
    d.input_bytes = total as u32;
    Ok(())
}
pub(super) fn reserve_tool(d: &mut DiagnosticRecord) -> Result<(), ProjectError> {
    if d.tool_calls >= 24 {
        return Err(ProjectError::TooLarge);
    }
    d.tool_calls += 1;
    Ok(())
}
pub(super) fn account_tool(d: &mut DiagnosticRecord, bytes: usize) -> Result<(), ProjectError> {
    if bytes > 8192 || d.tool_bytes as usize + bytes > 64 * 1024 {
        return Err(ProjectError::TooLarge);
    }
    d.tool_bytes += bytes as u32;
    Ok(())
}
