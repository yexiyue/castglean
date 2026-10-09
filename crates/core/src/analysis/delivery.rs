//! Stable prefix delivery, independent of persistence and speech execution.
use super::{AnalysisError, AnalysisInput, AnalysisOptions, CancellationToken, WorkflowFailure};
use crate::{Attribution, BookId, ChapterId, Character, CharacterRegistry, EvidenceRef, Segment};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fmt, future::Future, ops::Range};
use tokio::time::Instant;

/// Digest binding a host execution key to the source, context and analysis options.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, schemars::JsonSchema)]
#[serde(transparent)]
pub struct AnalysisRunId(#[schemars(pattern(r"^[0-9a-f]{64}$"))] String);
impl AnalysisRunId {
    /// Exact digest; this is an execution identity, not a persistence receipt.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Owned, read-only continuous batch produced only after application validation.
///
/// The consumer must already have the full source and validated input context.
/// Evidence can refer to earlier batches or chapters in that context. This is
/// not a `ValidatedChapter`, a durable commit, or permission to seal a speech plan.
#[derive(Clone, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AcceptedPrefixBatch {
    #[schemars(range(min = 1, max = 1))]
    format_version: u32,
    run_id: AnalysisRunId,
    #[schemars(range(min = 1))]
    sequence: usize,
    book_id: BookId,
    chapter_id: ChapterId,
    #[schemars(pattern(r"^[0-9a-f]{64}$"))]
    source_sha256: String,
    #[schemars(range(min = 1))]
    base_revision: u64,
    #[schemars(length(min = 1))]
    segments: Vec<Segment>,
    characters: Vec<Character>,
}
impl AcceptedPrefixBatch {
    /// Execution identity, unchanged across all batches of this call.
    pub fn run_id(&self) -> &AnalysisRunId {
        &self.run_id
    }
    /// One-based, consecutive delivery sequence; not a registry revision.
    pub fn sequence(&self) -> usize {
        self.sequence
    }
    /// Owning book identity.
    pub fn book_id(&self) -> &BookId {
        &self.book_id
    }
    /// Chapter identity.
    pub fn chapter_id(&self) -> &ChapterId {
        &self.chapter_id
    }
    /// Digest of the complete normalized source, including unaccepted suffixes.
    pub fn source_sha256(&self) -> &str {
        &self.source_sha256
    }
    /// Input registry revision; the final result may have a different revision.
    pub fn base_revision(&self) -> u64 {
        self.base_revision
    }
    /// Continuous, nonempty UTF-8 range newly delivered by this batch.
    pub fn range(&self) -> Range<usize> {
        self.segments[0].start..self.segments.last().expect("nonempty batch").end
    }
    /// Stable annotations. Concatenate source slices exactly once in this order.
    pub fn segments(&self) -> &[Segment] {
        &self.segments
    }
    /// Definitions of every character referenced by the accepted prefix, in registry order.
    pub fn characters(&self) -> &[Character] {
        &self.characters
    }
}

/// Safe consumer failure category; arbitrary host error strings are not retained.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DeliveryError {
    /// The host no longer accepts input.
    #[error("analysis consumer closed")]
    Closed,
    /// The host explicitly rejected a batch.
    #[error("analysis consumer rejected batch")]
    Rejected,
}

/// Host-owned asynchronous handoff. No internal queue, task or runtime is created.
///
/// Accept atomically and return `Ok(())` only after acceptance. The future can be
/// dropped on cancellation/deadline; any side effects already performed remain
/// possible. Gate late batches by run identity and stop/replace old executions.
pub trait AnalysisConsumer: Send {
    /// Await bounded host acceptance; failures stop further model calls.
    fn accept(
        &mut self,
        batch: AcceptedPrefixBatch,
    ) -> impl Future<Output = Result<(), DeliveryError>> + Send;
}

