//! Thin model assembly for the library's concrete chapter journal.
use crate::{
    cli::CliError,
    model_config::{self, Backend, ConfiguredModel},
};
use castglean_core::{BookRun, CancellationToken, RunConfig, RunModel, RunPlan, write_json};
use castglean_model::{GlmOutputMode, GlmReasoningEffort};
use clap::Args;
use std::{fs::File, path::PathBuf};

const IMPLEMENTATION: &str = concat!("castglean-cli/", env!("CARGO_PKG_VERSION"), "/run-2");
#[derive(Args)]
pub(crate) struct RunArgs {
    /// Optional safe JSON report written only on analysis failure; never overwritten.
    #[arg(long)]
    failure_report: Option<PathBuf>,
    /// Existing frozen run, or a new absent path with run --plan.
    #[arg(long)]
    run_dir: PathBuf,
    /// Environment file used only for assembling the configured model.
    #[arg(long)]
    env_file: Option<PathBuf>,
    /// Backend override; must agree with the frozen plan.
    #[arg(long, value_enum)]
    backend: Option<Backend>,
    /// GLM reasoning override; must agree with the frozen plan.
    #[arg(long)]
    reasoning_effort: Option<GlmReasoningEffort>,
    /// GLM output override; must agree with the frozen plan.
    #[arg(long)]
    output_mode: Option<GlmOutputMode>,
    /// Stop normally after this many new chapter commits; plan remains unchanged.
    #[arg(long)]
    max_chapters: Option<usize>,
}
#[derive(Args)]
pub(crate) struct StartArgs {
    /// Complete explicit RunPlan JSON, including saved source and base book.
    #[arg(long)]
    plan: PathBuf,
    #[command(flatten)]
    run: RunArgs,
}
#[derive(Args)]
pub(crate) struct InspectArgs {
    /// Frozen run to validate, without a model or credentials.
    #[arg(long)]
    run_dir: PathBuf,
    /// Optional new directory receiving book.json and run.progress.json.
    #[arg(long)]
    output: Option<PathBuf>,
}
fn config(model: &ConfiguredModel, options: castglean_core::AnalysisOptions) -> RunConfig {
    RunConfig::new(
        RunModel {
            backend: model.backend.as_str().into(),
            model: model.model_id.clone(),
            endpoint: model.endpoint.clone(),
            reasoning_effort: model.reasoning_effort.into(),
            output_mode: model.output_mode.into(),
        },
        options,
        IMPLEMENTATION.into(),
    )
}
fn model(args: &RunArgs) -> Result<ConfiguredModel, CliError> {
    if args.max_chapters == Some(0) {
        return Err(CliError::Config("max-chapters must be positive"));
    }
    model_config::load(
        args.env_file.as_deref(),
        args.backend,
        args.reasoning_effort,
        args.output_mode,
    )
}
pub(crate) async fn start(args: StartArgs) -> Result<(), CliError> {
    crate::publication::ensure_absent(&args.run.run_dir)?;
    crate::failure::check(args.run.failure_report.as_deref())?;
    let file = File::open(&args.plan).map_err(|e| crate::publication::io_error(&args.plan, e))?;
    let plan: RunPlan =
        serde_json::from_reader(file).map_err(|_| CliError::Config("invalid run plan JSON"))?;
    let model = model(&args.run)?;
    let actual = config(&model, plan.config.options.clone());
    if actual != plan.config {
        return Err(castglean_core::RunError::Configuration.into());
    }
    let mut run = BookRun::create(&args.run.run_dir, plan)?;
    execute(
        &mut run,
        &model,
        &actual,
        args.run.max_chapters,
        args.run.failure_report.as_deref(),
    )
    .await
}
pub(crate) async fn resume(args: RunArgs) -> Result<(), CliError> {
    crate::failure::check(args.failure_report.as_deref())?;
    let mut run = BookRun::open(&args.run_dir)?;
    let model = model(&args)?;
    let actual = config(&model, run.plan().config.options.clone());
    run.check_config(&actual)?;
    execute(
        &mut run,
        &model,
        &actual,
        args.max_chapters,
        args.failure_report.as_deref(),
    )
    .await
}
async fn execute(
    run: &mut BookRun,
    model: &ConfiguredModel,
    config: &RunConfig,
    limit: Option<usize>,
    failure_report: Option<&std::path::Path>,
) -> Result<(), CliError> {
    let cancel = CancellationToken::new();
    let work = async {
        let mut completed = 0;
        while limit.is_none_or(|limit| completed < limit)
            && run
                .advance_detailed(&model.model, config, &cancel)
                .await
                .map_err(|f| crate::failure::report_and_unwrap(f, failure_report))?
        {
            completed += 1;
            let progress = run.progress();
            println!(
                "Committed: {}/{}, revision {}",
                progress.completed, progress.total, progress.revision
            );
        }
        write_json(std::io::stdout(), &run.progress())?;
        Ok::<_, CliError>(())
    };
    tokio::pin!(work);
    tokio::select! {
        biased;
        signal = tokio::signal::ctrl_c() => { signal?; cancel.cancel(); work.await },
        result = &mut work => result,
    }
}
pub(crate) fn inspect(args: InspectArgs) -> Result<(), CliError> {
    let run = BookRun::open(&args.run_dir)?;
    if let Some(output) = args.output {
        crate::publication::publish(&output, |staging| {
            crate::publication::save(staging.join("book.json"), &run.state().document())?;
            crate::publication::save(staging.join("run.progress.json"), &run.progress())
        })?;
    }
    write_json(std::io::stdout(), &run.progress())?;
    Ok(())
}
