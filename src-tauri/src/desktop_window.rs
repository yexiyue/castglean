//! 窗口平台信息与统一关闭边界；工程和任务事实仍由各自领域持有。
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_specta::Event;

#[derive(Default)]
pub(crate) struct WindowLifecycle {
    closing: AtomicBool,
}

/// Failed storage initialization cannot fall through to an empty project UI or workers.
fn hide_failed_window(app: &tauri::AppHandle) {
    app.state::<WindowLifecycle>()
        .closing
        .store(true, Ordering::Release);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

pub(crate) fn database_unavailable(app: &tauri::AppHandle) {
    hide_failed_window(app);
    let exit = app.clone();
    app.dialog()
        .message(concat!(
            "无法打开本机工程数据库。已有文件未被清空。请保留应用数据目录，检查访问权限，并使用匹配数据库版本的应用重试。",
            "\n\nLocal project data could not be opened. Existing files are kept. Preserve the application data directory, check access permissions, and retry with an app version that supports this database."
        ))
        .title("CastGlean · 本机数据不可用 / Local data unavailable")
        .kind(MessageDialogKind::Error)
        .show(move |_| exit.exit(1));
}

pub(crate) fn database_incompatible(
    app: &tauri::AppHandle,
    owner: crate::jobs::RuntimeOwner,
    version: i64,
) {
    hide_failed_window(app);
    let root = crate::storage::data(app);
    let handle = app.clone();
    app.dialog()
        .message(format!(
            "此版本无法打开数据库（版本 {version}）。备份并重置后会重启到空工程列表，旧数据库保存在应用数据目录的 database-backups 文件夹。\n\nThis app cannot open database version {version}. Back up and reset to restart with an empty project list. The old database is kept in the database-backups folder inside the app data directory."
        ))
        .title("CastGlean · 数据库版本不兼容 / Incompatible database")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "备份并重置 / Back Up and Reset".into(),
            "退出 / Quit".into(),
        ))
        .show(move |confirmed| {
            if !confirmed {
                handle.exit(1);
                return;
            }
            tauri::async_runtime::spawn(async move {
                let result = crate::database::archive_incompatible(&root, version).await;
                drop(owner);
                match result {
                    Ok(_) => handle.request_restart(),
                    Err(error) => {
                        tracing::error!(event = "database_reset_failed", %error);
                        let exit = handle.clone();
                        handle.dialog()
                            .message(concat!(
                                "无法备份旧数据库。请关闭其他 CastGlean 实例并检查应用数据目录的访问权限。",
                                "\n\nThe database could not be backed up. Close other CastGlean instances and check permissions on the app data directory."
                            ))
                            .title("CastGlean · 重置失败 / Reset failed")
                            .kind(MessageDialogKind::Error)
                            .show(move |_| exit.exit(1));
                    }
                }
            });
        });
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DesktopPlatform {
    Macos,
    Windows,
    Linux,
}

#[tauri::command]
#[specta::specta]
pub(crate) fn desktop_platform() -> DesktopPlatform {
    if cfg!(target_os = "macos") {
        DesktopPlatform::Macos
    } else if cfg!(target_os = "windows") {
        DesktopPlatform::Windows
    } else {
        DesktopPlatform::Linux
    }
}

#[derive(Serialize, specta::Type)]
pub(crate) struct WindowCloseContext {
    pub(crate) active_tasks: u32,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn window_close_context(
    app: tauri::AppHandle,
) -> Result<WindowCloseContext, String> {
    let voices = app
        .state::<crate::voices::VoiceState>()
        .active_transfers()?;
    let models = app
        .state::<crate::engine::EngineState>()
        .active_preparations()?;
    let ai = crate::ai::active_tasks(app.state::<sea_orm::DatabaseConnection>().inner())
        .await
        .map_err(|_| "task_status_unavailable".to_owned())?;
    let chapter_audio = crate::chapter_audio::active_tasks(&app).await?;
    Ok(WindowCloseContext {
        active_tasks: chapter_audio
            + voices
            + models
            + u32::from(crate::engine::cuda::active(&app))
            + ai
            + app
                .state::<std::sync::Arc<crate::llm::LlmState>>()
                .active_foreground()
            + u32::from(app.state::<crate::voices::studio::StudioState>().active()),
    })
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
pub(crate) struct WindowCloseRequested;

fn request_close(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = WindowCloseRequested.emit_to(&window, "main");
    }
}

/// AppKit 的预定义 Quit 直接调用 terminate:，不会进入 Tauri ExitRequested。
/// 保留默认菜单及其本地化标题，只将退出替换成可拦截的应用菜单项。
pub(crate) fn init(app: &tauri::AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
        const QUIT: &str = "request-window-quit";
        fn replace_quit(
            app: &tauri::AppHandle,
            submenu: &Submenu<tauri::Wry>,
            title: &str,
        ) -> tauri::Result<()> {
            for (index, item) in submenu.items()?.iter().enumerate() {
                if let Some(nested) = item.as_submenu() {
                    replace_quit(app, nested, title)?;
                } else if let Some(predefined) = item.as_predefined_menuitem()
                    && predefined.text()? == title
                {
                    let replacement =
                        MenuItem::with_id(app, QUIT, title, true, Some("CmdOrCtrl+Q"))?;
                    submenu.remove(predefined)?;
                    submenu.insert(&replacement, index)?;
                }
            }
            Ok(())
        }
        let title = PredefinedMenuItem::quit(app, None)?.text()?;
        let menu = Menu::default(app)?;
        for item in menu.items()? {
            if let Some(submenu) = item.as_submenu() {
                replace_quit(app, submenu, &title)?;
            }
        }
        app.set_menu(menu)?;
        app.on_menu_event(|app, event| {
            if event.id().as_ref() == QUIT {
                request_close(app);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

pub(crate) fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == "main"
        && let tauri::WindowEvent::CloseRequested { api, .. } = event
        && !window
            .state::<WindowLifecycle>()
            .closing
            .load(Ordering::Acquire)
    {
        api.prevent_close();
        request_close(window.app_handle());
    }
}

pub(crate) fn on_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::ExitRequested { api, .. } = event
        && !app
            .state::<WindowLifecycle>()
            .closing
            .load(Ordering::Acquire)
    {
        api.prevent_exit();
        request_close(app);
    }
}

/// 唯一确认出口。前端不获得 destroy / exit 权限，原生与自绘按钮共用此边界。
#[tauri::command]
#[specta::specta]
pub(crate) fn confirm_window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("main window required".into());
    }
    let gate = window.state::<crate::desktop_updates::InstallGate>();
    let _admission =
        crate::desktop_updates::admit(gate.inner()).map_err(|()| "update_in_progress")?;
    let state = window.state::<WindowLifecycle>();
    state.closing.store(true, Ordering::Release);
    if let Err(error) = window.close() {
        state.closing.store(false, Ordering::Release);
        return Err(error.to_string());
    }
    Ok(())
}

pub(crate) fn restart_after_update(app: &tauri::AppHandle) -> ! {
    app.state::<WindowLifecycle>()
        .closing
        .store(true, Ordering::Release);
    app.restart()
}
