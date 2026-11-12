//! 引擎域：TaleChime 的宿主接入层。
//!
//! 职责边界（design D1/D2）：引擎细节（hf-hub、缓存布局、清单格式）封在
//! 本模块内；IPC 命令只出现应用语义类型。状态的权威来源是离线盘点，
//! 下载/失败只是事件流上的任务视图。
pub(crate) mod catalog;
pub(crate) mod commands;
pub(crate) mod config;
pub(crate) mod designs;
pub(crate) mod events;
pub(crate) mod inventory;
mod preparation;
pub(crate) mod progress;
mod resource_tasks;
pub(crate) mod resources;

use std::{collections::HashMap, path::PathBuf};

use serde::{Deserialize, Serialize};

/// 模型中心的一个条目：真实构建支持 + 真实资源状态。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct ModelEntry {
    pub backend: String,
    pub model: String,
    pub name: String,
    pub compiled_devices: Vec<InferenceDevice>,
    pub available_devices: Vec<InferenceDevice>,
    pub voice_catalog: Vec<PresetVoice>,
    pub capabilities: ModelCapabilities,
    /// 预置音色数量（含引擎目录中已导入的自定义音色）。
    pub voices: u32,
    pub resource: ResourceState,
    pub unavailable_reason: Option<ModelUnavailableReason>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) enum ModelUnavailableReason {
    NoCompiledDevice,
    NoAvailableDevice,
}

/// Application device identity; engine-specific device types stay internal.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
pub(crate) enum InferenceDevice {
    Cpu,
    Metal,
    Cuda,
}
impl InferenceDevice {
    fn from_engine(device: talechime::Device) -> Option<Self> {
        match device {
            talechime::Device::Cpu => Some(InferenceDevice::Cpu),
            talechime::Device::Metal => Some(InferenceDevice::Metal),
            talechime::Device::Cuda => Some(InferenceDevice::Cuda),
            _ => None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct PresetVoice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
pub(crate) struct ModelCapabilities {
    /// 模型自带可用音色。
    pub preset: bool,
    /// 支持从参考录音导入音色。
    pub reference_cloning: bool,
    /// 支持风格指令。
    pub style: bool,
}

/// Stable resource identity shared by narration and design download journals.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ResourceKey {
    Synthesis { backend: String, model: String },
    Design { engine: String },
}
impl ResourceKey {
    fn model(backend: &str, model: &str) -> Self {
        Self::Synthesis {
            backend: backend.into(),
            model: model.into(),
        }
    }
    fn valid(&self) -> bool {
        match self {
            Self::Synthesis { backend, model } => {
                !backend.is_empty() && backend.len() <= 256 && model.len() <= 256
            }
            Self::Design { engine } => !engine.is_empty() && engine.len() <= 256,
        }
    }
}

/// 资源状态：盘点事实（权威）+ 任务视图（下载中/失败，经事件流推送）。
/// 应用重启后恢复暂停/中断事实，不自动执行。
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
        /// Smoothed resource-byte progress, not a network wire counter.
        bytes_per_second: Option<f64>,
        remaining_seconds: Option<f64>,
        stalled: bool,
    },
    Preparing {
        phase: PreparationPhase,
        component: String,
        completed: f64,
        total: f64,
    },
    Interrupted {
        phase: PreparationPhase,
        component: String,
    },
    Paused {
        downloaded_bytes: f64,
        total_bytes: f64,
        current_file: Option<String>,
    },
    Failed {
        error: PrepareFailure,
        /// 失败后盘点得到的待下载量，供重试确认使用。
        missing_bytes: f64,
    },
}

/// 应用阶段；转换进度与网络字节分开。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
pub(crate) enum PreparationPhase {
    Downloading,
    Converting,
    Verifying,
    Publishing,
    Cancelling,
}
impl ResourceState {
    pub(crate) fn active(&self) -> bool {
        matches!(self, Self::Downloading { .. } | Self::Preparing { .. })
    }
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
    Internal,
    Integrity,
    PlanChanged,
    Busy,
}

/// prepare 命令的结果语义。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub(crate) enum PrepareOutcome {
    Started,
    AlreadyReady,
    AlreadyPreparing,
    PlanChanged,
    /// 磁盘可用空间不足，下载未发起（字节量）。
    InsufficientSpace {
        available: f64,
        required: f64,
    },
}

