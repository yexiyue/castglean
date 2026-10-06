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
    after_help = "GLM analysis and offline validation. Format 1 is a draft; integrations remain planned."
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Analyze a new chapter with GLM and publish validated artifacts.
    Analyze(crate::analyze::AnalyzeArgs),
    /// Validate a registry and saved normalized chapter snapshots without changing files.
    Validate {
        /// Character registry JSON file.
        #[arg(long)]
        characters: PathBuf,
        /// Chapter annotation JSON files; repeat in matching source order.
        #[arg(long, required = true)]
        annotations: Vec<PathBuf>,
        /// Saved normalized UTF-8 source files; repeat in matching annotation order.
        #[arg(long, required = true)]
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
}

pub(crate) async fn run() -> Result<(), CliError> {
    match Cli::parse().command {
        None => Cli::command().print_long_help()?,
        Some(Commands::Analyze(args)) => crate::analyze::run(args).await?,
        Some(Commands::Validate {
            characters,
            annotations,
            source,
        }) => {
            if annotations.len() != source.len() {
                return Err(CliError::PairCount);
            }
            let registry = load_json(&characters)?;
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

fn load_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, CliError> {
    let file = File::open(path).map_err(|source| CliError::Io {
        path: path.into(),
        source,
    })?;
    read_json(file).map_err(|source| CliError::Data {
        path: path.into(),
        source,
    })
}
