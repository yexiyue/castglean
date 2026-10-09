//! CastGlean command-line entry point.

mod analyze;
mod book;
mod cli;
mod failure;
mod model_config;
mod publication;
mod run;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    match cli::run().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Error: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
