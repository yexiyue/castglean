//! Chapter-splitting proposals. The model supplies rules or line patches, never adopted state.
pub(crate) mod commands;
pub(crate) mod graph;
pub(crate) mod store;
#[cfg(test)]
pub(crate) mod test_support;
use super::{
    detection::{HeadingRule, ImportIssue},
    partition,
};
use crate::project::{Chapter, Correction, ProjectError, Volume, store::LocalProject};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(test)]
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProposalContent {
    pub chapters: Vec<Chapter>,
    pub volumes: Vec<Volume>,
    pub rules: Vec<HeadingRule>,
    pub corrections: Vec<Correction>,
    pub issues: Vec<ImportIssue>,
    pub added_lines: Vec<String>,
    pub removed_lines: Vec<String>,
}

pub(crate) enum ProposalAction {
    Rules(Vec<HeadingRule>),
    Boundaries(Vec<Correction>),
}
pub(crate) struct PreparedProposal {
    project_id: String,
    revision: u32,
    hashes: BTreeMap<String, String>,
    tool_name: &'static str,
    input: Value,
    content: ProposalContent,
}
impl ProposalContent {
    fn summary(&self) -> ProposalSummary {
        ProposalSummary {
            chapters: self.chapters.len(),
            volumes: self.volumes.len(),
            issues: self.issues.len(),
            heading_lines: self
                .chapters
                .iter()
                .filter_map(|chapter| chapter.heading)
                .take(24)
                .collect(),
        }
    }
}
#[derive(Serialize)]
struct ProposalSummary {
    chapters: usize,
    volumes: usize,
    issues: usize,
    heading_lines: Vec<u32>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuleVariant {
    label: String,
    #[schemars(length(max = 32))]
    rules: Vec<HeadingRule>,
}

#[derive(Serialize)]
pub(crate) struct RuleComparison {
    label: String,
    summary: Option<ProposalSummary>,
    error: Option<&'static str>,
}

pub(crate) fn compare_rules(
    state: &LocalProject,
    variants: Vec<RuleVariant>,
    token: &CancellationToken,
) -> Result<Vec<RuleComparison>, ProjectError> {
    if variants.is_empty() || variants.len() > 4 {
        return Err(ProjectError::TooLarge);
    }
    let mut labels = BTreeSet::new();
    let mut comparisons = Vec::with_capacity(variants.len());
    for variant in variants {
        if variant.label.is_empty()
            || variant.label.len() > 32
            || !labels.insert(variant.label.clone())
            || variant.rules.len() > 32
        {
            return Err(ProjectError::InvalidProject);
        }
        if token.is_cancelled() {
            return Err(ProjectError::Cancelled);
        }
        let (summary, error) = match calculate(state, ProposalAction::Rules(variant.rules), token) {
            Ok(content) => (Some(content.summary()), None),
            Err(ProjectError::Cancelled) => return Err(ProjectError::Cancelled),
            Err(_) => (None, Some("invalid_rules")),
        };
        comparisons.push(RuleComparison {
            label: variant.label,
            summary,
            error,
        });
    }
    Ok(comparisons)
}

pub(crate) fn hashes(state: &LocalProject) -> BTreeMap<String, String> {
    state
        .document
        .project
        .sources
        .iter()
        .map(|s| (s.id.clone(), s.sha256.clone()))
        .collect()
}

fn boundaries(chapters: &[Chapter]) -> BTreeSet<String> {
    chapters
        .iter()
        .map(|c| {
            format!(
                "{}:{}",
                c.source_id,
                c.heading
                    .map_or_else(|| "prefix".into(), |line| line.to_string())
            )
        })
        .collect()
}

/// Binds a typed action to its exact admitted wire input, preserving optional-field presence.
pub(crate) fn propose_for_call(
    state: &LocalProject,
    action: ProposalAction,
    accepted_input: Value,
    token: &CancellationToken,
) -> Result<PreparedProposal, ProjectError> {
    let content = calculate(state, action, token)?;
    Ok(PreparedProposal {
        project_id: state.document.project.id.clone(),
        revision: state.document.project.revision,
        hashes: hashes(state),
        tool_name: "finish_splitting",
        input: accepted_input,
        content,
    })
}

#[cfg(test)]
fn propose(
    state: &LocalProject,
    action: ProposalAction,
    token: &CancellationToken,
) -> Result<PreparedProposal, ProjectError> {
    let input = match &action {
        ProposalAction::Rules(rules) => json!({"plan":{"kind":"rules","rules":rules}}),
        ProposalAction::Boundaries(corrections) => {
            json!({"plan":{"kind":"boundaries","corrections":corrections}})
        }
    };
    propose_for_call(state, action, input, token)
}

fn calculate(
    state: &LocalProject,
    action: ProposalAction,
    token: &CancellationToken,
) -> Result<ProposalContent, ProjectError> {
    if token.is_cancelled() {
        return Err(ProjectError::Cancelled);
    }
    state.document.validate()?;
    let mut document = state.document.clone();
    let mut rules: Vec<HeadingRule> = serde_json::from_value(state.edit.rules.clone())
        .map_err(|_| ProjectError::InvalidProject)?;
    let single: Vec<String> = serde_json::from_value(state.edit.single_chapter_sources.clone())
        .map_err(|_| ProjectError::InvalidProject)?;
    let mut issues: Vec<ImportIssue> = serde_json::from_value(state.edit.issues.clone())
        .map_err(|_| ProjectError::InvalidProject)?;
    let before = boundaries(&document.project.chapters);
    match action {
        ProposalAction::Rules(proposed) => {
            if proposed.len() > 32 {
                return Err(ProjectError::TooLarge);
            }
            rules = proposed;
            partition::recalculate(&mut document, &rules, &single, &mut issues, token)?;
        }
        ProposalAction::Boundaries(patches) => {
            if patches.len() > 100 {
                return Err(ProjectError::TooLarge);
            }
            if patches.iter().any(|patch| {
                document
                    .project
                    .corrections
                    .iter()
                    .any(|c| c.source_id == patch.source_id && c.line == patch.line)
            }) {
                return Err(ProjectError::Conflict);
            }
            partition::patch_boundaries(&mut document, &mut issues, patches, token)?;
        }
    }
    let after = boundaries(&document.project.chapters);
    let content = ProposalContent {
        chapters: document.project.chapters,
        volumes: document.project.volumes,
        rules,
        corrections: document.project.corrections,
        issues,
        added_lines: after.difference(&before).cloned().collect(),
        removed_lines: before.difference(&after).cloned().collect(),
    };
    validate(state, &content)?;
    Ok(content)
}

pub(crate) fn validate(
    state: &LocalProject,
    content: &ProposalContent,
) -> Result<(), ProjectError> {
    for correction in &state.document.project.corrections {
        if !content.corrections.iter().any(|c| {
            c.source_id == correction.source_id
                && c.line == correction.line
                && c.include == correction.include
                && c.title == correction.title
                && c.volume_id == correction.volume_id
        }) {
            return Err(ProjectError::Conflict);
        }
    }
    for volume in state.document.project.volumes.iter().filter(|v| v.manual) {
        if !content.volumes.iter().any(|v| {
            v.id == volume.id
                && v.source_id == volume.source_id
                && v.line == volume.line
                && v.title == volume.title
                && v.manual
        }) {
            return Err(ProjectError::Conflict);
        }
    }
    let mut document = state.document.clone();
    document.project.chapters = content.chapters.clone();
    document.project.volumes = content.volumes.clone();
    document.project.corrections = content.corrections.clone();
    document.validate()
}
