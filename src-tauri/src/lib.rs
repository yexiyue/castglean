mod desktop_window;
mod engine;
mod project;
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
            project::commands::save_project,
            project::commands::open_project,
            engine::commands::list_models,
            engine::commands::subscribe_model_resources,
            engine::commands::unsubscribe_model_resources,
            engine::commands::open_model_cache,
            engine::commands::get_engine_settings,
            engine::commands::update_engine_settings,
            engine::commands::prepare_model,
            engine::commands::cancel_prepare,
            engine::commands::verify_model,
            engine::commands::get_storage_status,
        ])
        .events(tauri_specta::collect_events![
            desktop_window::WindowCloseRequested,
            voices::events::VoiceTransferEvent,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta = specta_builder();

    let invoke_handler = specta.invoke_handler();
    tauri::Builder::default()
        .manage(desktop_window::WindowLifecycle::default())
        .plugin(
            tauri_plugin_snap_layout::init()
                .button_id("window-maximize")
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            specta.mount_events(app);
            engine::init(app.handle())?;
            voices::init(app.handle())?;
            desktop_window::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(invoke_handler)
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
