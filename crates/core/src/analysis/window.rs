//! One bounded window. Invalid candidates never change chapter state.
use super::{
    AnalysisError, AnalysisFailureDiagnostics, AnalysisInput, AnalysisModel, AnalysisOptions,
    CancellationToken, protocol, suggestions,
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
    diagnostics: &mut AnalysisFailureDiagnostics,
) -> Result<suggestions::ValidatedWindow, AnalysisError> {
    let references = super::references::References::new(&window);
    let mut feedback: Option<(super::SuggestionIssue, String)> = None;
    let mut repairs = 0;
    loop {
        check_progress(cancel, deadline)?;
        // Reserve one initial call for every remaining window.
        if diagnostics.stats.requests
            >= options
                .max_requests
                .saturating_sub(window.remaining_windows)
        {
            return Err(AnalysisError::Budget("request count"));
        }
        let mut request =
            protocol::build_request(&window, options.max_output_tokens, options.evidence_mode);
        if let Some((issue, candidate)) = &feedback {
            protocol::add_feedback(
                &mut request,
                &references.feedback(issue),
                candidate,
                options.max_input_bytes,
            )?;
        }
        if request.system.len().saturating_add(request.user.len()) > options.max_input_bytes {
            return Err(AnalysisError::Budget("input bytes"));
        }
        check_progress(cancel, deadline)?;
        let generate = async {
            if feedback.is_some() {
                diagnostics
                    .window
                    .as_mut()
                    .expect("window context")
                    .repairs_attempted += 1;
            }
            model.generate(request).await
        };
        let response = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(AnalysisError::Cancelled),
            _ = tokio::time::sleep_until(deadline) => return Err(AnalysisError::ChapterTimeout),
            result = tokio::time::timeout(options.request_timeout, generate) => {
                result.map_err(|_| AnalysisError::Timeout)??
            },
        };
        // Record every received response, even when its candidate is rejected.
        diagnostics.stats.requests += 1;
        diagnostics.stats.usage.push(response.usage);
        diagnostics.stats.response_bytes.push(response.text.len());
        if feedback.is_some() {
            diagnostics.stats.repair_requests += 1;
        }
        check_progress(cancel, deadline)?;
        if response.truncated {
            return Err(AnalysisError::Suggestion("truncated response"));
        }
        if response.text.len() > options.max_response_bytes {
            return Err(AnalysisError::Budget("response bytes"));
        }
        let validation = suggestions::parse(&response.text)
            .and_then(|s| references.decode(s))
            .and_then(|suggestion| {
                suggestions::validate(suggestion, &window, options.evidence_mode)
            });
        if let Err(issue) = &validation {
            let current = diagnostics.window.as_mut().expect("window context");
            current.issue = Some(issue.clone());
            current.validation_issues.push(issue.clone());
            current.missing_targets = current
                .targets
                .iter()
                .filter(|target| issue.missing_segment_ids().contains(&target.segment_id))
                .cloned()
                .collect();
            current.repair_exhausted = repairs >= options.max_repairs_per_window;
        }
        check_progress(cancel, deadline)?;
        match validation {
            Ok(validated) => {
                if feedback.is_some() {
                    diagnostics.stats.repaired_windows += 1;
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
