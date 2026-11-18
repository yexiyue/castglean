//! Capture an approved Studio result before releasing its transient job.
use super::*;
use std::{
    io::{self, Read},
    path::Path,
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

pub(crate) async fn generate(
    app: &tauri::AppHandle,
    id: &str,
    request: StudioRequest,
    path: &Path,
    cancel: &CancellationToken,
) -> Result<Option<super::super::LibraryVoice>, String> {
    let job_id = commands::start_voice_job(app.clone(), id.to_owned(), request).await?;
    let state = app.state::<StudioState>();
    let mut cancelled = false;
    let job = loop {
        let job = state
            .tasks
            .lock()
            .map_err(|_| "studio unavailable")?
            .get(job_id)
            .ok_or("unknown job")?;
        if job.state.terminal() {
            break job;
        }
        if !cancelled && cancel.is_cancelled() {
            cancelled = true;
            let _ = commands::cancel_voice_job(app.clone(), job_id).await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(75)).await;
    };
    let result = if job.state == JobState::Succeeded && !cancel.is_cancelled() {
        let capture_app = app.clone();
        let snapshot = job.clone();
        let path = path.to_path_buf();
        tauri::async_runtime::spawn_blocking(move || {
            capture(&capture_app.state::<StudioState>(), &snapshot, &path)
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result)
    } else {
        Err("casting audition did not complete".into())
    };
    if let Some(id) = &job.candidate
        && let Ok(mut store) = state.store.lock()
    {
        let _ = store.discard(id);
    }
    let _ = commands::dismiss_voice_job(state, job_id).await;
    result
}

fn capture(
    state: &StudioState,
    job: &StudioJob,
    path: &Path,
) -> Result<Option<super::super::LibraryVoice>, String> {
    let store = state.store.lock().map_err(|_| "studio unavailable")?;
    let audio = job
        .audio
        .as_ref()
        .and_then(|id| store.media.get(id))
        .ok_or("audio missing")?;
    let mut reader = audio.file.reopen().map_err(|error| error.to_string())?;
    let candidate = job
        .candidate
        .as_deref()
        .map(|id| store.reference(id))
        .transpose()?;
    drop(store);
    let parent = path.parent().ok_or("audio directory missing")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    io::copy(&mut reader, &mut file)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    file.persist_noclobber(path)
        .map_err(|error| error.to_string())?;
    Ok(candidate.map(|candidate| candidate.asset().into()))
}

pub(crate) fn load_audio(app: &tauri::AppHandle, path: &Path) -> Result<String, String> {
    let bytes = read_audio(path)?;
    app.state::<StudioState>()
        .store
        .lock()
        .map_err(|_| "studio unavailable")?
        .audio(&bytes, None)
}

fn read_audio(path: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    const LIMIT: u64 = 25 * 1024 * 1024;
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("casting audio exceeds size limit".into());
    }
    Ok(bytes)
}

pub(crate) fn save(
    app: &tauri::AppHandle,
    path: &Path,
    metadata: &super::super::LibraryVoice,
) -> Result<(), String> {
    save_with_library(
        &app.state::<super::super::VoiceState>().library,
        path,
        metadata,
    )
}

fn save_with_library(
    library: &talechime::VoiceLibrary,
    path: &Path,
    metadata: &super::super::LibraryVoice,
) -> Result<(), String> {
    let source =
        talechime::VoiceSource::Designed(metadata.source.clone().ok_or("missing design engine")?);
    if let Ok((existing, wav)) = library.load(&metadata.id) {
        if existing.transcript() == metadata.transcript
            && existing.description() == metadata.description.as_deref()
            && existing.source() == &source
            && existing.wav_bytes() as f64 == metadata.bytes
            && (!path.exists() || read_audio(path)? == wav)
        {
            return Ok(());
        }
        return Err("casting candidate identity conflicts with saved voice".into());
    }
    let bytes = read_audio(path)?;
    let candidate = talechime::VoiceCandidate::new(
        &metadata.id,
        &metadata.name,
        bytes,
        &metadata.transcript,
        metadata.description.as_deref(),
        source,
    )
    .map_err(|error| error.to_string())?;
    library
        .save_candidate(&candidate)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
#[test]
fn resumed_save_reuses_the_listened_reference() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("preview.wav");
    let mut writer = hound::WavWriter::create(
        &path,
        hound::WavSpec {
            channels: 1,
            sample_rate: 24000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )
    .unwrap();
    for index in 0..24000 {
        writer.write_sample((index % 16 * 90) as i16).unwrap();
    }
    writer.finalize().unwrap();
    let wav = std::fs::read(&path).unwrap();
    let candidate = talechime::VoiceCandidate::new(
        "casting-design",
        "Casting design",
        wav.clone(),
        "Preview text",
        Some("Warm speaking voice"),
        talechime::VoiceSource::Designed("engine".into()),
    )
    .unwrap();
    let metadata = candidate.asset().into();
    let library_path = root.path().join("library");
    let library = talechime::VoiceLibrary::open(&library_path).unwrap();
    save_with_library(&library, &path, &metadata).unwrap();
    drop(library);
    let reopened = talechime::VoiceLibrary::open(library_path).unwrap();
    std::fs::remove_file(&path).unwrap();
    save_with_library(&reopened, &path, &metadata).unwrap();
    assert_eq!(reopened.read_wav("casting-design").unwrap(), wav);
    assert_eq!(reopened.inventory().unwrap().assets.len(), 1);
}
