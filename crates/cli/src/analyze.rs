//! CLI-only configuration and new-artifact publication.
use crate::{
    cli::CliError,
    model_config::{self, Backend},
};
use castglean_core::{
    AnalysisInput, AnalysisOptions, BookId, CancellationToken, ChapterId, SourceSnapshot,
    analyze_chapter, write_json,
};
use castglean_model::{GlmOutputMode, GlmReasoningEffort};
use clap::Args;
use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Args)]
pub(crate) struct AnalyzeArgs {
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
    let text = fs::read_to_string(&args.source).map_err(|source| io_error(&args.source, source))?;
    let input = AnalysisInput {
        book_id: BookId::new(args.book)?,
        chapter_id: ChapterId::new(args.chapter)?,
        source: SourceSnapshot::import(&text),
        context: None,
    };
    let config = model_config::load(
        args.env_file.as_deref(),
        args.backend,
        args.reasoning_effort,
        args.output_mode,
    )?;
    let local = matches!(config.backend, Backend::Local);
    let window_chars = args.window_chars.unwrap_or(if local { 1000 } else { 3000 });
    let options = AnalysisOptions {
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
    let work = analyze_chapter(&config.model, input, &options, &cancel);
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
    let parent = args
        .output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    let staging = tempfile::Builder::new()
        .prefix(".castglean-")
        .tempdir_in(parent)
        .map_err(|source| io_error(parent, source))?;
    let chapter = &result.book.chapters()[0];
    save(
        staging.path().join("characters.json"),
        result.book.registry(),
    )?;
    save(
        staging.path().join("chapter.annotations.json"),
        chapter.annotations(),
    )?;
    let diagnostics = RunDiagnostics {
        stats: &result.stats,
        backend: config.backend.as_str(),
        model: &config.model_id,
        endpoint: &config.endpoint,
        reasoning_effort: config.reasoning_effort,
        output_mode: config.output_mode,
        prompt_version: castglean_core::ANALYSIS_PROMPT_VERSION,
        segmentation_version: castglean_core::SEGMENTATION_VERSION,
        options: &options,
    };
    save(staging.path().join("analysis.stats.json"), &diagnostics)?;
    let source_path = staging.path().join("chapter.txt");
    fs::write(&source_path, chapter.source().text())
        .map_err(|source| io_error(&source_path, source))?;
    ensure_absent(&args.output)?;
    fs::rename(staging.path(), &args.output).map_err(|source| io_error(&args.output, source))?;
    // TempDir's old path is absent; no cleanup can affect the published directory.
    println!(
        "Analyzed: {} request(s), {} character(s), {} ms; output {}",
        result.stats.requests,
        result.book.registry().characters.len(),
        result.stats.elapsed_ms,
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
fn ensure_absent(path: &Path) -> Result<(), CliError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(io_error(
            path,
            io::Error::new(io::ErrorKind::AlreadyExists, "output path already exists"),
        )),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_error(path, e)),
    }
}
fn save(path: PathBuf, value: &impl serde::Serialize) -> Result<(), CliError> {
    let file = File::create(&path).map_err(|source| io_error(&path, source))?;
    write_json(file, value).map_err(|source| CliError::Data { path, source })
}
fn io_error(path: &Path, source: io::Error) -> CliError {
    CliError::Io {
        path: path.to_owned(),
        source,
    }
}
