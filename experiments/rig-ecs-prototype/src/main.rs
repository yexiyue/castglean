//! Explicit offline ECS evaluation adapter. All output files live in ignored target/.
mod contract;
mod driver;
mod journal;
mod kernel;
#[cfg(test)]
mod tests;

use anyhow::Result;
use contract::{Case, hash};
use driver::{Options, Script};
use std::{
    io::{self, BufRead},
    path::PathBuf,
    time::Duration,
};

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|arg| arg == "--help") {
        println!(
            "rig-ecs-prototype --script FILE --checkpoint target/RUN.json [--case FILE | JSONL stdin] [--timeout-ms N] [--cancel-after-ms N]\nOffline controlled model scripts only; no gateway calls. --plan FILE prints the three byte ranges without gold. --checkpoint must be under this package's target/. One case per process/checkpoint. --smoke-narrator creates a deliberately weak, gold-free baseline. --checkpoint-dir derives separate case/task paths. --dataset-hash binds the shared manifest. --interrupt-after N and --smoke-delay-ms a,b,c,d are controlled fault-injection options."
        );
        return Ok(());
    }
    let arg = |key: &str| {
        args.iter()
            .position(|a| a == key)
            .and_then(|i| args.get(i + 1))
            .map(String::as_str)
    };
    if let Some(path) = arg("--plan") {
        let case: Case = serde_json::from_slice(&std::fs::read(path)?)?;
        case.validate()?;
        println!("{}", serde_json::to_string(&case.shards())?);
        return Ok(());
    }
    let bytes = if let Some(path) = arg("--case") {
        std::fs::read(path)?
    } else {
        let mut line = String::new();
        io::stdin().lock().read_line(&mut line)?;
        line.into_bytes()
    };
    let case: Case = serde_json::from_slice(&bytes)?;
    let mut script: Script = if args.iter().any(|a| a == "--smoke-narrator") {
        // Deliberately weak baseline; sees only ranges, never gold or candidate labels.
        let analysis=case.shards().into_iter().map(|r|vec![rig_core::test_utils::MockStreamEvent::text(serde_json::json!({"segments":[{"start":r.start,"end":r.end,"kind":"narration","speaker":"narrator","evidence":[r]}]}).to_string()),rig_core::test_utils::MockStreamEvent::final_response(rig_core::completion::Usage::new())]).collect();
        Script {
            analysis,
            review: vec![
                rig_core::test_utils::MockStreamEvent::text("{\"issues\":[]}"),
                rig_core::test_utils::MockStreamEvent::final_response(
                    rig_core::completion::Usage::new(),
                ),
            ],
            delay_ms: vec![30, 40, 50, 10],
        }
    } else {
        serde_json::from_slice(&std::fs::read(
            arg("--script")
                .ok_or_else(|| anyhow::anyhow!("--script or --smoke-narrator required"))?,
        )?)?
    };
    if let Some(delays) = arg("--smoke-delay-ms") {
        script.delay_ms = delays
            .split(',')
            .map(str::parse)
            .collect::<std::result::Result<Vec<_>, _>>()?;
    }
    let checkpoint = if let Some(directory) = arg("--checkpoint-dir") {
        PathBuf::from(directory).join(format!(
            "{}-{}.json",
            hash(case.case_id.as_bytes()),
            case.evaluation_task
        ))
    } else {
        PathBuf::from(
            arg("--checkpoint")
                .ok_or_else(|| anyhow::anyhow!("--checkpoint or --checkpoint-dir required"))?,
        )
    };
    let checkpoint = journal::target_path(&checkpoint)?;
    let options = Options {
        deadline: Duration::from_millis(arg("--timeout-ms").unwrap_or("10000").parse()?),
        cancel_after: arg("--cancel-after-ms")
            .map(str::parse)
            .transpose()?
            .map(Duration::from_millis),
        barrier: true,
        code_revision: option_env!("CASTGLEAN_CODE_REVISION")
            .unwrap_or("unversioned-build")
            .into(),
        dataset_version: arg("--dataset-version")
            .unwrap_or("unversioned-case-v1")
            .into(),
        dataset_hash: arg("--dataset-hash").map(str::to_owned).unwrap_or(hash(
            &serde_json::to_vec(&serde_json::from_slice::<serde_json::Value>(&bytes)?)?,
        )),
        interrupt_after: arg("--interrupt-after").map(str::parse).transpose()?,
    };
    // One explicit owner runtime for the standalone driver. Embedding Kernel uses the host's Handle.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(3)
        .enable_all()
        .build()?;
    let report = driver::run(
        &case,
        &script,
        &options,
        &checkpoint,
        runtime.handle().clone(),
    )?;
    println!("{}", serde_json::to_string(&report)?);
    // A handled failure is still a valid adapter result with trace. Nonzero would discard it in the shared runner.
    Ok(())
}
