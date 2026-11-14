//! 引擎设置持久化：存储位置与下载源，版本化 JSON、原子写。
//!
//! 默认值（design D5）：共享 Hugging Face 缓存目录 + 官方端点；hf-hub 的
//! builder 默认是相对 cwd 的路径且不读环境变量，因此空值在组装
//! `DownloadConfig` 时被解析为显式绝对路径。
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

const VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub(crate) struct EngineSettings {
    /// 模型缓存目录；`None` 使用共享 Hugging Face 缓存
    /// （`~/.cache/huggingface/hub`，与其他 Hub 工具字节级兼容）。
    pub cache_dir: Option<PathBuf>,
    /// 引擎持久数据根；`None` 使用宿主默认目录。
    pub data_dir: Option<PathBuf>,
    /// 引擎可再生缓存根；`None` 使用宿主默认目录。
    pub app_cache_dir: Option<PathBuf>,
    /// 下载源端点（如镜像 `https://hf-mirror.com`）；`None` 为官方端点。
    pub download_endpoint: Option<String>,
    /// 可选的 Hub 访问凭据；仅保存在本地应用配置目录，不入 Git。
    pub download_token: Option<String>,
}

/// Public projection of engine settings: stored credentials never cross IPC.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct EngineSettingsView {
    /// Opaque, process-local version of the current settings snapshot.
    pub revision: String,
    pub cache_dir: Option<PathBuf>,
    pub data_dir: Option<PathBuf>,
    pub app_cache_dir: Option<PathBuf>,
    pub download_endpoint: Option<String>,
    pub has_download_token: bool,
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum DownloadTokenChange {
    Keep,
    Replace { value: String },
    Remove,
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub(crate) struct EngineSettingsChange {
    pub expected_revision: String,
    pub cache_dir: Option<PathBuf>,
    pub data_dir: Option<PathBuf>,
    pub app_cache_dir: Option<PathBuf>,
    pub download_endpoint: Option<String>,
    pub download_token: DownloadTokenChange,
}

/// A fresh process starts a new version domain; versions are never persisted.
pub(crate) struct SettingsRevision(String);
impl Default for SettingsRevision {
    fn default() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }
}
impl SettingsRevision {
    pub(crate) fn current(&self) -> &str {
        &self.0
    }
    pub(crate) fn matches(&self, expected: &str) -> bool {
        self.0 == expected
    }
    pub(crate) fn advance(&mut self) {
        self.0 = uuid::Uuid::new_v4().to_string();
    }
}

/// Process-local receipts prevent a replay from applying an old edit again.
pub(crate) struct SettingsReceipts {
    salt: uuid::Uuid,
    entries: HashMap<String, ([u8; 32], Result<(), String>)>,
}

impl Default for SettingsReceipts {
    fn default() -> Self {
        Self {
            salt: uuid::Uuid::new_v4(),
            entries: HashMap::new(),
        }
    }
}

impl SettingsReceipts {
    pub(crate) fn execute(
        &mut self,
        id: &str,
        change: &EngineSettingsChange,
        write: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        uuid::Uuid::parse_str(id).map_err(|_| "无效的设置保存请求")?;
        struct DigestWriter(Sha256);
        impl std::io::Write for DigestWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.update(bytes);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut digest = DigestWriter(Sha256::new());
        digest.0.update(self.salt.as_bytes());
        serde_json::to_writer(&mut digest, change).map_err(|_| "无效的设置保存请求")?;
        let fingerprint: [u8; 32] = digest.0.finalize().into();
        if let Some((previous, result)) = self.entries.get(id) {
            return if previous == &fingerprint {
                result.clone()
            } else {
                Err("设置保存请求身份与内容不匹配".into())
            };
        }
        if self.entries.len() >= 4096 {
            return Err("本次会话的设置保存请求过多".into());
        }
        // Even an error can follow the atomic rename; never apply it twice.
        let result = write();
        self.entries
            .insert(id.to_owned(), (fingerprint, result.clone()));
        result
    }
}

