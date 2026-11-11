//! 章节音频域：合成单元构建、顺序生成任务、持久化与整章播放产物。
//!
//! 域契约：使用当前采用的章节分析与现有声音绑定，宿主拥有绑定到实际
//! 合成音色的解析；原文不可变，单元保存精确来源范围映射。执行复用引擎
//! 专用线程与试听互斥，不新增通用调度框架。
pub(crate) mod commands;
mod execution;
pub(crate) mod media;
pub(crate) mod plan;
pub(crate) mod store;
mod types;

pub(crate) use execution::run;
pub(crate) use store::ChapterAudioState;
pub(crate) use types::*;

use tauri::Manager;

/// 启动恢复后注册域状态：上次在途任务标为中断，不自动重新生成。
pub(crate) fn init(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    let root = app.path().app_data_dir()?.join("chapter-audio");
    std::fs::create_dir_all(&root)?;
    let state = ChapterAudioState::new(root);
    let db = app.state::<sea_orm::DatabaseConnection>().inner().clone();
    tauri::async_runtime::block_on(store::recover(&db, &state))
        .map_err(|_| tauri::Error::Io(std::io::Error::other("chapter audio recovery failed")))?;
    app.manage(state);
    Ok(())
}
