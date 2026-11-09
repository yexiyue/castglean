//! Host-private C7 draft. Pure in-memory state: no database, transport or request quota.
//! `result` is a validated phase boundary, never a partially completed tool loop.
//! Segment evidence is source provenance, not model-generated semantic rationale.
use self::dto::{
    CoreCharacter as Character, CoreIssue as Issue, CoreRange as Range, CoreReview as Review,
    CoreSegment as Segment, CoreSuggestion as Suggestion, InputState, candidate_id, hash,
};
pub(super) use self::dto::{CoreCharacter, CoreRange, CoreReview, NewCharacter, ValidatedAnalysis};
mod checkpoint;
mod dto;
use anyhow::{Result, bail, ensure};
use rig_core::{
    message::ToolName,
    tool::{DynamicTool, ToolOutput},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
    time::Instant,
};

mod compact;
mod context;

pub(super) type SharedDraft = Arc<Mutex<Draft>>;
/// C7 prompt, without the experimental model-request quota.
pub(super) fn prompt() -> &'static str {
    compact::PROMPT
}
pub(super) const MAX_TOOL_CALLS: usize = 32;
pub(super) const MAX_REPAIR_ROUNDS: usize = 3;
pub(super) const PROTOCOL_VERSION: &str = "chapter-agent-c7-core/1";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Piece {
    pub id: String,
    pub text: String,
    pub start: usize,
    pub end: usize,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireSegment {
    #[serde(default)]
    pieces: Option<Vec<String>>,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    kind: String,
    speaker: String,
    #[serde(default)]
    candidates: Vec<String>,
    evidence: Vec<String>,
    reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Patch {
    operation_id: String,
    expected_revision: u64,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    segments: Vec<WireSegment>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProposedCharacter {
    #[serde(rename = "ref")]
    reference: String,
    name: String,
    evidence: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Proposal {
    operation_id: String,
    expected_revision: u64,
    characters: Vec<ProposedCharacter>,
}

// Keep machine-readable locations out of the error code logged in traces.
#[derive(Debug)]
struct Rejection {
    code: String,
    details: Value,
}
impl std::fmt::Display for Rejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.code)
    }
}
impl std::error::Error for Rejection {}
fn located(error: anyhow::Error, details: Value) -> anyhow::Error {
    Rejection {
        code: error.to_string(),
        details,
    }
    .into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewSuggestion {
    target_id: String,
    suggestion: Suggestion,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Finish {
    expected_revision: u64,
    #[serde(default)]
    issues: Vec<ReviewSuggestion>,
}

pub(super) struct Draft {
    state: InputState,
    pub pieces: Vec<Piece>,
    pub revision: u64,
    segments: Vec<Segment>,
    operations: BTreeMap<String, (String, Value)>,
    character_refs: BTreeMap<String, String>,
    piece_revisions: Vec<u64>,
    done: bool,
    review: Option<Review>,
    logs: Vec<Value>,
    pub repair_rounds: usize,
    pub calls: usize,
    pub first_check_valid: Option<bool>,
    allow_discovery: bool,
    compact: bool,
}
impl Draft {
    fn new(state: InputState, allow_discovery: bool) -> Result<Self> {
        state.validate()?;
        let mut pieces = Vec::new();
        let mut start = 0;
        let mut count = 0;
        for (offset, ch) in state.source.text.char_indices() {
            if matches!(ch, '“' | '‘' | '「' | '『' | '"') && offset > start {
                pieces.push(Piece {
                    id: format!("p{}", pieces.len()),
                    text: state.source.text[start..offset].into(),
                    start,
                    end: offset,
                });
                start = offset;
                count = 0;
            }
            count += 1;
            let end = offset + ch.len_utf8();
            if count >= 120
                || matches!(
                    ch,
                    '\n' | '\r'
                        | '。'
                        | '！'
                        | '？'
                        | '，'
                        | '：'
                        | '“'
                        | '”'
                        | '‘'
                        | '’'
                        | '「'
                        | '」'
                        | '『'
                        | '』'
                        | '!'
                        | '?'
                        | ';'
                        | '；'
                        | ':'
                        | ','
                )
            {
                pieces.push(Piece {
                    id: format!("p{}", pieces.len()),
                    text: state.source.text[start..end].into(),
                    start,
                    end,
                });
                start = end;
                count = 0;
            }
        }
        if start < state.source.text.len() {
            pieces.push(Piece {
                id: format!("p{}", pieces.len()),
                text: state.source.text[start..].into(),
                start,
                end: state.source.text.len(),
            });
        }
        Ok(Self {
            piece_revisions: vec![0; pieces.len()],
            character_refs: BTreeMap::new(),
            state,
            pieces,
            revision: 0,
            segments: vec![],
            operations: BTreeMap::new(),
            done: false,
            review: None,
            logs: vec![],
            repair_rounds: 0,
            calls: 0,
            first_check_valid: None,
            allow_discovery,
            compact: false,
        })
    }
    pub fn finished(&self) -> bool {
        self.done
    }
    pub fn terminal(&self) -> bool {
        self.done || self.calls >= MAX_TOOL_CALLS || self.repair_rounds >= MAX_REPAIR_ROUNDS
    }
    #[cfg(test)]
    fn segments(&self) -> Vec<Segment> {
        if self.state.evaluation_task == "review" {
            self.state
                .review_input
                .as_ref()
                .map(|a| a.segments.clone())
                .unwrap_or_default()
        } else {
            self.segments.clone()
        }
    }
    #[cfg(test)]
    pub fn audit(&self) -> &[Value] {
        &self.logs
    }
    pub fn review_result(&self) -> Option<CoreReview> {
        self.review.clone()
    }
    pub fn input(&self) -> Value {
        context::input(self)
    }
    fn index(&self, id: &str) -> Result<usize> {
        let n = id
            .strip_prefix('p')
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|i| format!("p{i}") == id && *i < self.pieces.len());
        n.ok_or_else(|| anyhow::anyhow!("unknown_piece"))
    }
    fn range(&self, from: &str, to: &str) -> Result<Range> {
        let a = self.index(from)?;
        let b = self.index(to)?;
        ensure!(a <= b, "reversed_range");
        Ok(Range {
            start: self.pieces[a].start,
            end: self.pieces[b].end,
        })
    }
    fn operation(&self, tool: &str, id: &str, args: &Value) -> Result<(String, Option<Value>)> {
        ensure!(!id.trim().is_empty() && id.len() <= 128, "operation_id");
        let fingerprint = hash(serde_json::to_string(&(tool, args))?.as_bytes());
        let replay = if let Some((old, reply)) = self.operations.get(id) {
            ensure!(old == &fingerprint, "operation_id_conflict");
            Some(reply.clone())
        } else {
            None
        };
        Ok((fingerprint, replay))
    }
    fn resolve_identity(&self, id: &str) -> String {
        self.character_refs
            .get(id)
            .map(String::as_str)
            .unwrap_or(id)
            .to_owned()
    }
    fn patch(&mut self, args: Value) -> Result<Value> {
        ensure!(
            self.state.evaluation_task != "review",
            "review_is_read_only"
        );
        let p: Patch =
            serde_json::from_value(args.clone()).map_err(|_| anyhow::anyhow!("patch_arguments"))?;
        let (fingerprint, replay) = self.operation("patch_annotations", &p.operation_id, &args)?;
        if let Some(reply) = replay {
            return Ok(reply);
        }
        ensure!(p.expected_revision <= self.revision, "revision_conflict");
        ensure!(!p.segments.is_empty(), "segments_required");
        ensure!(
            args.get("from").is_none()
                && args.get("to").is_none()
                && p.segments
                    .iter()
                    .enumerate()
                    .all(|(i, segment)| segment.pieces.is_some()
                        && args["segments"][i].get("from").is_none()
                        && args["segments"][i].get("to").is_none()),
            "segment_target_required"
        );
        // Explicit legacy bounds retain their complete, ordered coverage contract.
        let owned = match (&p.from, &p.to) {
            (Some(from), Some(to)) => Some(self.range(from, to)?),
            (None, None) => None,
            _ => bail!("patch_bounds_pair_required"),
        };
        // Field presence matters: explicit null bounds cannot mask mixed modes.
        let uses_pieces = p
            .segments
            .iter()
            .enumerate()
            .any(|(i, _)| args["segments"][i].get("pieces").is_some());
        let uses_ranges = args.get("from").is_some()
            || args.get("to").is_some()
            || p.segments.iter().enumerate().any(|(i, _)| {
                args["segments"][i].get("from").is_some() || args["segments"][i].get("to").is_some()
            });
        ensure!(!(uses_pieces && uses_ranges), "mixed_piece_range_modes");
        let mut assignments = Vec::new();
        for (index, s) in p.segments.iter().enumerate() {
            let indices = (|| -> Result<Vec<usize>> {
                match (&s.pieces, &s.from, &s.to) {
                    (Some(ids), None, None) => {
                        ensure!(!ids.is_empty(), "pieces_required");
                        ids.iter().map(|id| self.index(id)).collect()
                    }
                    (None, Some(from), Some(to)) => {
                        self.range(from, to)?;
                        Ok((self.index(from)?..=self.index(to)?).collect())
                    }
                    _ => bail!("segment_target_required"),
                }
            })()
            .map_err(|e| located(e, json!({"segmentIndex":index})))?;
            assignments.push(indices);
        }
        // Preflight the complete batch, including duplicate IDs within one label.
        // A pair (i, i) denotes a repeated assignment inside segment i.
        let mut owners: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        let mut conflicts: BTreeMap<(usize, usize), BTreeSet<usize>> = BTreeMap::new();
        for (index, indices) in assignments.iter().enumerate() {
            for piece in indices {
                let prior = owners.entry(*piece).or_default();
                for previous in prior.iter() {
                    conflicts
                        .entry((*previous, index))
                        .or_default()
                        .insert(*piece);
                }
                if !prior.contains(&index) {
                    prior.push(index);
                }
            }
        }
        if !conflicts.is_empty() {
            let groups = conflicts
                .iter()
                .take(16)
                .map(|((a, b), pieces)| {
                    json!({
                        "segmentIndices":[a,b], "pieceCount":pieces.len(),
                        "pieceIds":pieces.iter().map(|i| &self.pieces[*i].id).collect::<Vec<_>>()
                    })
                })
                .collect::<Vec<_>>();
            return Err(located(
                anyhow::anyhow!("overlapping_segments"),
                json!({
                    "segmentIndex":conflicts.keys().next().map(|(_, b)| b),
                    "conflictCount":conflicts.len(),"conflicts":groups,
                    "conflictsTruncated":conflicts.len()>16
                }),
            ));
        }
        let touched = owners.keys().copied().collect::<BTreeSet<_>>();
        let mut candidate = Vec::new();
        for (index, (s, mut indices)) in p.segments.into_iter().zip(assignments).enumerate() {
            let validated = (|| -> Result<Vec<Segment>> {
                ensure!(
                    s.speaker == "unknown" || args["segments"][index].get("candidates").is_none(),
                    "candidates_require_unknown"
                );
                ensure!(!s.reason.trim().is_empty(), "evidence_reason_required");
                for piece in &indices {
                    ensure!(
                        self.piece_revisions[*piece] <= p.expected_revision,
                        "revision_conflict"
                    );
                }
                let evidence = s
                    .evidence
                    .iter()
                    .map(|id| self.range(id, id))
                    .collect::<Result<Vec<_>>>()?;
                ensure!(
                    !args["segments"][index]
                        .get("candidates")
                        .is_some_and(|v| v.as_array().is_some_and(|a| a.len() < 2)),
                    "ambiguous_candidates"
                );
                indices.sort_unstable();
                let mut ranges: Vec<Range> = Vec::new();
                for piece in indices {
                    let p = &self.pieces[piece];
                    if let Some(last) = ranges.last_mut()
                        && last.end == p.start
                    {
                        last.end = p.end;
                    } else {
                        ranges.push(Range {
                            start: p.start,
                            end: p.end,
                        });
                    }
                }
                let mut segments = Vec::new();
                for range in ranges {
                    let segment = Segment {
                        start: range.start,
                        end: range.end,
                        kind: s.kind.clone(),
                        speaker: self.resolve_identity(&s.speaker),
                        candidates: s
                            .candidates
                            .iter()
                            .map(|id| self.resolve_identity(id))
                            .collect(),
                        evidence: evidence.clone(),
                    };
                    self.state
                        .validate_segments(std::slice::from_ref(&segment), range)?;
                    segments.push(segment);
                }
                Ok(segments)
            })()
            .map_err(|e| {
                located(
                    e,
                    json!({"segmentIndex":index,
                "offendingIds":s.pieces.as_ref().map(|ids| ids.iter().take(16).collect::<Vec<_>>())
                    .unwrap_or_else(|| s.from.iter().chain(s.to.iter()).collect())}),
                )
            })?;
            candidate.extend(validated);
        }
        if let Some(owned) = owned {
            self.state.validate_segments(&candidate, owned).map_err(|e| {
                let missing = self.pieces.iter().filter(|p| p.start >= owned.start && p.end <= owned.end)
                    .filter(|p| !candidate.iter().any(|s| s.start <= p.start && s.end >= p.end))
                    .map(|p| &p.id).collect::<Vec<_>>();
                located(e, json!({"offendingIds":[p.from,p.to],
                    "missingIds":missing.iter().take(16).collect::<Vec<_>>(),"missingCount":missing.len()}))
            })?;
        }
        // A contiguous union of submitted ranges may replace a whole old segment,
        // but a sparse batch must never erase the untouched middle of that segment.
        for old in &self.segments {
            let pieces = self
                .pieces
                .iter()
                .enumerate()
                .filter(|(_, p)| p.start < old.end && p.end > old.start)
                .map(|(i, _)| i)
                .collect::<Vec<_>>();
            if pieces.iter().any(|i| touched.contains(i))
                && !pieces.iter().all(|i| touched.contains(i))
            {
                return Err(located(
                    anyhow::anyhow!("existing_segment_crosses_patch_boundary"),
                    json!({"offendingIds":pieces.iter().map(|i| &self.pieces[*i].id).take(16).collect::<Vec<_>>(),
                            "existingRange":{"from":pieces.first().map(|i| &self.pieces[*i].id),
                                "to":pieces.last().map(|i| &self.pieces[*i].id)}}),
                ));
            }
        }
        let mut next = self
            .segments
            .iter()
            .filter(|s| !candidate.iter().any(|c| s.start < c.end && s.end > c.start))
            .cloned()
            .collect::<Vec<_>>();
        next.extend(candidate);
        next.sort_by_key(|s| s.start);
        self.segments = next;
        self.revision += 1;
        for i in touched {
            self.piece_revisions[i] = self.revision;
        }
        let reply = json!({"ok":true,"revision":self.revision,"segmentCount":self.segments.len()});
        self.operations
            .insert(p.operation_id, (fingerprint, reply.clone()));
        Ok(reply)
    }
    fn check(&mut self) -> Value {
        if self.state.evaluation_task == "review" {
            return json!({"ok":true,"revision":self.revision,"readOnly":true,"readyForReview":true});
        }
        let missing = self
            .pieces
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                !self
                    .segments
                    .iter()
                    .any(|s| s.start <= p.start && s.end >= p.end)
            })
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        let mut missing_ranges = Vec::new();
        let mut cursor = 0;
        while cursor < missing.len() {
            let first = missing[cursor];
            let mut last = first;
            cursor += 1;
            while cursor < missing.len() && missing[cursor] == last + 1 {
                last = missing[cursor];
                cursor += 1;
            }
            missing_ranges.push(json!({"from":self.pieces[first].id,"to":self.pieces[last].id,"count":last-first+1}));
        }
        let valid = self
            .state
            .validate_segments(
                &self.segments,
                Range {
                    start: 0,
                    end: self.state.source.text.len(),
                },
            )
            .is_ok();
        self.first_check_valid.get_or_insert(valid);
        if !valid {
            self.repair_rounds += 1;
        }
        json!({"ok":valid,"revision":self.revision,"missingIds":missing.iter().take(512).map(|i| &self.pieces[*i].id).collect::<Vec<_>>(),"missingRanges":missing_ranges,"missingCount":missing.len(),"missingIdsTruncated":missing.len()>512,"repairRounds":self.repair_rounds,"segmentCount":self.segments.len(),"error":if valid{Value::Null}else{json!("incomplete_draft")}})
    }
    fn finish(&mut self, args: Value) -> Result<Value> {
        if self.compact && self.state.evaluation_task != "review" {
            return self.submit_partition(args);
        }
        let raw = args.clone();
        let f: Finish =
            serde_json::from_value(args).map_err(|_| anyhow::anyhow!("finish_arguments"))?;
        ensure!(f.expected_revision == self.revision, "revision_conflict");
        if self.state.evaluation_task == "review" {
            let candidate = &self
                .state
                .review_input
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("review_input"))?
                .segments;
            let mut issues = Vec::new();
            let mut ids = BTreeSet::new();
            for (index, issue) in f.issues.into_iter().enumerate() {
                ensure!(
                    issue.suggestion.speaker == "unknown"
                        || raw["issues"][index]["suggestion"]
                            .get("candidates")
                            .is_none(),
                    "candidates_require_unknown"
                );
                ensure!(
                    !raw["issues"][index]["suggestion"]
                        .get("candidates")
                        .is_some_and(|v| v.as_array().is_some_and(|a| a.len() < 2)),
                    "ambiguous_candidates"
                );
                if self.compact {
                    ensure!(
                        issue.suggestion.speaker == "unknown"
                            || issue.suggestion.candidates.is_empty(),
                        "candidates_require_unknown"
                    );
                }
                ensure!(
                    ids.insert(issue.target_id.clone()),
                    "duplicate_review_target"
                );
                let s = issue
                    .target_id
                    .strip_prefix('r')
                    .and_then(|s| s.parse::<usize>().ok())
                    .filter(|i| format!("r{i}") == issue.target_id)
                    .and_then(|i| candidate.get(i))
                    .ok_or_else(|| anyhow::anyhow!("unknown_review_target"))?;
                issues.push(Issue {
                    start: s.start,
                    end: s.end,
                    category: "speaker".into(),
                    certainty: "uncertain".into(),
                    suggestion: Some(Suggestion {
                        kind: issue.suggestion.kind,
                        speaker: self.resolve_identity(&issue.suggestion.speaker),
                        candidates: issue
                            .suggestion
                            .candidates
                            .iter()
                            .map(|id| self.resolve_identity(id))
                            .collect(),
                    }),
                });
            }
            let review = Review { issues };
            self.state.validate_review(&review, candidate)?;
            self.review = Some(review);
        } else {
            ensure!(f.issues.is_empty(), "analysis_cannot_submit_review");
            let checked = self.check();
            if checked["ok"] != true {
                return Ok(checked);
            }
        }
        self.done = true;
        Ok(
            json!({"ok":true,"completed":true,"revision":self.revision,"humanConfirmed":false,"published":false}),
        )
    }
    fn propose(&mut self, args: Value) -> Result<Value> {
        ensure!(
            self.state.evaluation_task != "review",
            "review_is_read_only"
        );
        ensure!(self.allow_discovery, "identity_scope_known_only");
        let p: Proposal = serde_json::from_value(args.clone())
            .map_err(|_| anyhow::anyhow!("proposal_arguments"))?;
        let (fingerprint, replay) = self.operation("propose_characters", &p.operation_id, &args)?;
        if let Some(reply) = replay {
            return Ok(reply);
        }
        ensure!(p.expected_revision <= self.revision, "revision_conflict");
        ensure!(!p.characters.is_empty(), "characters_required");
        let mut refs = BTreeSet::new();
        for (index, c) in p.characters.iter().enumerate() {
            (|| -> Result<()> {
                ensure!(
                    c.reference
                        .strip_prefix("new:")
                        .is_some_and(|s| !s.is_empty()
                            && s.len() <= 128
                            && s.bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))),
                    "character_ref"
                );
                ensure!(
                    refs.insert(&c.reference)
                        && !self.character_refs.contains_key(&c.reference)
                        && !self
                            .state
                            .characters
                            .iter()
                            .any(|old| old.id == c.reference),
                    "character_ref_conflict"
                );
                ensure!(
                    !c.name.trim().is_empty() && c.name.chars().count() <= 120,
                    "character_name"
                );
                ensure!(!c.evidence.is_empty(), "character_evidence");
                for id in &c.evidence {
                    self.index(id)?;
                }
                Ok(())
            })()
            .map_err(|e| {
                located(
                    e,
                    json!({"characterIndex":index,"offendingIds":[c.reference]}),
                )
            })?;
        }
        let mut mapping = BTreeMap::new();
        for c in p.characters {
            let id = candidate_id(&self.state.source.sha256, &c.reference);
            ensure!(
                !self.state.characters.iter().any(|known| known.id == id),
                "candidate_id_conflict"
            );
            let evidence = c
                .evidence
                .iter()
                .map(|piece| self.range(piece, piece))
                .collect::<Result<Vec<_>>>()?;
            self.state.new_characters.push(NewCharacter {
                reference: c.reference.clone(),
                id: id.clone(),
                name: c.name.clone(),
                evidence,
            });
            mapping.insert(c.reference.clone(), id.clone());
            self.character_refs.insert(c.reference, id.clone());
            self.state.characters.push(Character {
                id,
                name: c.name,
                description: None,
                extra: BTreeMap::new(),
            });
        }
        self.revision += 1;
        let reply =
            json!({"ok":true,"characterRefs":mapping,"revision":self.revision,"confirmed":false});
        self.operations
            .insert(p.operation_id, (fingerprint, reply.clone()));
        Ok(reply)
    }
    fn execute(&mut self, name: &str, args: Value) -> Result<Value> {
        if self.done && self.state.evaluation_task == "analysis" {
            let mut replay_args = args.clone();
            let tool = if name == "finish_analysis" {
                Some("finish_analysis")
            } else if name == "patch_annotations" && args["finalize"] == true {
                if let Some(object) = replay_args.as_object_mut() {
                    object.remove("finalize");
                }
                Some("patch_annotations_finalize")
            } else {
                None
            };
            if let (Some(tool), Some(id)) = (tool, replay_args["operationId"].as_str()) {
                let (_, replay) = self.operation(tool, id, &replay_args)?;
                if let Some(reply) = replay {
                    return Ok(reply);
                }
            }
        }
        ensure!(!self.done, "draft_already_finished");
        ensure!(self.calls < MAX_TOOL_CALLS, "tool_budget_exhausted");
        ensure!(
            self.repair_rounds < MAX_REPAIR_ROUNDS,
            "repair_budget_exhausted"
        );
        ensure!(
            self.definitions()
                .iter()
                .any(|(offered, _, _)| *offered == name),
            "tool_not_offered"
        );
        match name {
            "read_source" => {
                let r = self.range(
                    args["from"]
                        .as_str()
                        .ok_or_else(|| anyhow::anyhow!("read_from"))?,
                    args["to"]
                        .as_str()
                        .ok_or_else(|| anyhow::anyhow!("read_to"))?,
                )?;
                Ok(
                    json!({"ok":true,"revision":self.revision,"pieces":self.pieces.iter().filter(|p|p.start>=r.start&&p.end<=r.end).collect::<Vec<_>>()}),
                )
            }
            "propose_characters" => self.propose(args),
            "patch_annotations" => {
                if self.compact && args.get("finalize").is_some() {
                    self.patch_and_finish(args)
                } else {
                    self.patch(args)
                }
            }
            "check_draft" => Ok(self.check()),
            "finish_analysis" => self.finish(args),
            _ => bail!("unknown_tool"),
        }
    }
    fn feedback(&self, args: &Value, value: &mut Value) {
        value["revision"] = json!(self.revision);
        value["validPieceRange"] = json!({"from":self.pieces.first().map(|p| &p.id),
            "to":self.pieces.last().map(|p| &p.id),"count":self.pieces.len()});
        // Inspect only protocol ID fields; never echo names, reasons or source text.
        fn ids<'a>(v: &'a Value, found: &mut Vec<(&'a str, bool)>) {
            if let Some(obj) = v.as_object() {
                for (key, v) in obj {
                    match key.as_str() {
                        "from" | "to" | "speaker" => {
                            if let Some(id) = v.as_str() {
                                found.push((id, key != "speaker"));
                            }
                        }
                        "pieces" | "evidence" | "candidates" => {
                            if let Some(a) = v.as_array() {
                                found.extend(
                                    a.iter()
                                        .filter_map(Value::as_str)
                                        .map(|id| (id, key != "candidates")),
                                );
                            }
                        }
                        "characters" | "segments" | "issues" => {
                            if let Some(a) = v.as_array() {
                                for item in a {
                                    ids(item, found);
                                }
                            }
                        }
                        "suggestion" => ids(v, found),
                        _ => {}
                    }
                }
            }
        }
        let mut found = Vec::new();
        // Malformed finish fields are not known to be protocol IDs. Return
        // only the declared schema, rather than echoing arbitrary strings.
        if !matches!(
            value["error"].as_str(),
            Some("finish_arguments" | "partition_arguments")
        ) {
            ids(args, &mut found);
        }
        let unknown = found
            .into_iter()
            .filter(|(id, piece)| {
                if *piece {
                    self.index(id).is_err()
                } else {
                    !["narrator", "unknown"].contains(id)
                        && !self
                            .state
                            .characters
                            .iter()
                            .any(|c| c.id == self.resolve_identity(id))
                }
            })
            .map(|(id, _)| id)
            .collect::<BTreeSet<_>>();
        value["unknownIds"] = json!(unknown.iter().take(16).collect::<Vec<_>>());
        if value.get("offendingIds").is_none() {
            value["offendingIds"] = value["unknownIds"].clone();
        }
        if matches!(
            value["error"].as_str(),
            Some("finish_arguments" | "partition_arguments")
        ) {
            // Return the declared contract, never serde's potentially private
            // offending value or the submitted argument object.
            value["expectedSchema"] = self
                .definitions()
                .into_iter()
                .find(|(name, _, _)| *name == "finish_analysis")
                .map(|(_, _, schema)| schema)
                .unwrap_or(Value::Null);
        }
        value["hint"] = json!(match value["error"].as_str().unwrap_or_default() {
            "candidates_require_unknown" =>
                "Omit candidates for a known speaker or narrator. Only speaker=unknown may include at least two distinct registered candidates. Correct the indicated run or review suggestion, not the character identity declaration.",
            "partition_order_or_bounds" | "partition_incomplete" =>
                "Runs explicitly label consecutive source pieces from 0 through lastPieceIndex. Use strictly increasing end indexes; finish the final run at lastPieceIndex. No automatic fill or default narration.",
            "partition_arguments" =>
                "Use the supplied schema. Submit operationId, expectedRevision, optional characters, and ordered runs with integer end, short kind n/s/t, speaker ref. No nulls or explanation fields.",
            "identity" if self.compact =>
                "Use only registered character refs from input or declarations in this transaction, unknown or narrator; never a character name. Narration must use narrator. Review suggestions do not declare new characters.",
            "finish_arguments" =>
                "Submit expectedRevision as an integer and optional issues array. Each issue has only targetId and suggestion; suggestion has kind, speaker and optional candidates array. Omit candidates when absent; do not send null. Use the supplied expectedSchema; do not add explanation fields.",
            "overlapping_segments" =>
                "Each piece may belong to only one label per batch, even for identical labels. Use conflicts to decide the correct assignment; remove duplicates explicitly. The host never clips, fills or guesses semantics. At most 16 groups are shown; each includes all its overlapping IDs. conflictCount includes every conflicting pair of segment indices.",
            "mixed_piece_range_modes" | "segment_target_required" =>
                "Use only pieces arrays for new annotations; do not combine pieces with legacy from/to anywhere in the batch. read_source still uses from/to.",
            "pieces_required" =>
                "List at least one exact pN ID in pieces; omitted IDs remain untouched.",
            "ambiguous_candidates" =>
                "Use unknown with at least two distinct registered character IDs/refs, or omit candidates.",
            "revision_conflict" =>
                "Use the current revision; stale patches may only touch pieces unchanged since expectedRevision. Finish must be a separate final call with the latest revision.",
            "unknown_piece" | "reversed_range" =>
                "Use exact pN IDs within validPieceRange; pieces may be unordered. Legacy from/to must be increasing. See unknownIds and segmentIndex/characterIndex.",
            "existing_segment_crosses_patch_boundary" =>
                "Replace every piece of each touched existing segment; a sparse gap cannot erase its middle.",
            "incomplete_draft" =>
                "Assign explicit pieces for all missingIds (up to 512); missingRanges describe every gap even if missingIdsTruncated is true. Plan the complete repair before checking again, then finish separately.",
            "character_ref_conflict" =>
                "Use fresh unique new: refs; replay an accepted batch with its original operationId and unchanged arguments.",
            "identity_scope_known_only" =>
                "Discovery is disabled; use provided identities or unknown.",
            "operation_id_conflict" =>
                "Use a new operationId for changed arguments or a different tool.",
            _ =>
                "Correct the indicated segment/character and protocol fields; rejected batches do not change the draft.",
        });
    }
    pub fn call(&mut self, name: &str, args: Value) -> Value {
        let start = Instant::now();
        let before = self.revision;
        let repairs_before = self.repair_rounds;
        let result = self.execute(name, args.clone());
        self.calls += 1;
        let mut value = match result {
            Ok(v) => v,
            Err(e) => {
                let mut v = json!({"ok":false,"error":e.to_string(),"revision":self.revision});
                if let Some(rejection) = e.downcast_ref::<Rejection>()
                    && let Some(details) = rejection.details.as_object()
                {
                    for (key, detail) in details {
                        v[key] = detail.clone();
                    }
                }
                v
            }
        };
        let compact_finalizing = self.compact
            && (name == "finish_analysis"
                || (name == "patch_annotations" && args["finalize"] == true));
        if compact_finalizing && value["ok"] != true {
            self.first_check_valid.get_or_insert(false);
        }
        if value["ok"] != true {
            self.feedback(&args, &mut value);
        }
        if value["ok"] != true
            && (matches!(name, "check_draft" | "finish_analysis") || compact_finalizing)
            && repairs_before == self.repair_rounds
            && self.repair_rounds < MAX_REPAIR_ROUNDS
        {
            self.repair_rounds += 1;
        }
        if compact_finalizing {
            value["repairRounds"] = json!(self.repair_rounds);
        }
        let conflict_summary = value["conflicts"].as_array().map(|groups| groups.iter()
            .map(|group| json!({"segmentIndices":group["segmentIndices"],"pieceCount":group["pieceCount"]}))
            .collect::<Vec<_>>());
        self.logs.push(json!({"conflictCount":value.get("conflictCount"),"conflicts":conflict_summary,"tool":if matches!(name,"read_source"|"patch_annotations"|"finish_analysis"){name}else{"unknown_tool"},"status":if value["ok"]==true{"completed"}else{"rejected"},"error":value.get("error"),"revisionBefore":before,"revisionAfter":self.revision,"missingCount":value.get("missingCount"),"elapsedMs":start.elapsed().as_secs_f64()*1000.0}));

        value
    }
}

fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
pub(super) fn definitions() -> Vec<(&'static str, &'static str, Value)> {
    let string = json!({"type":"string"});
    let ids = json!({"type":"array","items":{"type":"string"},"minItems":1});
    let suggestion = object(
        json!({"kind":{"type":"string","enum":["narration","speech","thought"]},"speaker":string,"candidates":{"type":"array","items":{"type":"string"},"minItems":2}}),
        &["kind", "speaker"],
    );
    let segment = object(
        json!({"pieces":{"type":"array","items":{"type":"string"},"minItems":1,"uniqueItems":true},"kind":{"type":"string","enum":["narration","speech","thought"]},"speaker":string,"candidates":{"type":"array","items":{"type":"string"},"minItems":2},"evidence":ids,"reason":string}),
        &["pieces", "kind", "speaker", "evidence", "reason"],
    );
    vec![
        (
            "read_source",
            "Read immutable original pieces and their exact IDs; no draft changes.",
            object(json!({"from":string,"to":string}), &["from", "to"]),
        ),
        (
            "propose_characters",
            "Atomically append a batch of unconfirmed characters with unique new: refs and evidence; returns characterRefs mapping to canonical IDs. Stale revisions are allowed, future revisions and reused refs are rejected. Available only when identity discovery is explicitly allowed; names never merge identities.",
            object(
                json!({"operationId":string,"expectedRevision":{"type":"integer","minimum":0},"characters":{"type":"array","minItems":1,"items":object(json!({"ref":{"type":"string","pattern":"^new:[A-Za-z0-9_-]+$","maxLength":132},"name":string,"evidence":ids}), &["ref","name","evidence"])}}),
                &["operationId", "expectedRevision", "characters"],
            ),
        ),
        (
            "patch_annotations",
            "Atomically assign each segment label to its explicit pieces IDs (unordered, non-adjacent allowed). Only consecutive supplied IDs become coordinate ranges; no expansion, fill or semantic guessing. Every piece may appear only once in the entire batch, even within or between identical labels. Duplicate assignments reject the whole batch and report up to 16 conflict groups. Stale revisions require unchanged target pieces. Existing segments cannot be partially overwritten. Returns revision or actionable validation error; no partial write.",
            object(
                json!({"operationId":string,"expectedRevision":{"type":"integer","minimum":0},"segments":{"type":"array","items":segment,"minItems":1}}),
                &["operationId", "expectedRevision", "segments"],
            ),
        ),
        (
            "check_draft",
            "Check complete source coverage and report missing piece IDs. It cannot certify semantic correctness.",
            object(json!({}), &[]),
        ),
        (
            "finish_analysis",
            "Finalize a structurally valid draft; if incomplete returns missing IDs for repair. For review submit issues referring to candidate rN IDs without changing candidate. Call separately as the final operation with the latest revision. Never publishes or confirms human state.",
            object(
                json!({"expectedRevision":{"type":"integer","minimum":0},"issues":{"type":"array","items":object(json!({"targetId":string,"suggestion":suggestion}),&["targetId","suggestion"])}}),
                &["expectedRevision"],
            ),
        ),
    ]
}
pub(super) fn dynamic_tools(draft: SharedDraft) -> Result<Vec<DynamicTool>> {
    let definitions = draft
        .lock()
        .map_err(|_| anyhow::anyhow!("draft_lock"))?
        .definitions();
    definitions
        .into_iter()
        .map(|(name, description, schema)| {
            let state = Arc::clone(&draft);
            Ok(DynamicTool::new(
                ToolName::new(name)?,
                description,
                schema,
                move |args| {
                    let state = Arc::clone(&state);
                    Box::pin(async move {
                        let value = match state.lock() {
                            Ok(mut d) => d.call(name, args),
                            Err(_) => json!({"ok":false,"error":"draft_lock"}),
                        };
                        Ok(ToolOutput::json(value))
                    })
                },
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests;
