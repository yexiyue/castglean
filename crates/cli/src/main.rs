//! CastGlean command-line entry point.

mod cli;

fn main() -> std::io::Result<()> {
    cli::run()
}
