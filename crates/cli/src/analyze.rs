//! CLI-only configuration and new-artifact publication.
use crate::cli::CliError;
use castglean_core::{
    AnalysisInput, AnalysisOptions, BookId, CancellationToken, ChapterId, SourceSnapshot,
    analyze_chapter, write_json,
};
use castglean_model::{
    DEFAULT_GLM_ENDPOINT, DEFAULT_GLM_MODEL, GlmConfig, GlmModel, GlmOutputMode, GlmReasoningEffort,
};
use clap::Args;
use std::{
    collections::HashMap,
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
    /// GLM thinking budget: low, high or max; overrides REASONING_EFFORT.
    #[arg(long)]
    reasoning_effort: Option<GlmReasoningEffort>,
    /// Structured output: json, schema or tool; overrides OUTPUT_MODE.
    #[arg(long)]
    output_mode: Option<GlmOutputMode>,
    /// Maximum Unicode scalar count of target text per model call.
    #[arg(long, default_value_t = 3000)]
    window_chars: usize,
    /// Maximum target segments per call, bounding JSON output growth.
    #[arg(long, default_value_t = 24)]
    window_segments: usize,
    /// Maximum provider calls for this chapter.
    #[arg(long, default_value_t = 32)]
    max_requests: usize,
    /// Maximum generation tokens per call.
    #[arg(long, default_value_t = 8192)]
    max_output_tokens: u32,
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
    let config = load_config(
        args.env_file.as_deref(),
        args.reasoning_effort,
        args.output_mode,
    )?;
    let reasoning_effort = config.reasoning_effort();
    let output_mode = config.output_mode();
    let model_id = config.model().to_owned();
    let endpoint = config.endpoint().to_owned();
    let model = GlmModel::new(config)?;
    let options = AnalysisOptions {
        segment_chars: args.window_chars.min(160),
        window_chars: args.window_chars,
        window_segments: args.window_segments,
        max_requests: args.max_requests,
        max_output_tokens: args.max_output_tokens,
        request_timeout: Duration::from_secs(args.timeout_secs),
        max_repairs_per_window: args.max_repairs_per_window,
        chapter_timeout: Duration::from_secs(args.chapter_timeout_secs),
        ..Default::default()
    };
    let cancel = CancellationToken::new();
    let work = analyze_chapter(&model, input, &options, &cancel);
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
        model: &model_id,
        endpoint: &endpoint,
        reasoning_effort: reasoning_effort.as_str(),
        output_mode: output_mode.as_str(),
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
fn load_config(
    path: Option<&Path>,
    effort: Option<GlmReasoningEffort>,
    mode: Option<GlmOutputMode>,
) -> Result<GlmConfig, CliError> {
    let file = path.unwrap_or(Path::new(".env"));
    let values: HashMap<String, String> = match dotenvy::from_path_iter(file) {
        Ok(iter) => iter
            .collect::<Result<_, _>>()
            .map_err(|_| CliError::Config("invalid environment file"))?,
        Err(dotenvy::Error::Io(error))
            if path.is_none() && error.kind() == io::ErrorKind::NotFound =>
        {
            HashMap::new()
        }
        Err(_) => return Err(CliError::Config("cannot read environment file")),
    };
    let value = |name: &str, default: Option<&str>| -> Result<String, CliError> {
        match std::env::var(name) {
            Ok(v) => Ok(v),
            Err(std::env::VarError::NotUnicode(_)) => {
                Err(CliError::Config("model environment values must be UTF-8"))
            }
            Err(std::env::VarError::NotPresent) => values
                .get(name)
                .cloned()
                .or_else(|| default.map(str::to_owned))
                .ok_or(CliError::Config("BIGMODEL_API_KEY is required")),
        }
    };
    let effort = match effort {
        Some(effort) => effort,
        None => value("REASONING_EFFORT", Some("low"))?.parse()?,
    };
    let mode = match mode {
        Some(mode) => mode,
        None => value("OUTPUT_MODE", Some(GlmOutputMode::default().as_str()))?.parse()?,
    };
    Ok(GlmConfig::new(
        value("MODEL", Some(DEFAULT_GLM_MODEL))?,
        value("API_BASE_URL", Some(DEFAULT_GLM_ENDPOINT))?,
        value("BIGMODEL_API_KEY", None)?,
    )?
    .with_reasoning_effort(effort)
    .with_output_mode(mode))
}

#[derive(serde::Serialize)]
struct RunDiagnostics<'a> {
    #[serde(flatten)]
    stats: &'a castglean_core::AnalysisStats,
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