/// Conservative acknowledgment progress, independent of model/window statistics.
#[derive(Clone, Debug, Default, Serialize)]
pub struct DeliveryProgress {
    run_id: Option<AnalysisRunId>,
    confirmed_batches: usize,
    confirmed_end: usize,
    offered_end: Option<usize>,
}
impl DeliveryProgress {
    /// Absent if preparation failed before establishing execution identity.
    pub fn run_id(&self) -> Option<&AnalysisRunId> {
        self.run_id.as_ref()
    }
    /// Number of batches acknowledged by the consumer.
    pub fn confirmed_batches(&self) -> usize {
        self.confirmed_batches
    }
    /// Last acknowledged byte endpoint, a lower bound on possible host effects.
    pub fn confirmed_end(&self) -> usize {
        self.confirmed_end
    }
    /// Endpoint offered but not acknowledged; the host may already have side effects.
    pub fn offered_end(&self) -> Option<usize> {
        self.offered_end
    }
}

/// Complete result and the progress of this particular delivery execution.
pub struct IncrementalResult<R = super::AnalysisResult> {
    /// Only available after all final workflow checks succeed.
    pub result: R,
    /// Acknowledged prefix; success covers the whole chapter.
    pub delivery: DeliveryProgress,
}
/// Original workflow failure plus safe diagnostic and handoff progress.
#[derive(Debug)]
pub struct IncrementalFailure<E = AnalysisError> {
    pub(crate) failure: Box<WorkflowFailure<E>>,
    pub(crate) delivery: DeliveryProgress,
    pub(crate) completed_stats: Option<Box<super::AnalysisStats>>,
}
impl<E> IncrementalFailure<E> {
    /// Original typed workflow error.
    pub fn error(&self) -> &E {
        self.failure.error()
    }
    /// Analysis statistics and safe window context, when analysis started.
    pub fn diagnostics(&self) -> Option<&super::AnalysisFailureDiagnostics> {
        self.failure.diagnostics()
    }
    /// Received-response statistics, also retained if a later book operation fails.
    pub fn stats(&self) -> Option<&super::AnalysisStats> {
        self.diagnostics()
            .map(|d| d.stats())
            .or(self.completed_stats.as_deref())
    }
    /// Acknowledged and unacknowledged handoff positions at failure.
    pub fn delivery(&self) -> &DeliveryProgress {
        &self.delivery
    }
    /// Recover the original failure; this discards delivery progress.
    pub fn into_error(self) -> E {
        (*self.failure).into_error()
    }
    pub(crate) fn map<F>(self, f: impl FnOnce(E) -> F) -> IncrementalFailure<F> {
        IncrementalFailure {
            failure: Box::new((*self.failure).map(f)),
            delivery: self.delivery,
            completed_stats: self.completed_stats,
        }
    }
}
impl<E: fmt::Display> fmt::Display for IncrementalFailure<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.failure.fmt(f)
    }
}
impl<E: std::error::Error + 'static> std::error::Error for IncrementalFailure<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.error())
    }
}