impl EngineSettingsView {
    pub(crate) fn new(settings: &EngineSettings, revision: &str) -> Self {
        Self {
            revision: revision.to_owned(),
            cache_dir: settings.cache_dir.clone(),
            data_dir: settings.data_dir.clone(),
            app_cache_dir: settings.app_cache_dir.clone(),
            download_endpoint: settings.download_endpoint.clone(),
            has_download_token: settings.download_token.is_some(),
        }
    }
}

impl EngineSettingsChange {
    pub(crate) fn resolve(self, current: &EngineSettings) -> Result<EngineSettings, String> {
        let download_token = match self.download_token {
            DownloadTokenChange::Keep => current.download_token.clone(),
            DownloadTokenChange::Remove => None,
            DownloadTokenChange::Replace { value } if !value.trim().is_empty() => {
                Some(value.trim().to_owned())
            }
            DownloadTokenChange::Replace { .. } => return Err("访问凭据不能为空".into()),
        };
        Ok(EngineSettings {
            cache_dir: self.cache_dir,
            data_dir: self.data_dir,
            app_cache_dir: self.app_cache_dir,
            download_endpoint: self.download_endpoint,
            download_token,
        })
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredSettings {
    version: u32,
    #[serde(default)]
    settings: EngineSettings,
}

impl EngineSettings {
    /// 校验用户输入：缓存目录必须绝对路径；端点必须是 http(s) URL。
    pub(crate) fn validate(&self) -> Result<(), String> {
        for dir in [&self.cache_dir, &self.data_dir, &self.app_cache_dir]
            .into_iter()
            .flatten()
        {
            if !dir.is_absolute()
                || dir
                    .components()
                    .any(|part| matches!(part, std::path::Component::ParentDir))
            {
                return Err(format!(
                    "存储目录必须是绝对路径且不能包含上级目录：{}",
                    dir.display()
                ));
            }
        }
        if let Some(endpoint) = &self.download_endpoint {
            let valid = tauri::Url::parse(endpoint).is_ok_and(|url| {
                matches!(url.scheme(), "http" | "https")
                    && url.host_str().is_some()
                    && url.username().is_empty()
                    && url.password().is_none()
            });
            if !valid {
                return Err("下载源必须是无内嵌凭据的有效 http(s) URL".into());
            }
        }
        Ok(())
    }

    /// 组装引擎下载配置；空值落显式默认（绝不依赖 cwd 相对路径）。
    pub(crate) fn download_config(
        &self,
        default_cache_dir: &Path,
    ) -> anyhow::Result<talechime::DownloadConfig> {
        let cache_dir = self.cache_dir.as_deref().unwrap_or(default_cache_dir);
        anyhow::ensure!(
            cache_dir.is_absolute(),
            "下载缓存目录必须是绝对路径：{}",
            cache_dir.display()
        );
        Ok(talechime::DownloadConfig {
            cache_dir: cache_dir.to_path_buf(),
            endpoint: self.download_endpoint.clone(),
            token: self.download_token.clone(),
        })
    }
}

/// 读取设置；损坏的文件按默认值处理并会被下次保存覆盖。
pub(crate) fn load(path: &Path) -> EngineSettings {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return EngineSettings::default();
    };
    match serde_json::from_str::<StoredSettings>(&raw) {
        Ok(stored) if stored.version == VERSION && stored.settings.validate().is_ok() => {
            stored.settings
        }
        _ => EngineSettings::default(),
    }
}

/// 原子保存：同目录临时文件写入后替换。
pub(crate) fn save(path: &Path, settings: &EngineSettings) -> anyhow::Result<()> {
    let stored = StoredSettings {
        version: VERSION,
        settings: settings.clone(),
    };
    crate::atomic_json::save(path, &stored, None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_revision_rejects_old_snapshots_including_after_failed_attempts() {
        let mut revision = SettingsRevision::default();
        let initial = revision.current().to_owned();
        assert!(revision.matches(&initial));
        revision.advance();
        assert!(!revision.matches(&initial));
        let next = revision.current().to_owned();
        revision.advance(); // A write attempt may have committed before reporting failure.
        assert!(!revision.matches(&next));
        assert!(!SettingsRevision::default().matches(revision.current()));
    }

    #[test]
    fn old_settings_edit_is_rejected_and_replay_remains_idempotent() {
        let mut revision = SettingsRevision::default();
        let mut receipts = SettingsReceipts::default();
        let change = EngineSettingsChange {
            expected_revision: revision.current().to_owned(),
            cache_dir: None,
            data_dir: None,
            app_cache_dir: None,
            download_endpoint: Some("https://example.org".into()),
            download_token: DownloadTokenChange::Keep,
        };
        let first = uuid::Uuid::new_v4().to_string();
        receipts
            .execute(&first, &change, || {
                assert!(revision.matches(&change.expected_revision));
                revision.advance();
                Ok(())
            })
            .unwrap();
        let stale = uuid::Uuid::new_v4().to_string();
        let rejected = receipts.execute(&stale, &change, || {
            if !revision.matches(&change.expected_revision) {
                return Err("settings_conflict".into());
            }
            panic!("stale edit must not write")
        });
        assert_eq!(rejected, Err("settings_conflict".into()));
        receipts
            .execute(&first, &change, || panic!("replay must not write"))
            .unwrap();
        assert_eq!(
            receipts.execute(&stale, &change, || panic!("conflict must not write")),
            rejected
        );
    }

    #[test]
    fn settings_receipts_replay_without_writing_or_exposing_input() {
        let mut receipts = SettingsReceipts::default();
        let id = uuid::Uuid::new_v4().to_string();
        let change = EngineSettingsChange {
            expected_revision: "initial".into(),
            cache_dir: None,
            data_dir: None,
            app_cache_dir: None,
            download_endpoint: Some("https://example.org".into()),
            download_token: DownloadTokenChange::Replace {
                value: "synthetic-value".into(),
            },
        };
        receipts.execute(&id, &change, || Ok(())).unwrap();
        receipts
            .execute(&id, &change, || panic!("replayed write"))
            .unwrap();
        let mut other = change.clone();
        other.download_token = DownloadTokenChange::Remove;
        assert!(
            receipts
                .execute(&id, &other, || panic!("changed input"))
                .is_err()
        );
        let failed = uuid::Uuid::new_v4().to_string();
        assert!(
            receipts
                .execute(&failed, &change, || Err("write failed".into()))
                .is_err()
        );
        assert!(
            receipts
                .execute(&failed, &change, || panic!("replayed failure"))
                .is_err()
        );
    }

    #[test]
    fn replay_after_persisted_write_or_ambiguous_failure_preserves_later_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("engine.json");
        let mut receipts = SettingsReceipts::default();
        let change = EngineSettingsChange {
            expected_revision: "initial".into(),
            cache_dir: None,
            data_dir: None,
            app_cache_dir: None,
            download_endpoint: Some("https://first.example.org".into()),
            download_token: DownloadTokenChange::Keep,
        };
        for fail_after_save in [false, true] {
            let id = uuid::Uuid::new_v4().to_string();
            let result = receipts.execute(&id, &change, || {
                save(
                    &path,
                    &change.clone().resolve(&EngineSettings::default()).unwrap(),
                )
                .map_err(|error| error.to_string())?;
                if fail_after_save {
                    Err("synthetic sync failure".into())
                } else {
                    Ok(())
                }
            });
            assert_eq!(result.is_err(), fail_after_save);
            let later = EngineSettings {
                download_endpoint: Some("https://later.example.org".into()),
                ..EngineSettings::default()
            };
            save(&path, &later).unwrap();
            assert_eq!(
                receipts.execute(&id, &change, || panic!("replayed write")),
                result
            );
            assert_eq!(load(&path), later);
        }
    }

    #[test]
    fn credential_projection_and_changes_never_return_the_secret() {
        let current = EngineSettings {
            download_token: Some("private-test-token".into()),
            ..Default::default()
        };
        let view = EngineSettingsView::new(&current, "initial");
        assert!(view.has_download_token);
        assert!(
            !serde_json::to_string(&view)
                .unwrap()
                .contains("private-test-token")
        );
        let change = |download_token| EngineSettingsChange {
            expected_revision: "initial".into(),
            cache_dir: None,
            data_dir: None,
            app_cache_dir: None,
            download_endpoint: None,
            download_token,
        };
        assert_eq!(
            change(DownloadTokenChange::Keep)
                .resolve(&current)
                .unwrap()
                .download_token,
            current.download_token
        );
        assert_eq!(
            change(DownloadTokenChange::Replace {
                value: " new-token ".into()
            })
            .resolve(&current)
            .unwrap()
            .download_token
            .as_deref(),
            Some("new-token")
        );
        assert_eq!(
            change(DownloadTokenChange::Remove)
                .resolve(&current)
                .unwrap()
                .download_token,
            None
        );
        assert!(
            change(DownloadTokenChange::Replace { value: " ".into() })
                .resolve(&current)
                .is_err()
        );
    }

    #[test]
    fn defaults_roundtrip_and_load_corrupt_falls_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("engine.json");
        assert_eq!(load(&path), EngineSettings::default());
        let settings = EngineSettings {
            cache_dir: Some(dir.path().join("hub")),
            data_dir: Some(dir.path().join("data")),
            app_cache_dir: Some(dir.path().join("app-cache")),
            download_endpoint: Some("https://hf-mirror.com".into()),
            download_token: Some("hf_token".into()),
        };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
        for invalid in [
            "not json",
            r#"{"version":99,"settings":{}}"#,
            r#"{"version":1,"settings":{"cache_dir":"relative"}}"#,
            r#"{"version":1,"settings":{"download_endpoint":"https://"}}"#,
            r#"{"version":1,"settings":{"download_endpont":"https://example.com"}}"#,
            r#"{"version":1,"unexpected":true,"settings":{}}"#,
        ] {
            std::fs::write(&path, invalid).unwrap();
            assert_eq!(load(&path), EngineSettings::default(), "{invalid}");
        }
    }

