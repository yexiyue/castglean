//! 诊断与前端日志的 IPC 边界：清单先行、用户选择位置后打包；前端异常转发进同一管道。
use std::io::Write as _;

use serde::Serialize;
use specta::Type;
use tauri::Manager;

use super::log_dir;

/// 诊断相关的稳定失败码；界面按码映射文案，不透出底层错误。
#[derive(Debug, Serialize, Type, thiserror::Error)]
pub(crate) enum DiagnosticsError {
    #[error("log directory unavailable")]
    Unavailable,
    #[error("diagnostics write failed")]
    WriteFailed,
}

/// 清单里的一个日志文件：名称与大小，不含内容。
#[derive(Debug, Serialize, Type, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct DiagnosticsFileView {
    pub name: String,
    /// 文件大小；保留上限 32 MiB，i32 绰绰有余且为 specta 允许的安全整数。
    pub bytes: i32,
}

/// 导出前展示给用户的知情清单。
#[derive(Debug, Serialize, Type)]
pub(crate) struct DiagnosticsInventory {
    pub files: Vec<DiagnosticsFileView>,
    pub has_last_panic: bool,
    /// 摘要项（应用版本、平台、schema 版本、引擎盘点条数等），人读文本。
    pub summary: Vec<String>,
}

#[derive(Debug, Serialize, Type)]
pub(crate) struct DiagnosticsExportResult {
    pub path: String,
    pub bytes: i32,
}

fn inventory_files(dir: &std::path::Path) -> Result<Vec<DiagnosticsFileView>, DiagnosticsError> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|_| DiagnosticsError::Unavailable)? {
        let path = entry.map_err(|_| DiagnosticsError::Unavailable)?.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.starts_with(super::FILE_PREFIX) && name != "last_panic.v2.txt" {
            continue;
        }
        let bytes = std::fs::metadata(&path)
            .map_err(|_| DiagnosticsError::Unavailable)?
            .len();
        files.push(DiagnosticsFileView {
            name: name.to_owned(),
            bytes: i32::try_from(bytes).unwrap_or(i32::MAX),
        });
    }
    files.sort();
    Ok(files)
}

/// 导出前的知情清单：只列名称与大小，不读内容。
#[tauri::command]
#[specta::specta]
pub(crate) async fn diagnostics_inventory(
    app: tauri::AppHandle,
) -> Result<DiagnosticsInventory, DiagnosticsError> {
    let dir = log_dir(&app).ok_or(DiagnosticsError::Unavailable)?;
    let files = inventory_files(&dir)?;
    let has_last_panic = dir.join("last_panic.v2.txt").is_file();
    let summary = manifest_summary(&app).await;
    Ok(DiagnosticsInventory {
        files,
        has_last_panic,
        summary,
    })
}

/// 打包：最近日志文件 + `manifest.json` 环境摘要。不含工程数据与正文。
#[tauri::command]
#[specta::specta]
pub(crate) async fn diagnostics_export(
    app: tauri::AppHandle,
    destination: String,
) -> Result<DiagnosticsExportResult, DiagnosticsError> {
    let dir = log_dir(&app).ok_or(DiagnosticsError::Unavailable)?;
    let files = inventory_files(&dir)?;
    let manifest = serde_json::to_vec_pretty(&manifest_json(&app).await)
        .map_err(|_| DiagnosticsError::WriteFailed)?;
    let destination = std::path::PathBuf::from(destination);
    let writer = std::io::BufWriter::new(
        std::fs::File::create(&destination).map_err(|_| DiagnosticsError::WriteFailed)?,
    );
    let mut zip = zip::ZipWriter::new(writer);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut names = files
        .iter()
        .map(|file| file.name.clone())
        .collect::<Vec<_>>();
    names.push("manifest.json".into());
    for name in &names {
        let source = if name == "manifest.json" {
            None
        } else {
            Some(dir.join(name))
        };
        let bytes = match &source {
            None => manifest.clone(),
            Some(path) => std::fs::read(path).map_err(|_| DiagnosticsError::Unavailable)?,
        };
        zip.start_file(name.as_str(), options)
            .map_err(|_| DiagnosticsError::WriteFailed)?;
        zip.write_all(&bytes)
            .map_err(|_| DiagnosticsError::WriteFailed)?;
    }
    zip.finish().map_err(|_| DiagnosticsError::WriteFailed)?;
    let bytes = std::fs::metadata(&destination)
        .map_err(|_| DiagnosticsError::WriteFailed)?
        .len();
    tracing::info!(
        event = "diagnostics_exported",
        path = %destination.display(),
        entries = names.len(),
        bytes,
    );
    Ok(DiagnosticsExportResult {
        path: destination.display().to_string(),
        bytes: i32::try_from(bytes).unwrap_or(i32::MAX),
    })
}

/// 人读摘要行（清单 UI 展示用）。
async fn manifest_summary(app: &tauri::AppHandle) -> Vec<String> {
    let json = manifest_json(app).await;
    vec![
        format!("version: {}", json["version"].as_str().unwrap_or_default()),
        format!(
            "platform: {}",
            json["platform"].as_str().unwrap_or_default()
        ),
        format!("schema: {}", json["schema"]),
        format!(
            "engines: {}",
            json["engines"].as_array().map_or(0, Vec::len)
        ),
    ]
}

