//! Inference objects never leave the existing engine owner thread.
use super::tasks::{cancelled, exclusive};
use super::*;
use std::{io::Cursor, rc::Rc};
use talechime::{DesignOptions, Device, Engine, ModelOptions, VoiceStudio};
use tauri::Manager;
use tauri_specta::Event;
use tokio::sync::{Semaphore, watch};

impl From<crate::engine::InferenceDevice> for Device {
    fn from(device: crate::engine::InferenceDevice) -> Self {
        use crate::engine::InferenceDevice as D;
        match device {
            D::Cpu => Self::Cpu,
            D::Metal => Self::Metal,
            D::Cuda => Self::Cuda,
        }
    }
}
fn publish(
    app: &tauri::AppHandle,
    id: u32,
    state: JobState,
    stage: &str,
    result: Option<JobResult>,
) {
    let update = app
        .state::<StudioState>()
        .tasks
        .lock()
        .unwrap()
        .update(id, state, stage, result);
    if let Some(job) = update {
        let _ = StudioUpdate(job).emit(app);
    }
}
fn commit(
    app: &tauri::AppHandle,
    id: u32,
    produce: impl FnOnce(&mut super::store::Store) -> JobResult,
) -> JobResult {
    let state = app.state::<StudioState>();
    let mut tasks = state.tasks.lock().map_err(|_| "studio unavailable")?;
    if tasks.cancelled(id) {
        return Err("cancelled".into());
    }
    let mut store = state.store.lock().map_err(|_| "studio unavailable")?;
    let output = produce(&mut store)?;
    let update = tasks.update(
        id,
        JobState::Succeeded,
        "finished",
        Some(Ok(JobOutput {
            candidate: output.candidate.clone(),
            audio: output.audio.clone(),
        })),
    );
    drop(tasks);
    if let Some(job) = update {
        let _ = StudioUpdate(job).emit(app);
    }
    Ok(output)
}
pub(crate) async fn run(app: tauri::AppHandle, job: StudioJob, gate: Rc<Semaphore>) {
    let cancel = match app
        .state::<StudioState>()
        .tasks
        .lock()
        .unwrap()
        .cancellation(job.id)
    {
        Ok(c) => c,
        Err(_) => return,
    };
    let result = exclusive(&gate, cancel.clone(), |mut cancel| {
        let app = &app;
        let job = &job;
        async move {
            publish(app, job.id, JobState::Running, "loading", None);
            execute(app, job, &mut cancel).await
        }
    })
    .await;
    if *cancel.borrow() {
        publish(&app, job.id, JobState::Cancelled, "cancelled", None);
    } else {
        let state = if result.is_ok() {
            JobState::Succeeded
        } else {
            JobState::Failed
        };
        publish(&app, job.id, state, "finished", Some(result));
    }
}
async fn execute(
    app: &tauri::AppHandle,
    job: &StudioJob,
    cancel: &mut watch::Receiver<bool>,
) -> JobResult {
    if app
        .state::<crate::engine::EngineState>()
        .active_downloads()
        .map_err(|e| e.to_string())?
        > 0
    {
        return Err("model resources are being prepared; try again after completion".into());
    }
    let registry = crate::engine::catalog::registry(&app.state::<crate::engine::EngineState>())
        .map_err(|e| e.to_string())?;
    let voices = app
        .state::<super::super::VoiceState>()
        .library
        .root()
        .to_owned();
    let studio = VoiceStudio::at_registry(&registry, &voices).map_err(|e| e.to_string())?;
    match &job.request {
        StudioRequest::PrepareDesign { engine } => {
            super::preparation::run(app, job.id, &studio, &registry, engine, cancel).await?;
            Ok(JobOutput::default())
        }
        StudioRequest::Design {
            engine,
            device,
            name,
            description,
            text,
            seed,
        } => {
            let options = DesignOptions {
                engine: Some(engine.clone()),
                device: (*device).into(),
                name: Some(name.clone()),
                description: description.clone(),
                text: Some(text.clone()),
                id: Some(format!("voice-{}", uuid::Uuid::new_v4().simple())),
                seed: seed.map(u64::from),
            };
            let (tx, _rx) = tokio::sync::mpsc::channel(16);
            let candidate = tokio::select! { result = studio.design_candidate(options, tx) => result.map_err(|e| e.to_string())?,
            _ = cancelled(cancel) => return Err("cancelled".into()) };
            commit(app, job.id, |store| {
                let view = store.add(candidate)?;
                Ok(JobOutput {
                    candidate: Some(view.id),
                    audio: Some(view.audio),
                })
            })
        }
        StudioRequest::Audition {
            backend,
            model,
            device,
            voice,
            text,
            style,
        } => {
            let mut options = ModelOptions::new(backend, registry.root());
            options.model = Some(model.clone());
            options.device = (*device).into();
            options.voices = Some(voices);
            // Loading may own blocking backend work. Keep the slot until it finishes,
            // then close the engine before acknowledging cancellation.
            let mut engine = Engine::load(&registry, options, |event| progress(app, job.id, event))
                .await
                .map_err(|e| e.to_string())?;
            if *cancel.borrow() {
                engine.close().await.map_err(|e| e.to_string())?;
                return Err("cancelled".into());
            }
            audition(app, job.id, engine, voice, text, style.clone(), cancel).await
        }
    }
}
async fn audition(
    app: &tauri::AppHandle,
    id: u32,
    mut engine: Engine,
    voice: &VoiceSelection,
    text: &str,
    style: Option<String>,
    cancel: &mut watch::Receiver<bool>,
) -> JobResult {
    let result = async {
        let (voice_id, asset) = match voice {
            VoiceSelection::Preset { voice } => (voice.clone(), None),
            VoiceSelection::Library { id } => (id.clone(), Some(id.clone())),
            VoiceSelection::Candidate { id } => {
                let reference = app
                    .state::<StudioState>()
                    .store
                    .lock()
                    .unwrap()
                    .reference(id)?;
                let voice = engine
                    .install_candidate(&reference)
                    .await
                    .map_err(|e| e.to_string())?;
                (voice, None)
            }
        };
        publish(app, id, JobState::Running, "generating", None);
        let stream = engine
            .synthesize(text, &voice_id, style)
            .await
            .map_err(|e| e.to_string())?;
        let pcm = super::audio::collect(stream, cancel).await?;
        let mut bytes = Cursor::new(Vec::new());
        {
            let spec = hound::WavSpec {
                channels: pcm.channels,
                sample_rate: pcm.sample_rate,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };
            let mut writer = hound::WavWriter::new(&mut bytes, spec).map_err(|e| e.to_string())?;
            for sample in pcm.samples {
                writer
                    .write_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
                    .map_err(|e| e.to_string())?;
            }
            writer.finalize().map_err(|e| e.to_string())?;
        }
        if *cancel.borrow() {
            return Err("cancelled".into());
        }
        Ok::<_, String>((bytes.into_inner(), asset))
    }
    .await;
    let closed = engine.close().await.map_err(|e| e.to_string());
    match result {
        Ok((wav, asset)) => {
            closed?;
            commit(app, id, |store| {
                let audio = store.audio(&wav, asset)?;
                Ok(JobOutput {
                    candidate: None,
                    audio: Some(audio),
                })
            })
        }
        Err(error) => {
            let _ = closed;
            Err(error)
        }
    }
}
fn progress(app: &tauri::AppHandle, id: u32, event: talechime::Event) {
    let stage = match event {
        talechime::Event::ResourceState { stage, .. } => stage,
        talechime::Event::ModelProgress { .. } => "downloading".into(),
        _ => return,
    };
    publish(app, id, JobState::Running, &stage, None);
}
