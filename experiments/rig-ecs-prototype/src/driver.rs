//! Frozen inputs, bounded turns, host validation, read-only review and conservative recovery.
use crate::{
    backend::{Backend, DispatchRuntime},
    contract::*,
    journal::*,
    kernel::*,
};
use anyhow::{Result, ensure};
use rig_core::test_utils::MockStreamEvent;
use rig_ecs::prelude::{Entity, TurnOutcome};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, atomic::Ordering},
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Script {
    pub analysis: Vec<Vec<MockStreamEvent>>,
    pub review: Vec<MockStreamEvent>,
    #[serde(default = "default_delays")]
    pub delay_ms: Vec<u64>,
}
fn default_delays() -> Vec<u64> {
    vec![30, 30, 30, 30]
}
#[derive(Clone)]
pub(crate) struct Options {
    pub deadline: Duration,
    pub cancel_after: Option<Duration>,
    pub cancellation: Option<Arc<std::sync::atomic::AtomicBool>>,
    pub barrier: bool,
    pub code_revision: String,
    pub dataset_hash: String,
    pub dataset_version: String,
    /// Fault injection: leave the durable in-flight intent after this many validated children.
    pub interrupt_after: Option<usize>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub version: u32,
    pub case_id: String,
    pub route: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_kind: Option<String>,
    pub segments: Vec<Segment>,
    pub review: Value,
    pub trace: Vec<Span>,
    pub execution_mode: String,
    pub mode: String,
    pub request_count: usize,
    pub max_concurrency: usize,
    pub cancelled_futures: usize,
    pub kernel_effect_ids: Vec<u64>,
    pub reused_subresults: usize,
    pub diagnostics: Vec<String>,
    pub identity_scope: String,
    pub identity_discovery_evaluated: bool,
}
struct Context<'a> {
    case: &'a Case,
    options: &'a Options,
    config_hash: String,
    backend: &'a Backend,
}
impl Context<'_> {
    fn span(
        &self,
        journal: &mut Journal,
        stage: &str,
        parent: Option<String>,
        status: &str,
        prompt: &str,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        journal.trace.push(Span {
            run_id: journal.run_id.clone(),
            span_id: id.clone(),
            parent_span_id: parent,
            stage: stage.into(),
            route: "rig-ecs".into(),
            attempt: 1,
            status: status.into(),
            started_at: time::OffsetDateTime::now_utc()
                .format(time::macros::format_description!(
                    "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:6]Z"
                ))
                .unwrap_or_else(|_| "unavailable".into()),
            started_unix_ms: rig_core::now_ms(),
            elapsed_ms: 0,
            elapsed_ms_is_lower_bound: false,
            is_request: matches!(stage, "analysis" | "review"),
            metadata: matches!(stage, "analysis" | "review").then(|| Metadata {
                model: self.backend.model().into(),
                boundary_mode: self.backend.execution_mode().into(),
                capabilities_verified: false,
                configuration_hash: self.config_hash.clone(),
                prompt_version: PROMPT_VERSION.into(),
                prompt_hash: hash(prompt.as_bytes()),
                protocol_version: PROTOCOL_VERSION.into(),
                source_hash: self.case.source.sha256.clone(),
                dataset_hash: self.options.dataset_hash.clone(),
                dataset_version: self.options.dataset_version.clone(),
                code_revision: self.options.code_revision.clone(),
                identity_scope: "known-only".into(),
                character_snapshot_hash: hash(
                    &serde_json::to_vec(&self.case.characters).unwrap_or_default(),
                ),
            }),
            usage: Usage::default(),
        });
        id
    }
}
fn finish(journal: &mut Journal, id: &str, status: &str) {
    if let Some(span) = journal.trace.iter_mut().find(|s| s.span_id == id) {
        span.status = status.into();
        span.elapsed_ms = rig_core::now_ms().saturating_sub(span.started_unix_ms);
    }
}

