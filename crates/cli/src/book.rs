//! File adapters for the core's immutable whole-book candidates.
use crate::{
    cli::{CliError, load_json},
    publication::{ensure_absent, publish, save},
};
use castglean_core::{BookDocument, BookState, ChapterId, CorrectionBatch};
use clap::Args;
use std::path::{Path, PathBuf};

#[derive(Args)]
pub(crate) struct CorrectArgs {
    /// Complete aggregate snapshot to read.
    #[arg(long)]
    book_file: PathBuf,
    /// Source-bound human batch, including expected_revision.
    #[arg(long)]
    corrections: PathBuf,
    /// New directory for the complete next snapshot.
    #[arg(long)]
    output: PathBuf,
}
#[derive(Args)]
pub(crate) struct InspectArgs {
    /// Complete aggregate snapshot; no model credentials are needed.
    #[arg(long)]
    book_file: PathBuf,
    /// Optional exact name/alias lookup; all candidate IDs are returned.
    #[arg(long)]
    label: Option<String>,
    /// Inclusive chapter boundary for lookup (default: last chapter).
    #[arg(long, requires = "label")]
    through: Option<String>,
}
pub(crate) fn load(path: &Path) -> Result<BookState, CliError> {
    let document: BookDocument = load_json(path)?;
    Ok(BookState::from_document(document)?)
}
pub(crate) fn correct(args: CorrectArgs) -> Result<(), CliError> {
    ensure_absent(&args.output)?;
    let state = load(&args.book_file)?;
    let batch: CorrectionBatch = load_json(&args.corrections)?;
    let next = state.correct(batch)?;
    publish(&args.output, |staging| {
        save(staging.join("book.json"), &next.document())
    })?;
    println!(
        "Corrected: revision {}; output {}",
        next.revision(),
        args.output.display()
    );
    Ok(())
}
pub(crate) fn inspect(args: InspectArgs) -> Result<(), CliError> {
    let state = load(&args.book_file)?;
    let candidates = if let Some(label) = &args.label {
        let through = args
            .through
            .map(ChapterId::new)
            .transpose()?
            .or_else(|| {
                state
                    .book()
                    .chapters()
                    .last()
                    .map(|c| c.annotations().chapter_id.clone())
            })
            .ok_or(CliError::Config("lookup requires a chapter boundary"))?;
        Some(
            state
                .candidates(label, &through)?
                .iter()
                .map(|c| c.id.as_str())
                .collect::<Vec<_>>(),
        )
    } else {
        None
    };
    let result = serde_json::json!({"book_id":state.book().registry().book_id,"revision":state.revision(),
        "characters":state.book().registry().characters,"candidates":candidates,
        "chapters":state.book().chapters().iter().map(|c| serde_json::json!({
            "chapter_id":c.annotations().chapter_id,"source":c.annotations().source,"segments":c.annotations().segments
        })).collect::<Vec<_>>()});
    castglean_core::write_json(std::io::stdout().lock(), &result)?;
    Ok(())
}