/// 引擎状态：设置与路径。任务登记在引擎线程内（见 `resources`）。
pub(crate) struct EngineState {
    settings: std::sync::Mutex<config::EngineSettings>,
    task_states: std::sync::Mutex<HashMap<ResourceKey, ResourceState>>,
    resource_tasks: std::sync::Mutex<resource_tasks::ResourceTasks>,
    pub(super) model_stream: events::ModelStream,
    /// Tauri 在启动时解析的共享 Hugging Face 缓存默认目录。
    default_cache_dir: PathBuf,
    /// Application-owned data; never place writable engine data in the Hub cache.
    data_dir: PathBuf,
    app_cache_dir: PathBuf,
    active_data_dir: PathBuf,
    active_app_cache_dir: PathBuf,
    /// 设置文件路径。
    config_path: PathBuf,
}

impl EngineState {
    pub(crate) fn active_preparations(&self) -> Result<u32, String> {
        let states = self
            .task_states
            .lock()
            .map_err(|_| "model task lock unavailable")?;
        Ok(states.values().filter(|state| state.active()).count() as u32)
    }
    pub(crate) fn new(
        config_path: PathBuf,
        default_cache_dir: PathBuf,
        data_dir: PathBuf,
        app_cache_dir: PathBuf,
    ) -> Self {
        let settings = config::load(&config_path);
        let active_data_dir = settings
            .data_dir
            .as_ref()
            .map(|p| p.join("engine"))
            .unwrap_or_else(|| data_dir.clone());
        let active_app_cache_dir = settings
            .app_cache_dir
            .as_ref()
            .map(|p| p.join("engine"))
            .unwrap_or_else(|| app_cache_dir.clone());
        let cache = settings
            .cache_dir
            .clone()
            .unwrap_or_else(|| default_cache_dir.clone());
        let journal = resource_tasks::ResourceTasks::load(
            config_path.with_file_name("resource-preparations.json"),
            cache,
            active_data_dir.clone(),
            active_app_cache_dir.clone(),
            &data_dir,
            &app_cache_dir,
        );
        let task_states = std::sync::Mutex::new(journal.restored());
        Self {
            settings: std::sync::Mutex::new(settings),
            task_states,
            resource_tasks: std::sync::Mutex::new(journal),
            model_stream: Default::default(),
            config_path,
            default_cache_dir,
            data_dir,
            app_cache_dir,
            active_data_dir,
            active_app_cache_dir,
        }
    }

    pub(crate) fn settings(&self) -> config::EngineSettings {
        self.settings.lock().expect("engine settings lock").clone()
    }

    pub(crate) fn download_config(&self) -> anyhow::Result<talechime::DownloadConfig> {
        self.settings().download_config(&self.default_cache_dir)
    }

    fn registry_for(
        &self,
        settings: &config::EngineSettings,
    ) -> anyhow::Result<talechime::Registry> {
        talechime::Registry::with_storage_paths(
            self.active_data_dir.clone(),
            self.active_app_cache_dir.clone(),
            &settings.download_config(&self.default_cache_dir)?,
            Default::default(),
        )
    }
    pub(crate) fn registry(&self) -> anyhow::Result<talechime::Registry> {
        self.registry_for(&self.settings())
    }

    pub(crate) fn task_state(&self, backend: &str, model: &str) -> Option<ResourceState> {
        self.task_states
            .lock()
            .expect("task states lock")
            .get(&ResourceKey::model(backend, model))
            .cloned()
    }

    pub(crate) fn record_task_state(&self, backend: &str, model: &str, state: ResourceState) {
        self.record_resource_state(ResourceKey::model(backend, model), state);
    }
    pub(crate) fn resource_task_state(&self, key: &ResourceKey) -> Option<ResourceState> {
        self.task_states
            .lock()
            .expect("task states lock")
            .get(key)
            .cloned()
    }
    pub(crate) fn record_resource_state(&self, key: ResourceKey, state: ResourceState) {
        let mut states = self.task_states.lock().expect("task states lock");
        let force = !state.active() || !states.contains_key(&key);
        if matches!(
            state,
            ResourceState::Downloading { .. }
                | ResourceState::Preparing { .. }
                | ResourceState::Interrupted { .. }
                | ResourceState::Paused { .. }
                | ResourceState::Failed { .. }
        ) {
            states.insert(key, state);
        } else {
            states.remove(&key);
        }
        if let Err(error) = self
            .resource_tasks
            .lock()
            .expect("download journal lock")
            .save(&states, force)
        {
            tracing::warn!(event = "download_checkpoint_failed", detail = %error);
        }
    }
    pub(crate) fn persist_resource_tasks(&self) -> anyhow::Result<()> {
        let states = self.task_states.lock().expect("task states lock");
        self.resource_tasks
            .lock()
            .expect("download journal lock")
            .save(&states, true)
    }