async fn manifest_json(app: &tauri::AppHandle) -> serde_json::Value {
    // 只记后端/模型/资源状态；路径与体积属于环境细节，不进摘要。
    let app_for_inventory = app.clone();
    let engines = tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_inventory.try_state::<crate::engine::EngineState>()?;
        tauri::async_runtime::block_on(crate::engine::catalog::list_models(&state)).ok()
    })
    .await
    .ok()
    .flatten()
    .map(|models| {
        models
            .into_iter()
            .map(|model| {
                serde_json::json!({
                    "backend": model.backend,
                    "model": model.model,
                    "resource": format!("{:?}", model.resource),
                })
            })
            .collect::<Vec<_>>()
    })
    .unwrap_or_default();
    let schema = match app.try_state::<sea_orm::DatabaseConnection>() {
        Some(db) => {
            use sea_orm::{ConnectionTrait, Statement};
            let db = db.inner().clone();
            tauri::async_runtime::spawn_blocking(move || {
                tauri::async_runtime::block_on(async move {
                    db.query_one_raw(Statement::from_string(
                        sea_orm::DbBackend::Sqlite,
                        "PRAGMA user_version",
                    ))
                    .await
                    .ok()
                    .flatten()
                    .and_then(|row| row.try_get::<i64>("", "user_version").ok())
                })
            })
            .await
            .ok()
            .flatten()
            .unwrap_or(0)
        }
        None => 0,
    };
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "platform": format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH),
        "schema": schema,
        "engines": engines,
        "generated_at": chrono_like_now(),
    })
}

/// 无 chrono 依赖的时间戳：Unix 秒足够 manifest 用途。
fn chrono_like_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0)
}

/// 前端只接受固定事件类别；任何未经信任的消息和堆栈都不进入日志。
#[tauri::command]
#[specta::specta]
pub(crate) async fn frontend_log(
    level: String,
    message: String,
    stack: Option<String>,
) -> Result<(), ()> {
    let _ = stack;
    let category = frontend_category(&message);
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", event = "frontend_error", category),
        "warn" => tracing::warn!(target: "frontend", event = "frontend_warn", category),
        "info" => tracing::info!(target: "frontend", event = "frontend_info", category),
        _ => tracing::debug!(target: "frontend", event = "frontend_debug", category),
    }
    Ok(())
}

fn frontend_category(value: &str) -> &'static str {
    match value {
        "script_error" => "script_error",
        "unhandled_rejection" => "unhandled_rejection",
        "render_error" => "render_error",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frontend_command_does_not_log_message_or_stack() {
        use std::sync::{Arc, Mutex};
        #[derive(Clone)]
        struct Capture(Arc<Mutex<Vec<u8>>>);
        impl std::io::Write for Capture {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(buf);
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let sink = Capture(bytes.clone());
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .with_writer(move || sink.clone())
            .finish();
        let _guard = tracing::subscriber::set_default(subscriber);
        frontend_log(
            "error".into(),
            "私人正文 sk-secret".into(),
            Some("stack sk-secret".into()),
        )
        .await
        .unwrap();
        let output = String::from_utf8(bytes.lock().unwrap().clone()).unwrap();
        assert!(output.contains("frontend_error"));
        assert!(output.contains("other"));
        assert!(!output.contains("私人正文"));
        assert!(!output.contains("sk-secret"));
    }

    #[test]
    fn frontend_categories_never_preserve_untrusted_content() {
        assert_eq!(frontend_category("script_error"), "script_error");
        assert_eq!(frontend_category("正文样本 sk-secret"), "other");
        assert_eq!(frontend_category("render_error\nsecret"), "other");
    }

    #[test]
    fn inventory_only_picks_log_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("castglean.log.v2.0000020768.0000000001"),
            "a",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("castglean.log.v2.0000020767.0000000000"),
            "bb",
        )
        .unwrap();
        std::fs::write(dir.path().join("last_panic.v2.txt"), "panic").unwrap();
        std::fs::write(dir.path().join("unrelated.txt"), "x").unwrap();
        std::fs::write(
            dir.path().join("castglean.log.2026-11-11"),
            "old private data",
        )
        .unwrap();
        std::fs::write(dir.path().join("last_panic.txt"), "old private data").unwrap();
        let files = inventory_files(dir.path()).unwrap();
        let names: Vec<_> = files.iter().map(|file| file.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "castglean.log.v2.0000020767.0000000000",
                "castglean.log.v2.0000020768.0000000001",
                "last_panic.v2.txt"
            ]
        );
        assert_eq!(files[0].bytes, 2);
    }

    #[test]
    fn export_zip_contains_only_logs_and_manifest() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("castglean.log.v2.0000020768.0000000001"),
            "log line",
        )
        .unwrap();
        // “敏感样本”：正文与密钥模式若混入目录也不得进包。
        std::fs::write(dir.path().join("novel.txt"), "吞噬星空私人正文").unwrap();
        std::fs::write(dir.path().join("api-key.txt"), "sk-secret").unwrap();
        let out = dir.path().join("diag.zip");
        let files = inventory_files(dir.path()).unwrap();
        let options = zip::write::SimpleFileOptions::default();
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(
            std::fs::File::create(&out).unwrap(),
        ));
        for file in &files {
            zip.start_file(file.name.as_str(), options).unwrap();
            zip.write_all(&std::fs::read(dir.path().join(&file.name)).unwrap())
                .unwrap();
        }
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(b"{}").unwrap();
        zip.finish().unwrap();
        let reader = zip::ZipArchive::new(std::fs::File::open(&out).unwrap()).unwrap();
        let names: Vec<String> = reader
            .file_names()
            .map(|name| name.expect("zip entry name").into_owned())
            .collect();
        assert_eq!(
            names,
            ["castglean.log.v2.0000020768.0000000001", "manifest.json"]
        );
    }
}
