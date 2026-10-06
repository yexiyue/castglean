//! One bounded window. Invalid candidates never change chapter state.
use super::{
    AnalysisError, AnalysisInput, AnalysisModel, AnalysisOptions, AnalysisStats, CancellationToken,
    protocol, suggestions,
};
use crate::{CharacterRegistry, Segment};
use std::ops::Range;
use tokio::time::Instant;

pub(super) struct WindowContext<'a, 'source> {
    pub input: &'a AnalysisInput<'source>,
    pub index: usize,
    pub target: Range<usize>,
    pub visible: Range<usize>,
    pub registry: &'a CharacterRegistry,
    pub segments: &'a [Segment],
    pub remaining_windows: usize,
}

pub(super) fn check_progress(
    cancel: &CancellationToken,
    deadline: Instant,
) -> Result<(), AnalysisError> {
    if cancel.is_cancelled() {
        Err(AnalysisError::Cancelled)
    } else if Instant::now() >= deadline {
        Err(AnalysisError::ChapterTimeout)
    } else {
        Ok(())
    }
}

pub(super) async fn execute<M: AnalysisModel>(
    model: &M,
    window: WindowContext<'_, '_>,
    options: &AnalysisOptions,
    cancel: &CancellationToken,
    deadline: Instant,
    stats: &mut AnalysisStats,
) -> Result<suggestions::ValidatedWindow, AnalysisError> {
    let mut feedback: Option<(super::SuggestionIssue, String)> = None;
    let mut repairs = 0;
    loop {
        check_progress(cancel, deadline)?;
        // Reserve one initial call for every remaining window.
        if stats.requests
            >= options
                .max_requests
                .saturating_sub(window.remaining_windows)
        {
            return Err(AnalysisError::Budget("request count"));
        }
        let mut request = protocol::build_request(
            &window.input.source,
            window.segments,
            window.registry,
            &window.target,
            &window.visible,
            options.max_output_tokens,
        );
        if let Some((issue, candidate)) = &feedback {
            protocol::add_feedback(&mut request, issue, candidate, options.max_input_bytes)?;
        }
        if request.system.len().saturating_add(request.user.len()) > options.max_input_bytes {
            return Err(AnalysisError::Budget("input bytes"));
        }
        check_progress(cancel, deadline)?;
        let response = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(AnalysisError::Cancelled),
            _ = tokio::time::sleep_until(deadline) => return Err(AnalysisError::ChapterTimeout),
            result = tokio::time::timeout(options.request_timeout, model.generate(request)) => {
                result.map_err(|_| AnalysisError::Timeout)??
            },
        };
        // Record every received response, even when its candidate is rejected.
        stats.requests += 1;
        stats.usage.push(response.usage);
        stats.response_bytes.push(response.text.len());
        if feedback.is_some() {
            stats.repair_requests += 1;
        }
        check_progress(cancel, deadline)?;
        if response.truncated {
            return Err(AnalysisError::Suggestion("truncated response"));
        }
        if response.text.len() > options.max_response_bytes {
            return Err(AnalysisError::Budget("response bytes"));
        }
        let validation = suggestions::parse(&response.text).and_then(|suggestion| {
            suggestions::validate(
                suggestion,
                window.input,
                window.index,
                &window.target,
                &window.visible,
                window.registry,
                window.segments,
            )
        });
        check_progress(cancel, deadline)?;
        match validation {
            Ok(validated) => {
                if feedback.is_some() {
                    stats.repaired_windows += 1;
                }
                return Ok(validated);
            }
            Err(issue) if options.max_repairs_per_window == 0 => {
                return Err(AnalysisError::Suggestion(issue.code().message()));
            }
            Err(issue) if repairs >= options.max_repairs_per_window => {
                return Err(AnalysisError::RepairExhausted(issue));
            }
            Err(issue) => {
                repairs += 1;
                feedback = Some((issue, response.text));
            }
        }
    }
}