    pub(crate) fn set_settings(&self, settings: config::EngineSettings) -> anyhow::Result<()> {
        settings.validate().map_err(anyhow::Error::msg)?;
        let mut current = self.settings.lock().expect("engine settings lock");
        let cache_changed = current
            .cache_dir
            .as_ref()
            .unwrap_or(&self.default_cache_dir)
            != settings
                .cache_dir
                .as_ref()
                .unwrap_or(&self.default_cache_dir);
        let data_changed = current.data_dir.as_ref().unwrap_or(&self.data_dir)
            != settings.data_dir.as_ref().unwrap_or(&self.data_dir);
        let app_cache_changed = current
            .app_cache_dir
            .as_ref()
            .unwrap_or(&self.app_cache_dir)
            != settings
                .app_cache_dir
                .as_ref()
                .unwrap_or(&self.app_cache_dir);
        let source_changed = cache_changed
            || data_changed
            || app_cache_changed
            || current.download_endpoint != settings.download_endpoint
            || current.download_token != settings.download_token;
        anyhow::ensure!(
            !source_changed || self.active_preparations().map_err(anyhow::Error::msg)? == 0,
            "请先完成或取消资源准备，再更改设置"
        );
        crate::storage::StorageRoots::resolve(
            &settings,
            self.data_dir
                .parent()
                .ok_or_else(|| anyhow::anyhow!("invalid data root"))?,
            self.app_cache_dir
                .parent()
                .ok_or_else(|| anyhow::anyhow!("invalid cache root"))?,
            &self.default_cache_dir,
        )
        .map_err(|_| anyhow::anyhow!("存储目录无效或互相重叠"))?;
        let mut active = settings.clone();
        active.data_dir = self
            .active_data_dir
            .parent()
            .map(std::path::Path::to_path_buf);
        active.app_cache_dir = self
            .active_app_cache_dir
            .parent()
            .map(std::path::Path::to_path_buf);
        crate::storage::StorageRoots::resolve(
            &active,
            self.data_dir
                .parent()
                .ok_or_else(|| anyhow::anyhow!("invalid data root"))?,
            self.app_cache_dir
                .parent()
                .ok_or_else(|| anyhow::anyhow!("invalid cache root"))?,
            &self.default_cache_dir,
        )
        .map_err(|_| anyhow::anyhow!("存储目录与当前使用的目录重叠"))?;
        self.registry_for(&settings)
            .map_err(|_| anyhow::anyhow!("存储目录无效或互相重叠"))?;
        config::save(&self.config_path, &settings)?;
        if cache_changed {
            let restored = self
                .resource_tasks
                .lock()
                .expect("download journal lock")
                .switch_scope(
                    settings
                        .cache_dir
                        .clone()
                        .unwrap_or_else(|| self.default_cache_dir.clone()),
                    self.active_data_dir.clone(),
                    self.active_app_cache_dir.clone(),
                );
            *self.task_states.lock().expect("task states lock") = restored;
            self.model_stream.clear();
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
    let data_dir = paths.app_data_dir()?.join("engine");
    let app_cache_dir = paths.app_cache_dir()?.join("engine");
    app.manage(EngineState::new(
        config_path,
        default_cache_dir,
        data_dir,
        app_cache_dir,
    ));
    app.manage(resources::EngineThread::start(app.clone())?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changing_engine_data_and_cache_roots_preserves_old_files_and_rejects_overlap() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data/engine");
        let cache = root.path().join("app-cache/engine");
        let state = EngineState::new(
            root.path().join("settings.json"),
            root.path().join("hub"),
            data.clone(),
            cache.clone(),
        );
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::write(data.join("voice"), b"keep voice").unwrap();
        std::fs::write(cache.join("calibration"), b"keep cache").unwrap();
        let next_data = root.path().join("next-data");
        let next_cache = root.path().join("next-cache");
        state
            .set_settings(config::EngineSettings {
                data_dir: Some(next_data.clone()),
                app_cache_dir: Some(next_cache.clone()),
                ..Default::default()
            })
            .unwrap();
        let registry = state.registry().unwrap();
        assert_eq!(registry.root(), data);
        assert_eq!(registry.cache(), cache);
        let restarted = EngineState::new(
            root.path().join("settings.json"),
            root.path().join("hub"),
            data.clone(),
            cache.clone(),
        );
        let registry = restarted.registry().unwrap();
        assert_eq!(registry.root(), next_data.join("engine"));
        assert_eq!(registry.cache(), next_cache.join("engine"));
        assert_eq!(std::fs::read(data.join("voice")).unwrap(), b"keep voice");
        assert_eq!(
            std::fs::read(cache.join("calibration")).unwrap(),
            b"keep cache"
        );
        let before = state.settings();
        let invalid = config::EngineSettings {
            app_cache_dir: Some(next_data.join("nested")),
            ..before.clone()
        };
        assert!(state.set_settings(invalid).is_err());
        assert_eq!(state.settings(), before);
        state.record_task_state(
            "moss",
            "nano",
            ResourceState::Downloading {
                downloaded_bytes: 0.0,
                total_bytes: 1.0,
                current_file: None,
                bytes_per_second: None,
                remaining_seconds: None,
                stalled: false,
            },
        );
        let busy = config::EngineSettings {
            data_dir: Some(root.path().join("other")),
            ..before.clone()
        };
        assert!(state.set_settings(busy).is_err());
        assert_eq!(state.settings(), before);
    }

    #[test]
    fn interrupted_download_restores_as_paused_without_active_work() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("settings.json");
        let cache = root.path().join("cache");
        let state = EngineState::new(
            path.clone(),
            cache.clone(),
            root.path().join("data/engine"),
            root.path().join("app-cache/engine"),
        );
        state.record_task_state(
            "moss",
            "nano",
            ResourceState::Downloading {
                downloaded_bytes: 123.0,
                total_bytes: 1000.0,
                current_file: Some("model".into()),
                bytes_per_second: Some(100.0),
                remaining_seconds: Some(8.0),
                stalled: false,
            },
        );
        state.persist_resource_tasks().unwrap();
        drop(state);
        let state = EngineState::new(
            path,
            cache,
            root.path().join("data/engine"),
            root.path().join("app-cache/engine"),
        );
        assert_eq!(state.active_preparations().unwrap(), 0);
        assert!(matches!(
            state.task_state("moss", "nano"),
            Some(ResourceState::Paused {
                downloaded_bytes: 123.0,
                ..
            })
        ));
    }

    #[test]
    fn task_snapshot_retains_progress_and_failure_but_clears_terminal_inventory() {
        let root = tempfile::tempdir().unwrap();
        let state = EngineState::new(
            root.path().join("engine.json"),
            root.path().join("shared-cache"),
            root.path().join("data/engine"),
            root.path().join("app-cache/engine"),
        );
        let progress = ResourceState::Downloading {
            downloaded_bytes: 3.0,
            total_bytes: 10.0,
            current_file: Some("model".into()),
            bytes_per_second: None,
            remaining_seconds: None,
            stalled: false,
        };
        state.record_task_state("moss", "nano", progress.clone());
        state
            .set_settings(config::EngineSettings {
                cache_dir: Some(root.path().join("shared-cache")),
                ..Default::default()
            })
            .unwrap();
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
            root.path().join("data/engine"),
            root.path().join("app-cache/engine"),
        );
        let settings = config::EngineSettings {
            cache_dir: Some(root.path().join("a")),
            ..Default::default()
        };
        state.set_settings(settings.clone()).unwrap();
        let old_layout = root.path().join("a/castglean");
        std::fs::create_dir_all(&old_layout).unwrap();
        std::fs::write(old_layout.join("old-data"), b"leave intact").unwrap();
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
                bytes_per_second: None,
                remaining_seconds: None,
                stalled: false,
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
        assert_eq!(first.root(), second.root());
        assert_ne!(
            first.downloads().cache_dir(),
            second.downloads().cache_dir()
        );
        assert_eq!(
            std::fs::read(first.root().join("sentinel")).unwrap(),
            b"keep"
        );
        assert_eq!(
            std::fs::read(old_layout.join("old-data")).unwrap(),
            b"leave intact"
        );
    }
}
