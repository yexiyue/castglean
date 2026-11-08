//! Explicit offline ECS evaluation adapter. All output files live in ignored target/.
mod backend;
mod contract;
mod driver;
mod journal;
mod kernel;
#[cfg(feature = "native-live")]
mod live;
#[cfg(feature = "native-live")]
mod plan_c;
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
    #[cfg(feature = "native-live")]
    if args.iter().any(|a| a == "--plan-c-route") {
        return plan_c::main(&args);
    }
    if args.is_empty() || args.iter().any(|arg| arg == "--help") {
        println!(
            "rig-ecs-prototype --script FILE --checkpoint target/RUN.json [--case FILE | JSONL stdin] [--timeout-ms N] [--cancel-after-ms N]\nOffline controlled scripts by default. --live-config FILE (native-live feature) explicitly delegates to a native helper; --inspect-live-config FILE only checks frozen non-secret binding. Native requests have a 600s deadline and no retry. --plan FILE prints the three byte ranges without gold. --checkpoint must be under this package's target/. One case per process/checkpoint. --smoke-narrator creates a deliberately weak, gold-free baseline. --checkpoint-dir derives separate case/task paths. --dataset-hash binds the shared manifest. --interrupt-after N and --smoke-delay-ms a,b,c,d are controlled fault-injection options."
        );
        return Ok(());
    }
    let arg = |key: &str| {
        args.iter()
            .position(|a| a == key)
            .and_then(|i| args.get(i + 1))
            .map(String::as_str)
    };
    #[cfg(feature = "native-live")]
    if let Some(path) = arg("--inspect-live-config") {
        let config: live::NativeConfig = serde_json::from_slice(&std::fs::read(path)?)?;
        let native = live::NativeBoundary::open(
            config,
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/native-inspection"),
        )?;
        println!(
            "{}",
            serde_json::json!({"binding":native.binding,"helperIdentity":native.helper_identity,"identityScope":"known-only","capabilitiesVerified":false,"requestsStarted":0})
        );
        return Ok(());
    }
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
    let native_config = arg("--live-config");
    #[cfg(not(feature = "native-live"))]
    anyhow::ensure!(native_config.is_none(), "native-live_feature_required");
    let mut script: Script = if native_config.is_some() {
        Script {
            analysis: vec![],
            review: vec![],
            delay_ms: vec![],
        }
    } else if args.iter().any(|a| a == "--smoke-narrator") {
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
    let cancellation = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let options = Options {
        cancellation: Some(std::sync::Arc::clone(&cancellation)),
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
    #[cfg(feature = "native-live")]
    let _signals = if native_config.is_some() {
        Some(runtime.spawn(async move {
            #[cfg(unix)]
            {
                if let Ok(mut terminate) =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                {
                    tokio::select! {_=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{}}
                }
            }
            #[cfg(not(unix))]
            {
                let _ = tokio::signal::ctrl_c().await;
            }
            cancellation.store(true, std::sync::atomic::Ordering::SeqCst);
        }))
    } else {
        None
    };
    #[cfg(feature = "native-live")]
    let native = if let Some(config) = native_config {
        anyhow::ensure!(
            !args.iter().any(|a| matches!(
                a.as_str(),
                "--smoke-narrator" | "--script" | "--smoke-delay-ms"
            )),
            "live_mock_options_conflict"
        );
        let config: live::NativeConfig = serde_json::from_slice(&std::fs::read(config)?)?;
        Some(live::NativeBoundary::open(
            config,
            &checkpoint
                .parent()
                .ok_or_else(|| anyhow::anyhow!("checkpoint_parent"))?
                .join("native-jobs"),
        )?)
    } else {
        None
    };
    #[cfg(feature = "native-live")]
    let report = if let Some(native) = native {
        let mut options = options;
        options.barrier = false;
        if arg("--timeout-ms").is_none() {
            options.deadline = Duration::from_secs(1210);
        }
        driver::run_backend(
            &case,
            &backend::Backend::Native(native),
            &options,
            &checkpoint,
            runtime.handle().clone(),
        )?
    } else {
        driver::run(
            &case,
            &script,
            &options,
            &checkpoint,
            runtime.handle().clone(),
        )?
    };
    #[cfg(not(feature = "native-live"))]
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
