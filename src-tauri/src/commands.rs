//! Tauri IPC 命令薄壳。
//!
//! 命令只做参数解析与返回值包装，不持有业务逻辑；真实能力随宿主模块
//! 落地后按业务域拆分为 `commands/<域>.rs`。

/// 脚手架演示命令；首个真实命令落地后移除。
#[tauri::command]
#[specta::specta]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}
