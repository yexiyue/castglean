//! 引擎设置持久化：存储位置与下载源，版本化 JSON、原子写。
//!
//! 默认值（design D5）：共享 Hugging Face 缓存目录 + 官方端点；hf-hub 的
//! builder 默认是相对 cwd 的路径且不读环境变量，因此空值在组装
//! `DownloadConfig` 时被解析为显式绝对路径。
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub(crate) struct EngineSettings {
    /// 模型缓存目录；`None` 使用共享 Hugging Face 缓存
    /// （`~/.cache/huggingface/hub`，与其他 Hub 工具字节级兼容）。
    pub cache_dir: Option<PathBuf>,
    /// 下载源端点（如镜像 `https://hf-mirror.com`）；`None` 为官方端点。
    pub download_endpoint: Option<String>,
    /// 可选的 Hub 访问凭据；仅保存在本地应用配置目录，不入 Git。
    pub download_token: Option<String>,
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
        if let Some(dir) = &self.cache_dir
            && !dir.is_absolute()
        {
            return Err(format!("缓存目录必须是绝对路径：{}", dir.display()));
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
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let stored = StoredSettings {
        version: VERSION,
        settings: settings.clone(),
    };
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap_or(Path::new(".")))?;
    serde_json::to_writer_pretty(&mut temp, &stored)?;
    temp.flush()?;
    temp.persist(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_roundtrip_and_load_corrupt_falls_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("engine.json");
        assert_eq!(load(&path), EngineSettings::default());
        let settings = EngineSettings {
            cache_dir: Some(dir.path().to_path_buf()),
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
