//! CLI-only configuration and new-artifact publication.
use crate::{
    cli::CliError,
    model_config::{self, Backend},
    publication::{ensure_absent, io_error, save},
};
use castglean_core::{
    AnalysisInput, AnalysisOptions, BookId, CancellationToken, ChapterId, SourceSnapshot,
    analyze_chapter_detailed,
};
use castglean_model::{GlmOutputMode, GlmReasoningEffort};
use clap::{Args, ValueEnum};

#[derive(Clone, Copy, Default, ValueEnum)]
enum EvidenceModeArg {
    #[default]
    SegmentIds,
    VerifiedQuotes,
}
use std::{fs, path::PathBuf, time::Duration};

#[derive(Args)]
pub(crate) struct AnalyzeArgs {
    /// Optional safe JSON report written only on analysis failure; never overwritten.
    #[arg(long)]
    failure_report: Option<PathBuf>,
    /// Source evidence policy; verified-quotes additionally checks exact quotations.
    #[arg(long, value_enum, default_value = "segment-ids")]
    evidence_mode: EvidenceModeArg,
    /// UTF-8 chapter input; line endings are normalized once.
    #[arg(long)]
    source: PathBuf,
    /// Opaque book identity.
    #[arg(long)]
    book: String,
    /// New chapter identity.
    #[arg(long)]
    chapter: String,
    /// New output directory; existing paths are never overwritten.
    #[arg(long)]
    output: PathBuf,
    /// Previous complete book snapshot; requires its expected revision.
    #[arg(long, requires = "expected_revision")]
    book_file: Option<PathBuf>,
    /// Current snapshot revision; required with --book-file.
    #[arg(long, requires = "book_file")]
    expected_revision: Option<u64>,
    /// Reanalyze only the final chapter, protecting human confirmations.
    #[arg(long, requires = "book_file")]
    reanalyze_last: bool,
    /// Explicit environment file; default is optional current-directory .env.
    #[arg(long)]
    env_file: Option<PathBuf>,
    /// Model backend: local, glm or minimax; overrides MODEL_BACKEND.
    #[arg(long, value_enum)]
    backend: Option<Backend>,
    /// GLM thinking budget: low, high or max; overrides REASONING_EFFORT.
    #[arg(long)]
    reasoning_effort: Option<GlmReasoningEffort>,
    /// GLM structured output: json, schema or tool; overrides OUTPUT_MODE.
    #[arg(long)]
    output_mode: Option<GlmOutputMode>,
    /// Maximum target characters per call (local: 1000, online: 3000).
    #[arg(long)]
    window_chars: Option<usize>,
    /// Maximum target segments per call (local: 8, online: 24).
    #[arg(long)]
    window_segments: Option<usize>,
    /// Maximum provider calls for this chapter.
    #[arg(long, default_value_t = 32)]
    max_requests: usize,
    /// Maximum generation tokens per call (local: 2048, online: 8192).
    #[arg(long)]
    max_output_tokens: Option<u32>,
    /// Per-call deadline in seconds.
    #[arg(long, default_value_t = 120)]
    timeout_secs: u64,
    /// Maximum corrective generations per window; zero disables repair.
    #[arg(long, default_value_t = 1)]
    max_repairs_per_window: usize,
    /// End-to-end chapter deadline in seconds.
    #[arg(long, default_value_t = 600)]
    chapter_timeout_secs: u64,
}
pub(crate) async fn run(args: AnalyzeArgs) -> Result<(), CliError> {
    ensure_absent(&args.output)?;
    crate::failure::check(args.failure_report.as_deref())?;
    let text = fs::read_to_string(&args.source).map_err(|source| io_error(&args.source, source))?;
    let input = AnalysisInput {
        book_id: BookId::new(args.book)?,
        chapter_id: ChapterId::new(args.chapter)?,
        source: SourceSnapshot::import(&text),
        context: None,
    };
    let state = args
        .book_file
        .as_deref()
        .map(crate::book::load)
        .transpose()?;
    if let Some(state) = &state {
        if state.book().registry().book_id != input.book_id {
            return Err(CliError::Config("book ID mismatch"));
        }
        let expected = args.expected_revision.expect("clap requires revision");
        if expected != state.revision() {
            return Err(castglean_core::BookError::Revision {
                expected,
                actual: state.revision(),
            }
            .into());
        }
    }
    let config = model_config::load(
        args.env_file.as_deref(),
        args.backend,
        args.reasoning_effort,
        args.output_mode,
    )?;
    let local = matches!(config.backend, Backend::Local);
    let window_chars = args.window_chars.unwrap_or(if local { 1000 } else { 3000 });
    let options = AnalysisOptions {
        evidence_mode: match args.evidence_mode {
            EvidenceModeArg::SegmentIds => castglean_core::EvidenceMode::SegmentIds,
            EvidenceModeArg::VerifiedQuotes => castglean_core::EvidenceMode::VerifiedQuotes,
        },
        segment_chars: window_chars.min(160),
        window_chars,
        window_segments: args.window_segments.unwrap_or(if local { 8 } else { 24 }),
        max_requests: args.max_requests,
        max_output_tokens: args
            .max_output_tokens
            .unwrap_or(if local { 2048 } else { 8192 }),
        request_timeout: Duration::from_secs(args.timeout_secs),
        max_repairs_per_window: args.max_repairs_per_window,
        chapter_timeout: Duration::from_secs(args.chapter_timeout_secs),
        ..Default::default()
    };
    let cancel = CancellationToken::new();
    let work = async {
        if let Some(state) = &state {
            let result = state
                .analyze_detailed(
                    &config.model,
                    castglean_core::BookAnalysisInput {
                        chapter_id: input.chapter_id,
                        source: input.source,
                        expected_revision: args.expected_revision.expect("clap requires revision"),
                        mode: if args.reanalyze_last {
                            castglean_core::BookAnalysisMode::ReanalyzeLast
                        } else {
                            castglean_core::BookAnalysisMode::Append
                        },
                    },
                    &options,
                    &cancel,
                )
                .await
                .map_err(|f| {
                    crate::failure::report_and_unwrap(f, args.failure_report.as_deref())
                })?;
            Ok::<_, CliError>((result.state, result.stats))
        } else {
            let result = analyze_chapter_detailed(&config.model, input, &options, &cancel)
                .await
                .map_err(|f| {
                    crate::failure::report_and_unwrap(f, args.failure_report.as_deref())
                })?;
            Ok((
                castglean_core::BookState::from_validated(result.book)?,
                result.stats,
            ))
        }
    };
    tokio::pin!(work);
    let result = tokio::select! {
        biased;
        signal = tokio::signal::ctrl_c() => {
            signal?;
            cancel.cancel();
            work.await
        },
        result = &mut work => result,
    }?;
    let (state, stats) = result;
    let chapter = state
        .book()
        .chapters()
        .last()
        .expect("analysis supplies a chapter");
    let diagnostics = RunDiagnostics {
        stats: &stats,
        backend: config.backend.as_str(),
        model: &config.model_id,
        endpoint: &config.endpoint,
        reasoning_effort: config.reasoning_effort,
        output_mode: config.output_mode,
        prompt_version: options.evidence_mode.prompt_version(),
        segmentation_version: castglean_core::SEGMENTATION_VERSION,
        options: &options,
    };
    crate::publication::publish(&args.output, |staging| {
        save(staging.join("book.json"), &state.document())?;
        save(staging.join("characters.json"), state.book().registry())?;
        save(
            staging.join("chapter.annotations.json"),
            chapter.annotations(),
        )?;
        save(staging.join("analysis.stats.json"), &diagnostics)?;
        let path = staging.join("chapter.txt");
        fs::write(&path, chapter.source().text()).map_err(|source| io_error(&path, source))?;
        Ok(())
    })?;
    println!(
        "Analyzed: {} request(s), {} character(s), {} ms; output {}",
        stats.requests,
        state.book().registry().characters.len(),
        stats.elapsed_ms,
        args.output.display()
    );
    Ok(())
}
#[derive(serde::Serialize)]
struct RunDiagnostics<'a> {
    #[serde(flatten)]
    stats: &'a castglean_core::AnalysisStats,
    backend: &'a str,
    model: &'a str,
    endpoint: &'a str,
    reasoning_effort: &'a str,
    output_mode: &'a str,
    prompt_version: u32,
    segmentation_version: u32,
    options: &'a AnalysisOptions,
}
