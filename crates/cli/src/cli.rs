//! Thin process adapter over the core offline validator.

use castglean_core::{ChapterAnnotations, ChapterInput, SourceSnapshot, read_json, validate_book};
use clap::{CommandFactory, Parser, Subcommand};
use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
};

#[derive(Parser)]
#[command(
    name = "castglean",
    version,
    about = "CastGlean · 拾角 — offline character and annotation validation"
)]
#[command(
    after_help = "Local, GLM and MiniMax analysis, plus offline validation. Format 1 is a draft; integrations remain planned."
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start an ordered chapter run from an explicit frozen JSON plan.
    Run(crate::run::StartArgs),
    /// Recover complete commits and continue the remaining planned chapters.
    Resume(crate::run::RunArgs),
    /// Validate run progress offline and optionally export the latest book.
    RunInspect(crate::run::InspectArgs),
    /// Analyze a new chapter with a local, GLM or MiniMax model and publish validated artifacts.
    Analyze(crate::analyze::AnalyzeArgs),
    /// Apply a source-bound human batch to a complete book snapshot.
    Correct(crate::book::CorrectArgs),
    /// Inspect chapter references and identity candidates without displaying source text.
    Inspect(crate::book::InspectArgs),
    /// Validate a registry and saved normalized chapter snapshots without changing files.
    Validate {
        /// Validate a complete ordered aggregate instead of separate files.
        #[arg(long, conflicts_with_all = ["characters", "annotations", "source"])]
        book_file: Option<PathBuf>,
        /// Character registry JSON file.
        #[arg(long, required_unless_present = "book_file")]
        characters: Option<PathBuf>,
        /// Chapter annotation JSON files; repeat in matching source order.
        #[arg(long, required_unless_present = "book_file")]
        annotations: Vec<PathBuf>,
        /// Saved normalized UTF-8 source files; repeat in matching annotation order.
        #[arg(long, required_unless_present = "book_file")]
        source: Vec<PathBuf>,
    },
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum CliError {
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: io::Error },
    #[error("{path}: {source}")]
    Data {
        path: PathBuf,
        source: castglean_core::Error,
    },
    #[error("--annotations and --source must have the same number of paths")]
    PairCount,
    #[error("validation: {0}")]
    Validation(#[from] castglean_core::Error),
    #[error("output: {0}")]
    Output(#[from] io::Error),
    #[error("configuration: {0}")]
    Config(&'static str),
    #[error("analysis: {0}")]
    Analysis(#[from] castglean_core::AnalysisError),
    #[error("model: {0}")]
    Model(#[from] castglean_core::ModelError),
    #[error("{0}")]
    Book(#[from] castglean_core::BookError),
    #[error("{0}")]
    Run(#[from] castglean_core::RunError),
}

pub(crate) async fn run() -> Result<(), CliError> {
    match Cli::parse().command {
        None => Cli::command().print_long_help()?,
        Some(Commands::Run(args)) => crate::run::start(args).await?,
        Some(Commands::Resume(args)) => crate::run::resume(args).await?,
        Some(Commands::RunInspect(args)) => crate::run::inspect(args)?,
        Some(Commands::Analyze(args)) => crate::analyze::run(args).await?,
        Some(Commands::Correct(args)) => crate::book::correct(args)?,
        Some(Commands::Inspect(args)) => crate::book::inspect(args)?,
        Some(Commands::Validate {
            book_file,
            characters,
            annotations,
            source,
        }) => {
            if let Some(path) = book_file {
                let state = crate::book::load(&path)?;
                println!(
                    "Valid: book {}, revision {}, {} chapter(s), {} character(s)",
                    state.book().registry().book_id,
                    state.revision(),
                    state.book().chapters().len(),
                    state.book().registry().characters.len()
                );
                return Ok(());
            }
            if annotations.len() != source.len() {
                return Err(CliError::PairCount);
            }
            let registry = load_json(&characters.expect("clap requires registry"))?;
            let mut chapters = Vec::with_capacity(annotations.len());
            for (annotation_path, source_path) in annotations.iter().zip(&source) {
                let annotation: ChapterAnnotations = load_json(annotation_path)?;
                let text = fs::read_to_string(source_path).map_err(|source| CliError::Io {
                    path: source_path.clone(),
                    source,
                })?;
                let snapshot = SourceSnapshot::from_saved(text, annotation.source.clone())
                    .map_err(|source| CliError::Data {
                        path: source_path.clone(),
                        source,
                    })?;
                chapters.push(ChapterInput {
                    annotations: annotation,
                    source: snapshot,
                });
            }
            let book = validate_book(registry, chapters)?;
            writeln!(
                io::stdout().lock(),
                "Valid: book {}, {} chapter(s), {} character(s)",
                book.registry().book_id,
                book.chapters().len(),
                book.registry().characters.len()
            )?;
        }
    }
    Ok(())
}

pub(crate) fn load_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, CliError> {
    let file = File::open(path).map_err(|source| CliError::Io {
        path: path.into(),
        source,
    })?;
    read_json(file).map_err(|source| CliError::Data {
        path: path.into(),
        source,
    })
}
