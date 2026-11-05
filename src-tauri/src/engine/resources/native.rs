//! Execute the confirmed cached plan; SDK rechecks its fingerprint before any work.
use super::{LocalTask, LocalTasks, TaskKind, space_check};
use crate::engine::{
    EngineState, PrepareOutcome, ResourceState, events::ModelResourceUpdate, inventory,
};
use tauri::Manager;
use tokio::sync::mpsc;

pub(super) fn begin(
    app: &tauri::AppHandle,
    tasks: &LocalTasks,
    registry: talechime::Registry,
    resolved: talechime::ResolvedModel,
    key: (String, String),
    fingerprint: String,
    plan: Option<talechime::PreparationPlan>,
) -> Result<PrepareOutcome, String> {
    let (backend, model) = key;
    let Some(plan) = plan else {
        return Ok(PrepareOutcome::PlanChanged);
    };
    if fingerprint != plan.fingerprint {
        return Ok(PrepareOutcome::PlanChanged);
    }
    let state = app.state::<EngineState>();
    if let Some(outcome) = space_check(&state, plan.peak_additional_bytes as f64) {
        return Ok(outcome);
    }
    let control = talechime::PreparationControl::default();
    let task_control = control.clone();
    let task_id = ModelResourceUpdate::state(
        &backend,
        &model,
        ResourceState::Preparing {
            phase: crate::engine::PreparationPhase::Verifying,
            component: String::new(),
            completed: 0.0,
            total: 0.0,
        },
    )
    .publish(app);
    if state.persist_resource_tasks().is_err() {
        ModelResourceUpdate::state(
            &backend,
            &model,
            ResourceState::Failed {
                error: crate::engine::PrepareFailure::Disk,
                missing_bytes: plan.download_bytes as f64,
            },
        )
        .publish(app);
        return Err("无法保存资源准备任务".into());
    }
    let downloads = registry.downloads().clone();
    let app = app.clone();
    let active_tasks = tasks.clone();
    let key = (backend.clone(), model.clone());
    let handle = tokio::task::spawn_local(async move {
        let (stage_tx, mut stages) = mpsc::channel(32);
        let (file_tx, files) = mpsc::channel(64);
        let stages_forward = async {
            while let Some(progress) = stages.recv().await {
                ModelResourceUpdate::state(
                    &backend,
                    &model,
                    crate::engine::preparation::stage(progress),
                )
                .publish_for(&app, task_id);
            }
        };
        let files_forward = crate::engine::progress::forward(files, |file, metrics| {
            ModelResourceUpdate::progress(
                &backend,
                &model,
                metrics.downloaded as f64,
                plan.download_bytes.max(metrics.downloaded) as f64,
                file,
            )
            .with_metrics(metrics)
            .publish_for(&app, task_id);
        });
        let (result, (), ()) = tokio::join!(
            resolved.prepare_native_resources(plan.fingerprint, task_control, stage_tx, file_tx),
            stages_forward,
            files_forward,
        );
        let next = match result {
            Ok(()) => registry
                .resource_status(&backend, Some(&model))
                .map(inventory::from_engine)
                .unwrap_or(ResourceState::Failed {
                    error: crate::engine::PrepareFailure::Internal,
                    missing_bytes: 0.0,
                }),
            Err(error) => ResourceState::Failed {
                error: inventory::classify_failure(&error),
                missing_bytes: plan.download_bytes as f64,
            },
        };
        active_tasks
            .borrow_mut()
            .remove(&(backend.clone(), model.clone()));
        ModelResourceUpdate::state(&backend, &model, next).publish_for(&app, task_id);
    });
    tasks.borrow_mut().insert(
        key,
        LocalTask {
            handle,
            kind: TaskKind::Native { downloads, control },
        },
    );
    Ok(PrepareOutcome::Started)
}
