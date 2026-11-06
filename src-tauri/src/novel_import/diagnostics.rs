//! Persistent diagnostic records are application-owned. Framework sessions are private checkpoints.
mod budget;
pub(crate) mod commands;
mod execution;
#[cfg(test)]
mod tests;
mod tools;
use super::{
    detection::HeadingRule,
    store::{ImportState, Recovery},
};
use crate::{
    llm::ModelSelection,
    project::{Chapter, ProjectError, Volume},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DiagnosticStatus {
    Running,
    Cancelling,
    WaitingForInput,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum DiagnosticPart {
    Text {
        text: String,
    },
    Tool {
        id: String,
        name: String,
        input: String,
        output: Option<String>,
        failed: bool,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticMessage {
    pub id: String,
    pub role: String,
    pub parts: Vec<DiagnosticPart>,
    pub interrupted: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SplittingProposal {
    pub id: String,
    pub base_revision: u32,
    pub hashes: HashMap<String, String>,
    pub chapters: Vec<Chapter>,
    pub volumes: Vec<Volume>,
    pub rules: Vec<HeadingRule>,
    pub corrections: Vec<crate::project::Correction>,
    pub issues: Vec<super::detection::ImportIssue>,
    pub added_lines: Vec<String>,
    pub removed_lines: Vec<String>,
    pub adopted: bool,
    pub discarded: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModelCallStatus {
    Started,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModelCallRecord {
    pub id: String,
    pub run_id: String,
    pub selection: ModelSelection,
    pub configuration_revision: u32,
    pub input_bytes: u32,
    pub status: ModelCallStatus,
    pub input_tokens: Option<f64>,
    pub output_tokens: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiagnosticRecord {
    pub id: String,
    pub run_id: String,
    pub graph_version: u32,
    pub selection: ModelSelection,
    pub configuration_revision: u32,
    pub base_revision: u32,
    pub hashes: HashMap<String, String>,
    pub status: DiagnosticStatus,
    pub messages: Vec<DiagnosticMessage>,
    pub proposals: Vec<SplittingProposal>,
    pub calls: Vec<ModelCallRecord>,
    pub requests: u32,
    pub turn_requests: u32,
    pub tool_calls: u32,
    pub input_bytes: u32,
    pub tool_bytes: u32,
    pub in_flight: bool,
    pub error: Option<String>,
    pub started_at: String,
    pub input_tokens: Option<f64>,
    pub output_tokens: Option<f64>,
    pub graph: Option<graph_flow::Session>,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticSnapshot {
    pub draft_id: String,
    pub sequence: u32,
    pub session_id: String,
    pub run_id: String,
    pub selection: ModelSelection,
    pub configuration_revision: u32,
    pub status: DiagnosticStatus,
    pub messages: Vec<DiagnosticMessage>,
    pub proposals: Vec<SplittingProposal>,
    pub calls: Vec<ModelCallRecord>,
    pub requests: u32,
    pub tool_calls: u32,
    pub input_bytes: u32,
    pub tool_bytes: u32,
    pub error: Option<String>,
    pub input_tokens: Option<f64>,
    pub output_tokens: Option<f64>,
}
impl DiagnosticRecord {
    pub(super) fn interrupt_tools(&mut self) {
        for message in &mut self.messages {
            for part in &mut message.parts {
                if let DiagnosticPart::Tool { output, failed, .. } = part
                    && output.is_none()
                {
                    *output = Some("interrupted".into());
                    *failed = true;
                }
            }
        }
    }
    fn snapshot(&self, draft_id: &str, sequence: u32) -> DiagnosticSnapshot {
        DiagnosticSnapshot {
            draft_id: draft_id.into(),
            sequence,
            session_id: self.id.clone(),
            run_id: self.run_id.clone(),
            selection: self.selection.clone(),
            configuration_revision: self.configuration_revision,
            status: self.status,
            messages: self.messages.clone(),
            proposals: self.proposals.clone(),
            calls: self.calls.clone(),
            requests: self.requests,
            tool_calls: self.tool_calls,
            input_bytes: self.input_bytes,
            tool_bytes: self.tool_bytes,
            error: self.error.clone(),
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
        }
    }
}
pub(crate) fn record_mut<'a>(
    recovery: &'a mut Recovery,
    session: &str,
) -> Result<&'a mut DiagnosticRecord, ProjectError> {
    recovery
        .diagnostics
        .iter_mut()
        .find(|r| r.id == session)
        .ok_or(ProjectError::NotFound)
}
pub(crate) fn current_hashes(recovery: &Recovery) -> HashMap<String, String> {
    recovery
        .document
        .project
        .sources
        .iter()
        .map(|s| (s.id.clone(), s.sha256.clone()))
        .collect()
}
impl ImportState {
    pub fn diagnostic_snapshot(
        &self,
        draft: &str,
        session: &str,
    ) -> Result<DiagnosticSnapshot, ProjectError> {
        let r = self.read(draft)?;
        let d = r
            .diagnostics
            .iter()
            .find(|d| d.id == session)
            .ok_or(ProjectError::NotFound)?;
        Ok(d.snapshot(draft, r.sequence))
    }
    pub fn notify(&self, draft: &str, session: &str) {
        if let Ok(snapshot) = self.diagnostic_snapshot(draft, session)
            && let Ok(mut subscribers) = self.subscribers.lock()
        {
            let prefix = format!("{draft}:{session}:");
            subscribers.retain(|key, channel| {
                !key.starts_with(&prefix) || channel.send(snapshot.clone()).is_ok()
            });
        }
    }
    pub fn discard_proposal(
        &self,
        draft: &str,
        session: &str,
        proposal: &str,
    ) -> Result<(), ProjectError> {
        self.update_idle(draft, None, |r| {
            let candidate = record_mut(r, session)?
                .proposals
                .iter_mut()
                .find(|p| p.id == proposal)
                .ok_or(ProjectError::NotFound)?;
            if candidate.adopted {
                return Err(ProjectError::Conflict);
            }
            candidate.discarded = true;
            Ok(())
        })?;
        self.notify(draft, session);
        Ok(())
    }
    pub fn adopt(
        &self,
        draft: &str,
        session: &str,
        proposal: &str,
        request: &str,
    ) -> Result<super::types::ImportSnapshot, ProjectError> {
        uuid::Uuid::parse_str(request).map_err(|_| ProjectError::InvalidProject)?;
        self.update_idle(draft, None, |r| {
            let receipt_key = format!("{session}:{proposal}");
            if let Some(receipt) = r.receipts.get(request) {
                return if receipt == &receipt_key {
                    Ok(())
                } else {
                    Err(ProjectError::Conflict)
                };
            }
            let before = r.capture_undo();
            let hashes = current_hashes(r);
            let revision = r.document.project.revision;
            let candidate = record_mut(r, session)?
                .proposals
                .iter_mut()
                .find(|p| p.id == proposal)
                .ok_or(ProjectError::NotFound)?;
            if candidate.base_revision != revision
                || candidate.hashes != hashes
                || candidate.adopted
                || candidate.discarded
            {
                return Err(ProjectError::Conflict);
            }
            candidate.adopted = true;
            let chapters = candidate.chapters.clone();
            let volumes = candidate.volumes.clone();
            let rules = candidate.rules.clone();
            let corrections = candidate.corrections.clone();
            let issues = candidate.issues.clone();
            r.document.project.chapters = chapters;
            r.document.project.volumes = volumes;
            r.document.project.corrections = corrections;
            r.document.project.revision += 1;
            r.document.validate()?;
            r.undo = Some(before);
            r.filename = None;
            r.rules = rules;
            r.issues = issues;
            r.receipts.insert(request.into(), receipt_key);
            Ok(())
        })?;
        self.notify(draft, session);
        Ok(self.read(draft)?.snapshot())
    }
}