    #[test]
    fn validate_rejects_relative_dirs_and_bad_endpoints() {
        EngineSettings {
            cache_dir: Some(PathBuf::from("relative/hub")),
            ..Default::default()
        }
        .validate()
        .unwrap_err();
        let root = tempfile::tempdir().unwrap();
        for settings in [
            EngineSettings {
                data_dir: Some(root.path().join("../data")),
                ..Default::default()
            },
            EngineSettings {
                app_cache_dir: Some(PathBuf::from("relative/cache")),
                ..Default::default()
            },
        ] {
            assert!(settings.validate().is_err());
        }
        EngineSettings {
            download_endpoint: Some("hf-mirror.com".into()),
            ..Default::default()
        }
        .validate()
        .unwrap_err();
        for endpoint in [
            "https://",
            "https:// bad",
            "https://user:secret@example.com",
        ] {
            assert!(
                EngineSettings {
                    download_endpoint: Some(endpoint.into()),
                    ..Default::default()
                }
                .validate()
                .is_err()
            );
        }
        EngineSettings::default().validate().unwrap();
    }

    #[test]
    fn download_config_uses_host_default_and_explicit_override() {
        let root = tempfile::tempdir().unwrap();
        let shared = root.path().join(".cache/huggingface/hub");
        let config = EngineSettings::default().download_config(&shared).unwrap();
        assert_eq!(config.cache_dir, shared);
        let custom = root.path().join("custom-cache");
        let config = EngineSettings {
            cache_dir: Some(custom.clone()),
            ..Default::default()
        }
        .download_config(&shared)
        .unwrap();
        assert_eq!(config.cache_dir, custom);
    }
}
