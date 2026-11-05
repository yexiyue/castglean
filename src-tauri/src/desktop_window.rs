//! 窗口平台信息与统一关闭边界；工程和任务事实仍由各自领域持有。
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_specta::Event;

#[derive(Default)]
pub(crate) struct WindowLifecycle {
    closing: AtomicBool,
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
    active_tasks: u32,
}

#[tauri::command]
#[specta::specta]
pub(crate) fn window_close_context(app: tauri::AppHandle) -> Result<WindowCloseContext, String> {
    let voices = app
        .state::<crate::voices::VoiceState>()
        .active_transfers()?;
    let models = app
        .state::<crate::engine::EngineState>()
        .active_downloads()?;
    Ok(WindowCloseContext {
        active_tasks: voices
            + models
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
    let state = window.state::<WindowLifecycle>();
    state.closing.store(true, Ordering::Release);
    if let Err(error) = window.close() {
        state.closing.store(false, Ordering::Release);
        return Err(error.to_string());
    }
    Ok(())
}
