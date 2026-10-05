//! Help and version interface for the initial scaffold.

use clap::{CommandFactory, Parser};

#[derive(Parser)]
#[command(
    name = "castglean",
    version,
    about = "CastGlean · 拾角 — initial library + CLI scaffold"
)]
#[command(after_help = "Analysis, validation and model integrations are not implemented yet.")]
struct Cli {}

pub(crate) fn run() -> std::io::Result<()> {
    Cli::parse();
    Cli::command().print_long_help()
}