pub(crate) fn run(
    case: &Case,
    script: &Script,
    options: &Options,
    path: &Path,
    runtime: tokio::runtime::Handle,
) -> Result<Report> {
    run_backend(
        case,
        &Backend::Controlled(script.clone()),
        options,
        path,
        runtime,
    )
}

pub(crate) fn run_backend(
    case: &Case,
    backend: &Backend,
    options: &Options,
    path: &Path,
    runtime: tokio::runtime::Handle,
) -> Result<Report> {
    // Declared before Kernel: on errors, the kernel drops first, then supervised helpers drain.
    struct Drain<'a>(&'a Backend);
    impl Drop for Drain<'_> {
        fn drop(&mut self) {
            let _ = self.0.drain();
        }
    }
    let _drain = Drain(backend);
    let _lock = crate::journal::lock(path)?;
    case.validate()?;
    let review_only = case.evaluation_task == "review";
    if let Some(input) = &case.review_input {
        case.validate_segments(
            &input.segments,
            Range {
                start: 0,
                end: case.source.text.len(),
            },
        )?;
    }
    backend.validate()?;
    ensure!(!options.deadline.is_zero(), "deadline_must_be_positive");
    let config_hash = backend.configuration_hash()?;
    let context = Context {
        case,
        options,
        config_hash,
        backend,
    };
    let fingerprint = hash(&serde_json::to_vec(
        &json!({"case":case,"configurationHash":context.config_hash,"promptHash":hash(format!("{ANALYSIS_PROMPT}{REVIEW_PROMPT}").as_bytes()),"protocol":PROTOCOL_VERSION,"code":options.code_revision,"dataset":options.dataset_hash,"datasetVersion":options.dataset_version,"boundary":backend.fingerprint()?,"execution":{"deadlineMs":options.deadline.as_millis(),"barrier":options.barrier,"concurrency":3}}),
    )?);
    let mut journal = if path.exists() {
        Journal::load(path, &fingerprint)?
    } else {
        Journal {
            version: 1,
            fingerprint,
            run_id: Uuid::new_v4().to_string(),
            slots: vec![Slot::default(); 4],
            trace: Vec::new(),
        }
    };
    let shards = case.shards();
    // Never trust cached annotations solely because a checkpoint parsed.
    for (i, slot) in journal.slots.iter().enumerate() {
        if !review_only && slot.state == State::Completed && i < 3 {
            case.validate_segments(
                &slot
                    .analysis
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("checkpoint_missing_analysis"))?
                    .segments,
                shards[i],
            )?;
        }
    }
    let reused = journal.slots[..3]
        .iter()
        .filter(|s| !review_only && s.state == State::Completed)
        .count();
    let root = context.span(&mut journal, "run", None, "running", "");
    let prepare = context.span(&mut journal, "prepare", Some(root.clone()), "completed", "");
    finish(&mut journal, &prepare, "completed");
    let began = Instant::now();
    let identity = context.span(
        &mut journal,
        "identity",
        Some(root.clone()),
        "completed",
        "",
    );
    finish(&mut journal, &identity, "completed");
    journal.save(path)?;
    let counters = Arc::new(Counters::default());
    let mut kernel = Kernel::new();
    let pending = journal.slots[..3]
        .iter()
        .filter(|s| s.state == State::Pending)
        .count();
    let barrier =
        (options.barrier && pending > 0).then(|| Arc::new(tokio::sync::Barrier::new(pending)));
    let analysis_group = context.span(
        &mut journal,
        if review_only {
            "review_prepare"
        } else {
            "analysis_group"
        },
        Some(root.clone()),
        "running",
        ANALYSIS_PROMPT,
    );
    let mut running = HashMap::<Entity, usize>::new();
    let mut diagnostics = Vec::new();
    let mut models = Vec::new();
    for (i, shard) in shards.iter().enumerate() {
        if review_only || journal.slots[i].state != State::Pending {
            continue;
        }
        let payload = serde_json::to_string(
            &json!({"sourceHash":case.source.sha256,"characters":case.characters,"range":shard,"source":case.source.text}),
        )?;
        let span = context.span(
            &mut journal,
            "analysis",
            Some(analysis_group.clone()),
            "running",
            ANALYSIS_PROMPT,
        );
        journal.slots[i].state = State::InFlight;
        journal.slots[i].span_id = Some(span);
        journal.save(path)?; // Durable intent precedes Deliver, even if the process exits immediately after this write.
        let (entity, model) = backend.launch(
            &mut kernel,
            i,
            ANALYSIS_PROMPT,
            payload,
            DispatchRuntime {
                runtime: runtime.clone(),
                counters: Arc::clone(&counters),
                barrier: barrier.clone(),
            },
        )?;
        running.insert(entity, i);
        if let Some(model) = model {
            models.push(model);
        }
    }
    let mut cancelled = false;
    let mut timed_out = false;
    let mut interrupted = false;
    while !running.is_empty() {
        kernel.tick();
        let done: Vec<_> = running
            .iter()
            .filter_map(|(entity, i)| kernel.take(*entity).map(|outcome| (*entity, *i, outcome)))
            .collect();
        for (entity, i, outcome) in done {
            running.remove(&entity);
            let span = journal.slots[i]
                .span_id
                .clone()
                .ok_or_else(|| anyhow::anyhow!("missing_span"))?;
            if let Some(usage) = kernel.usage(entity)
                && let Some(s) = journal.trace.iter_mut().find(|s| s.span_id == span)
            {
                s.usage = Usage::from(&usage);
            }
            let result = match outcome {
                TurnOutcome::Answered(message) => message
                    .final_answer()
                    .ok_or_else(|| anyhow::anyhow!("missing_answer"))
                    .and_then(|text| {
                        serde_json::from_str::<Analysis>(&text)
                            .map_err(|_| anyhow::anyhow!("analysis_json"))
                    })
                    .and_then(|output| {
                        case.validate_segments(&output.segments, shards[i])?;
                        Ok(output)
                    }),
                TurnOutcome::Failed(_) => Err(anyhow::anyhow!("model_failed")),
                TurnOutcome::Stopped(_) => Err(anyhow::anyhow!("model_stopped")),
            };
            match result {
                Ok(output) => {
                    journal.slots[i].state = State::Completed;
                    journal.slots[i].analysis = Some(output);
                    finish(&mut journal, &span, "completed");
                }
                Err(error) => {
                    journal.slots[i].state = if backend.request_unknown(i) {
                        State::Unknown
                    } else {
                        State::Failed
                    };
                    diagnostics.push(error.to_string());
                    finish(
                        &mut journal,
                        &span,
                        if backend.timed_out() {
                            "timeout"
                        } else {
                            "failed"
                        },
                    );
                }
            }
            journal.save(path)?;
        }
        if options.interrupt_after.is_some_and(|n| {
            journal.slots[..3]
                .iter()
                .filter(|s| s.state == State::Completed)
                .count()
                >= n
        }) && !running.is_empty()
        {
            interrupted = true;
            break; // Fault-injection: deliberately preserve in-flight intent, simulating a lost process.
        }
        cancelled = options
            .cancellation
            .as_ref()
            .is_some_and(|c| c.load(Ordering::SeqCst))
            || options
                .cancel_after
                .is_some_and(|after| began.elapsed() >= after);
        timed_out = began.elapsed() >= options.deadline;
        if cancelled || timed_out {
            stop_running(
                &mut kernel,
                &mut running,
                &mut journal,
                timed_out,
                backend.is_native(),
                path,
            )?;
            break;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    if interrupted {
        for i in running.values() {
            if let Some(id) = journal.slots[*i].span_id.clone() {
                finish(&mut journal, &id, "interrupted");
                if let Some(span) = journal.trace.iter_mut().find(|s| s.span_id == id) {
                    span.elapsed_ms_is_lower_bound = true;
                }
            }
        }
    }
    let group_status = if interrupted {
        "interrupted"
    } else if cancelled {
        "cancelled"
    } else if timed_out {
        "timeout"
    } else if review_only
        || journal.slots[..3]
            .iter()
            .all(|s| s.state == State::Completed)
    {
        "completed"
    } else {
        "failed"
    };
    finish(&mut journal, &analysis_group, group_status);
    let mut segments = Vec::new();
    let all_complete = review_only
        || journal.slots[..3]
            .iter()
            .all(|s| s.state == State::Completed);
    if all_complete && !cancelled && !timed_out && !interrupted {
        segments = if review_only {
            case.review_input
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("review_requires_candidate"))?
                .segments
                .clone()
        } else {
            journal.slots[..3]
                .iter()
                .filter_map(|s| s.analysis.as_ref())
                .flat_map(|a| a.segments.iter().cloned())
                .collect()
        };
        let validation = context.span(
            &mut journal,
            "validation",
            Some(root.clone()),
            "running",
            "",
        );
        case.validate_segments(
            &segments,
            Range {
                start: 0,
                end: case.source.text.len(),
            },
        )?;
        finish(&mut journal, &validation, "completed");
        let review_segments = case
            .review_input
            .as_ref()
            .map_or(segments.as_slice(), |input| input.segments.as_slice());
        case.validate_segments(
            review_segments,
            Range {
                start: 0,
                end: case.source.text.len(),
            },
        )?;
        if journal.slots[3].state == State::Pending {
            let payload = serde_json::to_string(
                &json!({"sourceHash":case.source.sha256,"source":case.source.text,"characters":case.characters,"segments":review_segments,"targets":review_segments.iter().enumerate().map(|(i,s)|json!({"id":format!("s{}",i+1),"start":s.start,"end":s.end})).collect::<Vec<_>>()}),
            )?;
            let span = context.span(
                &mut journal,
                "review",
                Some(root.clone()),
                "running",
                REVIEW_PROMPT,
            );
            journal.slots[3].state = State::InFlight;
            journal.slots[3].span_id = Some(span.clone());
            journal.save(path)?;
            let (entity, model) = backend.launch(
                &mut kernel,
                3,
                REVIEW_PROMPT,
                payload,
                DispatchRuntime {
                    runtime: runtime.clone(),
                    counters: Arc::clone(&counters),
                    barrier: None,
                },
            )?;
            if let Some(model) = model {
                models.push(model);
            }
            loop {
                kernel.tick();
                if let Some(outcome) = kernel.take(entity) {
                    if let Some(usage) = kernel.usage(entity)
                        && let Some(s) = journal.trace.iter_mut().find(|s| s.span_id == span)
                    {
                        s.usage = Usage::from(&usage);
                    }
                    let result = match outcome {
                        TurnOutcome::Answered(message) => message
                            .final_answer()
                            .ok_or_else(|| anyhow::anyhow!("missing_review"))
                            .and_then(|text| {
                                serde_json::from_str::<Review>(&text)
                                    .map_err(|_| anyhow::anyhow!("review_json"))
                            })
                            .and_then(|review| {
                                case.validate_review(&review, review_segments)?;
                                Ok(review)
                            }),
                        _ => Err(anyhow::anyhow!("review_model_failed")),
                    };
                    match result {
                        Ok(review) => {
                            journal.slots[3].review = Some(review);
                            journal.slots[3].state = State::Completed;
                            finish(&mut journal, &span, "completed");
                        }
                        Err(error) => {
                            diagnostics.push(error.to_string());
                            journal.slots[3].state = if backend.request_unknown(3) {
                                State::Unknown
                            } else {
                                State::Failed
                            };
                            finish(
                                &mut journal,
                                &span,
                                if backend.timed_out() {
                                    "timeout"
                                } else {
                                    "failed"
                                },
                            );
                        }
                    }
                    break;
                }
                cancelled = options
                    .cancellation
                    .as_ref()
                    .is_some_and(|c| c.load(Ordering::SeqCst))
                    || options
                        .cancel_after
                        .is_some_and(|after| began.elapsed() >= after);
                timed_out = began.elapsed() >= options.deadline;
                if cancelled || timed_out {
                    running.insert(entity, 3);
                    stop_running(
                        &mut kernel,
                        &mut running,
                        &mut journal,
                        timed_out,
                        backend.is_native(),
                        path,
                    )?;
                    break;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        if journal.slots[3].state == State::Completed {
            case.validate_review(
                journal.slots[3]
                    .review
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("checkpoint_missing_review"))?,
                review_segments,
            )?;
        }
    }
    timed_out |= backend.timed_out();
    let status = if cancelled {
        "cancelled"
    } else if timed_out {
        "failed"
    } else if interrupted
        || journal
            .slots
            .iter()
            .any(|s| matches!(s.state, State::Unknown | State::InFlight))
    {
        "interrupted"
    } else if cancelled || journal.slots.iter().any(|s| s.state == State::Cancelled) {
        "cancelled"
    } else if !timed_out
        && journal.slots[3].state == State::Completed
        && (review_only
            || journal.slots[..3]
                .iter()
                .all(|s| s.state == State::Completed))
    {
        "completed"
    } else {
        "failed"
    };
    finish(&mut journal, &root, status);
    journal.save(path)?;
    // Inspect actual model requests: all three share exactly the frozen character snapshot and no gold.
    for model in &models {
        for request in model.requests() {
            ensure!(request.tools.is_empty(), "read_only_tools");
        }
    }
    // Local tasks must be aborted before the caller may release its runtime/connection.
    kernel.stop();
    let effect_ids = kernel.effect_ids();
    drop(kernel);
    let drain = Instant::now();
    while counters.active.load(Ordering::SeqCst) > 0 && drain.elapsed() < Duration::from_secs(1) {
        std::thread::sleep(Duration::from_millis(1));
    }
    ensure!(
        counters.active.load(Ordering::SeqCst) == 0,
        "local_requests_not_drained"
    );
    backend.drain()?;
    let review = if let Some(review) = &journal.slots[3].review {
        json!({"status":"completed","humanReviewStatus":"unreviewed","issues":review.issues})
    } else {
        json!({"status":"not_completed","issues":[]})
    };
    Ok(Report {
        version: 1,
        case_id: case.case_id.clone(),
        route: "rig-ecs".into(),
        status: status.into(),
        failure_kind: if timed_out || journal.slots.iter().any(|s| s.state == State::TimedOut) {
            Some("timeout".into())
        } else if diagnostics
            .iter()
            .any(|d| matches!(d.as_str(), "analysis_json" | "review_json"))
        {
            Some("parse".into())
        } else {
            None
        },
        segments,
        review,
        trace: journal.trace,
        execution_mode: backend.execution_mode().into(),
        mode: backend.mode().into(),
        request_count: counters.calls.load(Ordering::SeqCst),
        max_concurrency: counters.peak.load(Ordering::SeqCst),
        cancelled_futures: counters.dropped.load(Ordering::SeqCst),
        kernel_effect_ids: effect_ids,
        reused_subresults: reused,
        diagnostics,
        identity_scope: "known-only".into(),
        identity_discovery_evaluated: false,
    })
}
fn stop_running(
    kernel: &mut Kernel,
    running: &mut HashMap<Entity, usize>,
    journal: &mut Journal,
    timed_out: bool,
    native: bool,
    path: &Path,
) -> Result<()> {
    kernel.stop();
    for (entity, i) in running.drain() {
        ensure!(
            matches!(kernel.take(entity), Some(TurnOutcome::Stopped(_))),
            "parent_cancel_did_not_propagate"
        );
        journal.slots[i].state = if native {
            State::Unknown
        } else if timed_out {
            State::TimedOut
        } else {
            State::Cancelled
        };
        if let Some(span) = journal.slots[i].span_id.clone() {
            finish(
                journal,
                &span,
                if timed_out { "timeout" } else { "cancelled" },
            );
        }
    }
    journal.save(path)
}
