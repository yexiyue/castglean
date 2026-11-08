mod ai;
mod chapter_analysis;
mod database;
mod desktop_window;
mod engine;
mod jobs;
mod llm;
mod novel_import;
mod project;
mod timestamp;
mod voices;

use tauri::Manager;
use tauri_specta::{Builder as SpectaBuilder, ErrorHandlingMode, collect_commands};

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
            chapter_analysis::commands::chapter_analysis_excerpt,
            chapter_analysis::commands::chapter_analysis_directory,
            chapter_analysis::commands::chapter_analysis_snapshot,
            chapter_analysis::commands::chapter_analysis_segments,
            chapter_analysis::commands::chapter_analysis_characters,
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
            voices::studio::commands::delete_library_voice,
            engine::commands::subscribe_model_resources,
            engine::commands::unsubscribe_model_resources,
            engine::commands::open_model_cache,
            engine::commands::get_engine_settings,
            engine::commands::update_engine_settings,
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
            if let Err(error) = database::init(app.handle()) {
                eprintln!("local database initialization failed: {error}");
                desktop_window::database_unavailable(app.handle());
                return Ok(());
            }
            llm::init(app.handle())?;
            jobs::init(app.handle())?;
            novel_import::init(app.handle())?;
            engine::init(app.handle())?;
            voices::init(app.handle())?;
            desktop_window::init(app.handle())?;
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
