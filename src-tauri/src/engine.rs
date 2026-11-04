//! 引擎域：TaleChime 的宿主接入层。
//!
//! 职责边界（design D1/D2）：引擎细节（hf-hub、缓存布局、清单格式）封在
//! 本模块内；IPC 命令只出现应用语义类型。状态的权威来源是离线盘点，
//! 下载/失败只是事件流上的任务视图。
pub(crate) mod catalog;
pub(crate) mod commands;
pub(crate) mod config;
pub(crate) mod events;
pub(crate) mod inventory;
pub(crate) mod resources;

use std::{collections::HashMap, path::PathBuf};

use serde::{Deserialize, Serialize};

/// 模型中心的一个条目：真实构建支持 + 真实资源状态。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct ModelEntry {
    pub backend: String,
    pub model: String,
    pub name: String,
    pub capabilities: ModelCapabilities,
    /// 预置音色数量（含引擎目录中已导入的自定义音色）。
    pub voices: u32,
    pub resource: ResourceState,
    /// 本地转换型模型（Kokoro/CosyVoice3/IndexTTS）：资源来自本地转换，
    /// 无远端下载路径，准备入口应引导转换说明而非下载确认。
    pub convertible_locally: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
pub(crate) struct ModelCapabilities {
    /// 模型自带可用音色。
    pub preset: bool,
    /// 支持从参考录音导入音色。
    pub reference_cloning: bool,
    /// 支持文字描述生成声音（映射随 B2 音色中心接入细化）。
    pub text_design: bool,
    /// 支持风格指令。
    pub style: bool,
}

/// 资源状态：盘点事实（权威）+ 任务视图（下载中/失败，经事件流推送）。
/// 应用重启后无持久化任务，状态回归盘点结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub(crate) enum ResourceState {
    Ready,
    Missing {
        missing_bytes: f64,
    },
    Partial {
        ready: u32,
        total: u32,
        missing_bytes: f64,
    },
    Downloading {
        downloaded_bytes: f64,
        total_bytes: f64,
        /// 当前正在下载的文件名（任务视图瞬态，盘点不产生）。
        current_file: Option<String>,
    },
    Failed {
        error: PrepareFailure,
        /// 失败后盘点得到的待下载量，供重试确认使用。
        missing_bytes: f64,
    },
}

/// 类型化准备失败原因，对应 spec 的失败反馈要求。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
pub(crate) enum PrepareFailure {
    Network,
    Auth,
    RateLimited,
    NotFound,
    Cache,
    Disk,
    InsufficientSpace,
    Cancelled,
    Internal,
}

/// prepare 命令的结果语义。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub(crate) enum PrepareOutcome {
    Started,
    AlreadyReady,
    AlreadyPreparing,
    /// 磁盘可用空间不足，下载未发起（字节量）。
    InsufficientSpace {
        available: f64,
        required: f64,
    },
}

/// 引擎状态：设置与路径。任务登记在引擎线程内（见 `resources`）。
pub(crate) struct EngineState {
    settings: std::sync::Mutex<config::EngineSettings>,
    task_states: std::sync::Mutex<HashMap<(String, String), ResourceState>>,
    /// Tauri 在启动时解析的共享 Hugging Face 缓存默认目录。
    default_cache_dir: PathBuf,
    /// 设置文件路径。
    config_path: PathBuf,
}

impl EngineState {
    pub(crate) fn new(config_path: PathBuf, default_cache_dir: PathBuf) -> Self {
        let settings = config::load(&config_path);
        Self {
            settings: std::sync::Mutex::new(settings),
            task_states: Default::default(),
            config_path,
            default_cache_dir,
        }
    }

    pub(crate) fn settings(&self) -> config::EngineSettings {
        self.settings.lock().expect("engine settings lock").clone()
    }

    pub(crate) fn download_config(&self) -> anyhow::Result<talechime::DownloadConfig> {
        self.settings().download_config(&self.default_cache_dir)
    }

