mod ai;
mod atomic_json;
mod chapter_analysis;
mod chapter_audio;
mod database;
mod desktop_window;
mod engine;
mod jobs;
mod llm;
mod logging;
mod novel_import;
mod project;
mod storage;
mod timestamp;
mod voice_binding;
mod voices;

use tauri::Manager;
use tauri_specta::{Builder as SpectaBuilder, ErrorHandlingMode, collect_commands};

/// 启动阶段计时（DEBUG 性能事件）；失败原样传回，由调用方决定处理。
fn stage<T, E>(name: &str, init: impl FnOnce() -> Result<T, E>) -> anyhow::Result<T>
where
    E: std::fmt::Display + Into<anyhow::Error>,
{
    let started = std::time::Instant::now();
    let outcome = init();
    tracing::debug!(
        target: "perf",
        event = "init_stage",
        stage = name,
        ok = outcome.is_ok(),
        duration_ms = started.elapsed().as_millis() as u64,
    );
    outcome.map_err(Into::into)
}

/// 集中注册 IPC 命令。独立成函数，供 `tests/specta_export.rs`
/// 在不启动应用的情况下导出 TypeScript bindings。
pub fn specta_builder() -> SpectaBuilder<tauri::Wry> {
    SpectaBuilder::new()
        // Throw 模式：生成的命令直接 throw，前端保持 try/catch 习惯，
        // 不引入 Result tuple 分支风格。
        .error_handling(ErrorHandlingMode::Throw)
        .commands(collect_commands![
            chapter_analysis::commands::chapter_analysis_result_target,
            chapter_analysis::commands::chapter_analysis_versions,
            chapter_analysis::commands::chapter_analysis_version_excerpt,
            chapter_analysis::commands::chapter_analysis_character_aliases,
            chapter_analysis::commands::chapter_analysis_character_usage,
            chapter_analysis::commands::chapter_analysis_character_edit,
            chapter_analysis::commands::chapter_analysis_candidate,
            chapter_analysis::commands::chapter_analysis_candidate_process,
            chapter_analysis::commands::chapter_analysis_start,
            chapter_analysis::commands::chapter_analysis_edit,
            chapter_analysis::commands::chapter_analysis_issues,
            chapter_analysis::commands::chapter_analysis_progress,
            chapter_analysis::commands::chapter_analysis_run_diagnostics,
            chapter_analysis::commands::chapter_analysis_ai_review,
            chapter_analysis::commands::chapter_analysis_excerpt,
            chapter_analysis::commands::chapter_analysis_directory,
            chapter_analysis::commands::chapter_analysis_snapshot,
            chapter_analysis::commands::chapter_analysis_segments,
            chapter_analysis::commands::chapter_analysis_characters,
            chapter_audio::commands::chapter_audio_arrangement_edit,
            chapter_audio::commands::chapter_audio_playback,
            chapter_audio::commands::chapter_audio_export,
            chapter_audio::commands::chapter_audio_export_status,
            chapter_audio::commands::chapter_audio_export_cancel,
            chapter_audio::commands::chapter_audio_summaries,
            chapter_audio::commands::chapter_audio_check,
            chapter_audio::commands::chapter_audio_start,
            chapter_audio::commands::chapter_audio_status,
            chapter_audio::commands::chapter_audio_active,
            chapter_audio::commands::chapter_audio_cancel,
            voice_binding::commands::voice_binding_bindings,
            voice_binding::commands::voice_binding_edit,
            voice_binding::commands::voice_binding_usage,
            voice_binding::commands::voice_binding_references,
            voice_binding::commands::voice_binding_profiles,
            voice_binding::commands::voice_binding_profile_set,
            voice_binding::commands::voice_binding_suggestion,
            voice_binding::commands::voice_binding_adopt_binding,
            voice_binding::commands::voice_binding_adopt_profile,
            ai::commands::ai_session_create,
            ai::commands::ai_sessions,
            ai::commands::ai_request_status,
            ai::commands::ai_history,
            ai::commands::ai_start,
            ai::commands::ai_cancel,
            ai::commands::ai_subscribe,
            ai::commands::ai_acknowledge,
            ai::commands::ai_unsubscribe,
            novel_import::splitting::commands::split_proposal,
            novel_import::splitting::commands::split_adopt,
            novel_import::splitting::commands::split_discard,
            project::local::local_project_create,
            project::local::local_project_snapshot,
            project::local::local_project_list,
            project::local::local_project_edit,
            project::local::local_project_text,
            project::local::local_project_undo,
            project::local::local_project_import,
            novel_import::selection::commands::local_source_select,
            novel_import::selection::commands::local_source_preview,
            novel_import::selection::commands::local_source_release,
            llm::commands::llm_snapshot,
            llm::commands::llm_update_connection,
            llm::commands::llm_delete_connection,
            llm::commands::llm_set_default,
            llm::commands::llm_list_remote_models,
            llm::commands::llm_probe,
            llm::commands::llm_cancel_probe,
            llm::commands::llm_cleanup_credentials,
            desktop_window::desktop_platform,
            desktop_window::window_close_context,
            desktop_window::confirm_window_close,
            logging::commands::frontend_log,
            logging::commands::diagnostics_inventory,
            logging::commands::diagnostics_export,
            voices::commands::list_library_voices,
            voices::commands::select_voice_packages,
            voices::commands::inspect_voice_packages,
            voices::commands::import_voice_entries,
            voices::commands::export_voice_entries,
            voices::commands::voice_transfer_tasks,
            voices::commands::cancel_voice_transfer,
            voices::commands::dismiss_voice_transfer,
            voices::commands::release_voice_selection,
            engine::commands::list_models,
            engine::designs::list_design_engines,
            voices::studio::commands::voice_studio_snapshot,
            voices::studio::commands::start_voice_job,
            voices::studio::commands::cancel_voice_job,
            voices::studio::commands::dismiss_voice_job,
            voices::studio::commands::select_voice_reference,
            voices::studio::commands::save_voice_candidate,
            voices::studio::commands::discard_voice_candidate,
            voices::studio::commands::voice_audio_lease,
            voices::studio::commands::voice_audio_waveform,
            voices::studio::commands::voice_reference_audio,
            voices::studio::commands::rename_library_voice,
            voices::studio::commands::describe_library_voice,
            voices::studio::commands::delete_library_voice,
            engine::commands::subscribe_model_resources,
            engine::commands::unsubscribe_model_resources,
            engine::commands::open_model_cache,
            engine::commands::clear_application_cache,
            engine::commands::get_engine_settings,
            engine::commands::update_engine_settings,
            storage::storage_locations,
            engine::commands::prepare_model,
            engine::commands::model_preparation_plan,
            engine::commands::cancel_prepare,
            engine::commands::pause_prepare,
            engine::commands::verify_model,
            engine::commands::get_storage_status,
        ])
        .events(tauri_specta::collect_events![
            desktop_window::WindowCloseRequested,
            voices::events::VoiceTransferEvent,
            voices::studio::StudioUpdate,
            chapter_audio::ChapterAudioUpdate,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta = specta_builder();

    let invoke_handler = specta.invoke_handler();
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("voice-audio", |context, request, responder| {
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(voices::studio::media::respond(&app, request));
            });
        })
        .register_asynchronous_uri_scheme_protocol(
            "chapter-audio",
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(chapter_audio::media::respond(&app, request));
                });
            },
        )
        .manage(desktop_window::WindowLifecycle::default())
        .manage(llm::commands::ProbeTasks::default())
        .plugin(
            tauri_plugin_snap_layout::init()
                .button_id("window-maximize")
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            specta.mount_events(app);
            // 日志最先初始化：后续所有阶段（含失败路径）都有地方可记。
            if let Err(error) = logging::init(app.handle()) {
                eprintln!("logging initialization failed: {error}");
            }
            let boot = std::time::Instant::now();
            if stage("storage", || storage::init(app.handle())).is_err()
                || stage("database", || database::init(app.handle())).is_err()
            {
                tracing::error!(event = "database_init_failed");
                desktop_window::database_unavailable(app.handle());
                return Ok(());
            }
            stage("llm", || llm::init(app.handle()))?;
            stage("jobs", || jobs::init(app.handle()))?;
            stage("novel_import", || novel_import::init(app.handle()))?;
            stage("engine", || engine::init(app.handle()))?;
            stage("voices", || voices::init(app.handle()))?;
            stage("chapter_audio", || chapter_audio::init(app.handle()))?;
            stage("desktop_window", || desktop_window::init(app.handle()))?;
            tracing::info!(
                event = "startup_complete",
                duration_ms = boot.elapsed().as_millis() as u64
            );
            Ok(())
        })
        .invoke_handler(move |invoke| {
            // A hidden WebView may finish loading while the startup error dialog
            // is open. Do not dispatch commands into uninitialized host states.
            if invoke
                .message
                .webview()
                .try_state::<sea_orm::DatabaseConnection>()
                .is_none()
            {
                invoke.resolver.reject("local_data_unavailable");
                return true;
            }
            invoke_handler(invoke)
        })
        .on_window_event(desktop_window::on_window_event)
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
                && let Some(state) = webview.try_state::<engine::EngineState>()
            {
                state.model_stream.disconnect(webview.label());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(desktop_window::on_run_event);
}
