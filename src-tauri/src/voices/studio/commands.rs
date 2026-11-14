//! IPC accepts semantic identities, never caller-provided filesystem paths.
use super::*;
use serde::Serialize;
use std::io::Read;
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_specta::Event;

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_studio_snapshot(
    state: State<'_, StudioState>,
) -> Result<StudioSnapshot, String> {
    let tasks = state.tasks.lock().map_err(|_| "studio unavailable")?;
    let jobs = tasks.snapshots();
    let sequence = tasks.revision();
    drop(tasks);
    let candidates = state
        .store
        .lock()
        .map_err(|_| "studio unavailable")?
        .candidates();
    Ok(StudioSnapshot {
        sequence,
        jobs,
        candidates,
    })
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn start_voice_job(
    app: tauri::AppHandle,
    key: String,
    request: StudioRequest,
) -> Result<u32, String> {
    validate(&request)?;
    // 章节生成独占引擎：新的试听/设计任务不排在整章合成之后。
    if app
        .state::<crate::chapter_audio::ChapterAudioState>()
        .active()
    {
        return Err("chapter audio generation is using the engine".into());
    }
    let (job, created) = app
        .state::<StudioState>()
        .tasks
        .lock()
        .map_err(|_| "studio unavailable")?
        .begin(key, request)?;
    if created {
        let _ = StudioUpdate(job.clone()).emit(&app);
        if let Err(error) = app
            .state::<crate::engine::resources::EngineThread>()
            .studio(job.clone())
            .await
        {
            app.state::<StudioState>().tasks.lock().unwrap().update(
                job.id,
                JobState::Failed,
                "failed",
                Some(Err(error.clone())),
            );
            return Err(error);
        }
    }
    Ok(job.id)
}
fn validate(request: &StudioRequest) -> Result<(), String> {
    match request {
        StudioRequest::Design {
            name,
            description,
            text,
            engine,
            ..
        } => {
            if name.trim().is_empty()
                || name.len() > 256
                || description.len() > 16_384
                || engine.is_empty()
            {
                return Err("invalid voice metadata".into());
            }
            validate_text(text)
        }
        StudioRequest::Audition { text, style, .. } => {
            if style.as_ref().is_some_and(|s| s.len() > 4096) {
                return Err("style is too long".into());
            }
            validate_text(text)
        }
        StudioRequest::PrepareDesign { engine } => {
            if engine.is_empty() || engine.len() > 128 {
                Err("invalid design engine".into())
            } else {
                Ok(())
            }
        }
    }
}
fn validate_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() || text.chars().count() > 500 || text.contains('\0') {
        Err("trial text requires 1..500 characters without NUL".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn cancel_voice_job(app: tauri::AppHandle, id: u32) -> Result<(), String> {
    let job = app
        .state::<StudioState>()
        .tasks
        .lock()
        .map_err(|_| "studio unavailable")?
        .cancel(id)?;
    StudioUpdate(job).emit(&app).map_err(|e| e.to_string())
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn select_voice_reference(
    app: tauri::AppHandle,
    key: String,
    name: String,
    transcript: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if name.trim().is_empty()
            || name.len() > 256
            || transcript.trim().is_empty()
            || transcript.len() > 16384
        {
            return Err("name and accurate transcript are required".into());
        }
        let state = app.state::<StudioState>();
        let mut receipts = state.references.lock().map_err(|_| "studio unavailable")?;
        receipts.execute(key, &name, &transcript, || {
            let window = app
                .get_webview_window("main")
                .ok_or("main window unavailable")?;
            let Some(path) = app
                .dialog()
                .file()
                .set_parent(&window)
                .add_filter("WAV", &["wav"])
                .set_title("选择 WAV 参考录音")
                .blocking_pick_file()
            else {
                return Ok(None);
            };
            let path = path.into_path().map_err(|e| e.to_string())?;
            let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
            let mut wav = Vec::new();
            file.take(25 * 1024 * 1024 + 1)
                .read_to_end(&mut wav)
                .map_err(|e| e.to_string())?;
            if wav.len() > 25 * 1024 * 1024 {
                return Err("reference exceeds 25 MiB".into());
            }
            let candidate = talechime::VoiceCandidate::new(
                &format!("voice-{}", uuid::Uuid::new_v4().simple()),
                &name,
                wav,
                &transcript,
                None,
                talechime::VoiceSource::Imported,
            )
            .map_err(|e| e.to_string())?;
            app.state::<StudioState>()
                .store
                .lock()
                .map_err(|_| "studio unavailable")?
                .add(candidate)
                .map(|view| Some(view.id))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn save_voice_candidate(
    app: tauri::AppHandle,
    id: String,
) -> Result<super::super::LibraryVoice, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<StudioState>();
        state
            .store
            .lock()
            .map_err(|_| "studio unavailable")?
            .save(&id, &app.state::<super::super::VoiceState>().library)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn discard_voice_candidate(
    state: State<'_, StudioState>,
    id: String,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "studio unavailable")?
        .discard(&id)
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_audio_lease(
    state: State<'_, StudioState>,
    id: String,
    playing: bool,
    lease: String,
) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|_| "studio unavailable")?;
    let media = store.media.get_mut(&id).ok_or("unknown audio")?;
    if lease.is_empty() || lease.len() > 64 {
        return Err("invalid playback lease".into());
    }
    if playing {
        media.leases.insert(lease);
    } else {
        media.leases.remove(&lease);
    }
    if media.leases.is_empty() && !media.retained {
        store.media.remove(&id);
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_audio_waveform(
    app: tauri::AppHandle,
    id: String,
) -> Result<VoiceWaveform, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<StudioState>();
        let file = {
            let store = state.store.lock().map_err(|_| "studio unavailable")?;
            let media = store.media.get(&id).ok_or("unknown audio")?;
            if let Some(waveform) = &media.waveform {
                return Ok(waveform.clone());
            }
            media.file.reopen().map_err(|e| e.to_string())?
        };
        let waveform = super::waveform::extract(file)?;
        let mut store = state.store.lock().map_err(|_| "studio unavailable")?;
        let media = store.media.get_mut(&id).ok_or("audio was released")?;
        media.waveform = Some(waveform.clone());
        Ok(waveform)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn voice_reference_audio(
    app: tauri::AppHandle,
    id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let wav = app
            .state::<super::super::VoiceState>()
            .library
            .read_wav(&id)
            .map_err(|e| e.to_string())?;
        let state = app.state::<StudioState>();
        let mut store = state.store.lock().map_err(|_| "studio unavailable")?;
        let audio = store.audio(&wav, Some(id))?;
        store.media.get_mut(&audio).unwrap().retained = false;
        Ok(audio)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn rename_library_voice(
    app: tauri::AppHandle,
    id: String,
    name: String,
    operation_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let voices = app.state::<super::super::VoiceState>();
        let mut receipts = voices.edits.lock().map_err(|_| "voice edit unavailable")?;
        receipts.execute(&operation_id, &id, "name", Some(&name), || {
            voices
                .library
                .rename(&id, &name)
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn describe_library_voice(
    app: tauri::AppHandle,
    id: String,
    description: Option<String>,
    operation_id: String,
) -> Result<(), String> {
    if let Some(text) = &description
        && text.trim().is_empty()
    {
        return Err("voice description cannot be blank".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let voices = app.state::<super::super::VoiceState>();
        let mut receipts = voices.edits.lock().map_err(|_| "voice edit unavailable")?;
        receipts.execute(
            &operation_id,
            &id,
            "description",
            description.as_deref(),
            || {
                voices
                    .library
                    .describe(&id, description.as_deref())
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Typed deletion block: busy work in flight, or projects still referencing the
/// voice through bindings, with the referencing targets for display.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum DeleteLibraryVoiceError {
    Busy,
    Unavailable,
    Referenced {
        references: Vec<crate::voice_binding::VoiceReferenceView>,
    },
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn delete_library_voice(
    app: tauri::AppHandle,
    id: String,
) -> Result<bool, DeleteLibraryVoiceError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<super::super::VoiceState>();
        let asset = state
            .library
            .get(&id)
            .map_err(|_| DeleteLibraryVoiceError::Unavailable)?;
        // Referenced assets are refused before any confirmation dialog, with the
        // referencing projects and targets so the user can go unbind first.
        let db = app.state::<sea_orm::DatabaseConnection>().inner().clone();
        let references =
            tauri::async_runtime::block_on(crate::voice_binding::references_with_titles(
                &db,
                &crate::voice_binding::VoiceRef::Library { id: id.clone() },
            ))
            .map_err(|_| DeleteLibraryVoiceError::Unavailable)?;
        if !references.is_empty() {
            return Err(DeleteLibraryVoiceError::Referenced { references });
        }
        let confirmed = app
            .dialog()
            .message(format!("删除音色「{}」？", asset.name()))
            .title("删除音色")
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show();
        if !confirmed {
            return Ok(false);
        }
        let studio = app.state::<StudioState>();
        tauri::async_runtime::block_on(remove_unreferenced(&db, &state, &studio, &id))?;
        Ok(true)
    })
    .await
    .map_err(|_| DeleteLibraryVoiceError::Unavailable)?
}

/// Recheck after confirmation and serialize the final check/removal with binding
/// publication. The dialog itself never holds this gate.
async fn remove_unreferenced(
    db: &sea_orm::DatabaseConnection,
    state: &super::super::VoiceState,
    studio: &StudioState,
    id: &str,
) -> Result<(), DeleteLibraryVoiceError> {
    let _guard = state.binding_changes.lock().await;
    let references = crate::voice_binding::references_with_titles(
        db,
        &crate::voice_binding::VoiceRef::Library { id: id.to_owned() },
    )
    .await
    .map_err(|_| DeleteLibraryVoiceError::Unavailable)?;
    if !references.is_empty() {
        return Err(DeleteLibraryVoiceError::Referenced { references });
    }
    remove_if_idle(state, studio, id)
}

fn remove_if_idle(
    state: &super::super::VoiceState,
    studio: &StudioState,
    id: &str,
) -> Result<(), DeleteLibraryVoiceError> {
    let jobs = studio
        .tasks
        .lock()
        .map_err(|_| DeleteLibraryVoiceError::Unavailable)?;
    let store = studio
        .store
        .lock()
        .map_err(|_| DeleteLibraryVoiceError::Unavailable)?;
    let transfers = state
        .transfers
        .lock()
        .map_err(|_| DeleteLibraryVoiceError::Unavailable)?;
    if jobs.active() || store.asset_busy(id) || transfers.occupied() {
        return Err(DeleteLibraryVoiceError::Busy);
    }
    state
        .library
        .remove(id)
        .map_err(|_| DeleteLibraryVoiceError::Unavailable)?;
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn dismiss_voice_job(
    state: State<'_, StudioState>,
    id: u32,
) -> Result<(), String> {
    let mut tasks = state.tasks.lock().map_err(|_| "studio unavailable")?;
    let mut store = state.store.lock().map_err(|_| "studio unavailable")?;
    let job = tasks
        .snapshots()
        .into_iter()
        .find(|job| job.id == id)
        .ok_or("unknown job")?;
    if let Some(audio) = &job.audio {
        if store.media.get(audio).is_some_and(|m| !m.leases.is_empty()) {
            return Err("stop playback first".into());
        }
        if job.candidate.is_none() {
            store.media.remove(audio);
        }
    }
    tasks.dismiss(id)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn deletion_rechecks_bindings_created_while_waiting_for_the_gate() {
        use sea_orm::{ActiveModelTrait, Set};
        let (root, db, project) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        let voices = super::super::super::VoiceState::new(root.path().join("voices")).unwrap();
        let asset = voices
            .library
            .save_candidate(&super::super::store::tests::candidate("protected"))
            .unwrap();
        let studio = StudioState {
            store: std::sync::Mutex::new(
                super::super::store::Store::new(root.path().join("cache")).unwrap(),
            ),
            tasks: Default::default(),
            references: Default::default(),
        };
        let gate = voices.binding_changes.lock().await;
        let deletion = remove_unreferenced(&db, &voices, &studio, asset.id());
        tokio::pin!(deletion);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), &mut deletion)
                .await
                .is_err()
        );
        crate::database::entity::voice_binding::ActiveModel {
            id: Set("binding".into()), project_id: Set("project".into()), target_kind: Set("narrator".into()),
            character_id: Set(String::new()), revision: Set(1),
            content: Set(serde_json::json!({"formatVersion": 1, "voice": {"kind": "library", "id": asset.id()}, "origin": {"origin": "manual"}, "updatedAt": "1"})),
        }.insert(&db).await.unwrap();
        drop(gate);
        let error = deletion.await.unwrap_err();
        let DeleteLibraryVoiceError::Referenced { references } = error else {
            panic!("binding must block deletion")
        };
        assert_eq!(references.len(), 1);
        assert_eq!(references[0].project_title, project.document.project.title);
        assert!(voices.library.get(asset.id()).is_ok());
    }

    #[test]
    fn deletion_protects_active_jobs_and_audio_leases_then_removes_only_target() {
        let root = tempfile::tempdir().unwrap();
        let voices = super::super::super::VoiceState::new(root.path().join("voices")).unwrap();
        let candidate = super::super::store::tests::candidate("voice-one");
        let asset = voices.library.save_candidate(&candidate).unwrap();
        let studio = StudioState {
            store: std::sync::Mutex::new(
                super::super::store::Store::new(root.path().join("cache")).unwrap(),
            ),
            tasks: Default::default(),
            references: Default::default(),
        };
        let (job, _) = studio
            .tasks
            .lock()
            .unwrap()
            .begin(
                "active".into(),
                StudioRequest::PrepareDesign {
                    engine: "fake".into(),
                },
            )
            .unwrap();
        assert!(remove_if_idle(&voices, &studio, asset.id()).is_err());
        studio
            .tasks
            .lock()
            .unwrap()
            .update(job.id, JobState::Succeeded, "done", None);
        let audio = studio
            .store
            .lock()
            .unwrap()
            .audio(candidate.wav(), Some(asset.id().into()))
            .unwrap();
        studio
            .store
            .lock()
            .unwrap()
            .media
            .get_mut(&audio)
            .unwrap()
            .leases
            .insert("player".into());
        assert!(remove_if_idle(&voices, &studio, asset.id()).is_err());
        assert_eq!(voices.library.list().unwrap().len(), 1);
        studio
            .store
            .lock()
            .unwrap()
            .media
            .get_mut(&audio)
            .unwrap()
            .leases
            .clear();
        voices.library.rename(asset.id(), "新名字").unwrap();
        let reopened = talechime::VoiceLibrary::open(voices.library.root()).unwrap();
        assert_eq!(reopened.get(asset.id()).unwrap().name(), "新名字");
        assert_eq!(reopened.read_wav(asset.id()).unwrap(), candidate.wav());
        remove_if_idle(&voices, &studio, asset.id()).unwrap();
        assert!(voices.library.list().unwrap().is_empty());
    }
}