    pub(crate) fn task_state(&self, backend: &str, model: &str) -> Option<ResourceState> {
        self.task_states
            .lock()
            .expect("task states lock")
            .get(&(backend.to_owned(), model.to_owned()))
            .cloned()
    }

    pub(crate) fn record_task_state(&self, backend: &str, model: &str, state: ResourceState) {
        let mut states = self.task_states.lock().expect("task states lock");
        let key = (backend.to_owned(), model.to_owned());
        if matches!(
            state,
            ResourceState::Downloading { .. } | ResourceState::Failed { .. }
        ) {
            states.insert(key, state);
        } else {
            states.remove(&key);
        }
    }

    pub(crate) fn set_settings(&self, settings: config::EngineSettings) -> anyhow::Result<()> {
        let mut current = self.settings.lock().expect("engine settings lock");
        if current.cache_dir != settings.cache_dir {
            anyhow::ensure!(
                !self
                    .task_states
                    .lock()
                    .expect("task states lock")
                    .values()
                    .any(|state| matches!(state, ResourceState::Downloading { .. })),
                "请先完成或取消下载，再更改缓存目录"
            );
        }
        config::save(&self.config_path, &settings)?;
        if current.cache_dir != settings.cache_dir {
            self.task_states.lock().expect("task states lock").clear();
        }
        *current = settings;
        Ok(())
    }
}

/// 应用启动时装配引擎状态与引擎线程。
pub(crate) fn init(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    use tauri::Manager;
    let paths = app.path();
    let config_path = paths.app_config_dir()?.join("engine.json");
    let default_cache_dir = paths.home_dir()?.join(".cache/huggingface/hub");
    app.manage(EngineState::new(config_path, default_cache_dir));
    app.manage(resources::EngineThread::start(app.clone()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_snapshot_retains_progress_and_failure_but_clears_terminal_inventory() {
        let root = tempfile::tempdir().unwrap();
        let state = EngineState::new(
            root.path().join("engine.json"),
            root.path().join("shared-cache"),
        );
        let progress = ResourceState::Downloading {
            downloaded_bytes: 3.0,
            total_bytes: 10.0,
            current_file: Some("model".into()),
        };
        state.record_task_state("moss", "nano", progress.clone());
        assert_eq!(state.task_state("moss", "nano"), Some(progress));
        let failure = ResourceState::Failed {
            error: PrepareFailure::Network,
            missing_bytes: 7.0,
        };
        state.record_task_state("moss", "nano", failure.clone());
        assert_eq!(state.task_state("moss", "nano"), Some(failure));
        state.record_task_state("moss", "nano", ResourceState::Ready);
        assert_eq!(state.task_state("moss", "nano"), None);
    }

    #[test]
    fn changing_cache_switches_inventory_without_moving_old_files() {
        let root = tempfile::tempdir().unwrap();
        let state = EngineState::new(
            root.path().join("engine.json"),
            root.path().join("shared-cache"),
        );
        let settings = config::EngineSettings {
            cache_dir: Some(root.path().join("a")),
            ..Default::default()
        };
        state.set_settings(settings.clone()).unwrap();
        let first = catalog::registry(&state).unwrap();
        std::fs::create_dir_all(first.root()).unwrap();
        std::fs::write(first.root().join("sentinel"), b"keep").unwrap();
        let next = config::EngineSettings {
            cache_dir: Some(root.path().join("b")),
            ..settings
        };
        state.record_task_state(
            "moss",
            "nano",
            ResourceState::Downloading {
                downloaded_bytes: 0.0,
                total_bytes: 10.0,
                current_file: None,
            },
        );
        assert!(state.set_settings(next.clone()).is_err());
        assert_eq!(catalog::registry(&state).unwrap().root(), first.root());
        state.record_task_state(
            "moss",
            "nano",
            ResourceState::Missing {
                missing_bytes: 10.0,
            },
        );
        state.set_settings(next).unwrap();
        let second = catalog::registry(&state).unwrap();
        assert_ne!(first.root(), second.root());
        assert!(!second.root().exists());
        assert_eq!(
            std::fs::read(first.root().join("sentinel")).unwrap(),
            b"keep"
        );
    }
}