pub(super) struct NoConsumer;
impl AnalysisConsumer for NoConsumer {
    async fn accept(&mut self, _: AcceptedPrefixBatch) -> Result<(), DeliveryError> {
        Ok(())
    }
}
pub(super) struct DeliveryContext<'a, C> {
    pub key: &'a str,
    pub consumer: &'a mut C,
    pub progress: DeliveryProgress,
    published_segments: usize,
}
impl<'a, C: AnalysisConsumer> DeliveryContext<'a, C> {
    pub fn new(key: &'a str, consumer: &'a mut C) -> Self {
        Self {
            key,
            consumer,
            progress: DeliveryProgress::default(),
            published_segments: 0,
        }
    }
    pub fn prepare(
        &mut self,
        input: &AnalysisInput<'_>,
        options: &AnalysisOptions,
    ) -> Result<(), AnalysisError> {
        if self.key.trim().is_empty() {
            return Err(AnalysisError::Context("execution key must not be blank"));
        }
        let context = input.context.map(|b| {
            (
                b.registry(),
                b.chapters()
                    .iter()
                    .map(|c| c.annotations())
                    .collect::<Vec<_>>(),
            )
        });
        let binding = serde_json::to_vec(&(
            self.key,
            &input.book_id,
            &input.chapter_id,
            input.source.metadata(),
            context,
            options,
        ))
        .map_err(|_| AnalysisError::Context("cannot bind delivery execution"))?;
        self.progress.run_id = Some(AnalysisRunId(format!("{:x}", Sha256::digest(binding))));
        Ok(())
    }
    pub async fn publish(
        &mut self,
        input: &AnalysisInput<'_>,
        registry: &CharacterRegistry,
        accepted: &[Segment],
        cancel: &CancellationToken,
        deadline: Instant,
    ) -> Result<(), AnalysisError> {
        if accepted.len() == self.published_segments {
            return Ok(());
        }
        let Some(characters) = resolvable_characters(input, registry, accepted)? else {
            return Ok(());
        };
        super::window::check_progress(cancel, deadline)?;
        let segments = accepted[self.published_segments..].to_vec();
        if segments[0].start != self.progress.confirmed_end {
            return Err(AnalysisError::Context("noncontiguous delivery"));
        }
        let end = segments.last().expect("nonempty delivery").end;
        let batch = AcceptedPrefixBatch {
            format_version: 1,
            run_id: self.progress.run_id.clone().expect("prepared delivery"),
            sequence: self.progress.confirmed_batches + 1,
            book_id: input.book_id.clone(),
            chapter_id: input.chapter_id.clone(),
            source_sha256: input.source.metadata().sha256.clone(),
            base_revision: input.context.map_or(1, |b| b.registry().revision),
            segments,
            characters,
        };
        let accept = async {
            self.progress.offered_end = Some(end);
            self.consumer.accept(batch).await
        };
        tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(AnalysisError::Cancelled),
            _ = tokio::time::sleep_until(deadline) => return Err(AnalysisError::ChapterTimeout),
            result = accept => result.map_err(AnalysisError::Delivery)?,
        }
        self.progress.confirmed_batches += 1;
        self.progress.confirmed_end = end;
        self.progress.offered_end = None;
        self.published_segments = accepted.len();
        super::window::check_progress(cancel, deadline)
    }
}

// None means that evidence is valid but still belongs to an unaccepted suffix.
fn resolvable_characters(
    input: &AnalysisInput<'_>,
    registry: &CharacterRegistry,
    accepted: &[Segment],
) -> Result<Option<Vec<Character>>, AnalysisError> {
    let visible: HashSet<_> = accepted.iter().map(|s| &s.id).collect();
    let evidence_available = |e: &EvidenceRef| {
        if e.chapter_id == input.chapter_id {
            visible.contains(&e.segment_id)
        } else {
            input.context.is_some_and(|b| {
                b.chapters().iter().any(|c| {
                    c.annotations().chapter_id == e.chapter_id
                        && c.annotations()
                            .segments
                            .iter()
                            .any(|s| s.id == e.segment_id)
                })
            })
        }
    };
    // Check the entire prefix, including protected annotations restored from reanalysis.
    let mut ids = HashSet::new();
    for s in accepted {
        if let Some(a) = &s.attribution {
            if a.evidence().iter().any(|id| !visible.contains(id)) {
                return Ok(None);
            }
            match a {
                Attribution::Resolved { character_id, .. } => {
                    ids.insert(character_id);
                }
                Attribution::Ambiguous { candidate_ids, .. } => {
                    ids.extend(candidate_ids);
                }
                Attribution::Unknown { .. } => {}
            }
        }
    }
    let characters: Vec<_> = registry
        .characters
        .iter()
        .filter(|c| ids.contains(&c.id))
        .cloned()
        .collect();
    if characters.len() != ids.len() {
        return Err(AnalysisError::Context("unresolved prefix identity"));
    }
    if characters.iter().any(|c| {
        c.evidence
            .iter()
            .chain(c.voice_profile.iter().flat_map(|p| &p.evidence))
            .any(|e| !evidence_available(e))
    }) {
        return Ok(None);
    }
    Ok(Some(characters))
}

/// JSON shape of application-produced batches; parsing does not confer trust.
pub fn accepted_prefix_schema() -> schemars::Schema {
    schemars::schema_for!(AcceptedPrefixBatch)
}
