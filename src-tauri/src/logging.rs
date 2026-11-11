//! 统一日志管道：tracing 门面、按天滚动文件、保留清理与 panic 记录。
//!
//! 分层与字段规范见 `openspec/changes/host-logging-and-diagnostics/design.md` D2：
//! ERROR 用户可感知失败、WARN 已自动恢复的异常、INFO 生命周期、DEBUG 细粒度与
//! 性能观测（默认关闭，`--verbose` 打开）。隐私红线：只记 id 与度量，正文与
//! 凭据永不落盘。
pub(crate) mod commands;
mod retention;

use std::path::PathBuf;

use tauri::Manager;
use tracing_subscriber::prelude::*;

/// 当前安全格式日志前缀；旧格式保留但不导出。
const FILE_PREFIX: &str = retention::PREFIX;
/// 保留窗口：删除早于该天数的受控分段。
const RETAIN_DAYS: u64 = 7;
/// 受控分段总量上限。
const RETAIN_BYTES: u64 = 32 * 1024 * 1024;

/// 持有非阻塞写线程的 guard 与日志目录；随应用生命周期存活。
pub(crate) struct LoggingState {
    _guard: tracing_appender::non_blocking::WorkerGuard,
    log_dir: PathBuf,
}

/// 宿主初始化的第一站：装好 subscriber 之后其余模块才能记录。
/// 失败不阻塞启动——退回仅 stdout（开发可见），功能照常。
pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let verbose = std::env::args().any(|arg| arg == "--verbose" || arg == "-v");
    let filter = tracing_subscriber::EnvFilter::new(if verbose { "debug" } else { "info" });
    let log_dir = app.path().app_log_dir();
    match log_dir {
        Ok(dir) => {
            std::fs::create_dir_all(&dir)?;
            let appender = retention::production(dir.clone(), RETAIN_BYTES, RETAIN_DAYS)?;
            let (writer, guard) = tracing_appender::non_blocking(appender);
            apply(filter, Some(writer));
            install_panic_hook(dir.clone());
            app.manage(LoggingState {
                _guard: guard,
                log_dir: dir,
            });
        }
        Err(error) => {
            // 无日志目录（权限/平台异常）：退化为仅 stdout，不阻塞应用。
            apply(filter, None);
            eprintln!("log directory unavailable, falling back to stdout only: {error}");
        }
    }
    tracing::info!(
        event = "startup",
        version = app.package_info().version.to_string(),
        platform = std::env::consts::OS,
        arch = std::env::consts::ARCH,
        verbose,
        "logging initialized"
    );
    Ok(())
}

/// 组装 subscriber：文件层必备，stdout 层仅开发构建；`log` 门面依赖汇入。
fn apply(
    filter: tracing_subscriber::EnvFilter,
    writer: Option<tracing_appender::non_blocking::NonBlocking>,
) {
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true);
    match writer {
        Some(writer) => {
            let layered = builder.with_writer(writer).with_ansi(false).finish();
            #[cfg(debug_assertions)]
            let layered = layered.with(tracing_subscriber::fmt::layer());
            layered.init();
        }
        None => builder.init(),
    }
}

fn panic_record(location: Option<&std::panic::Location<'_>>) -> String {
    // Panic payloads and full source paths may contain private data.
    let line = location.map_or(0, std::panic::Location::line);
    format!("panic (payload omitted), line {line}")
}

fn install_panic_hook(log_dir: PathBuf) {
    std::panic::set_hook(Box::new(move |info| {
        let record = panic_record(info.location());
        tracing::error!(target: "panic", event = "panic", detail = %record);
        // Fixed-size, sanitized fallback survives abort when the queue cannot flush.
        let _ = std::fs::write(log_dir.join("last_panic.v2.txt"), record);
    }));
}

pub(crate) fn log_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.try_state::<LoggingState>()
        .map(|state| state.log_dir.clone())
        .or_else(|| app.path().app_log_dir().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_hook_child() {
        let Some(dir) = std::env::var_os("CASTGLEAN_PANIC_TEST_DIR") else {
            return;
        };
        install_panic_hook(dir.into());
        let _ = std::panic::catch_unwind(|| panic!("私人正文 sk-secret"));
    }

    #[test]
    fn panic_hook_never_writes_payload_or_calls_default_hook() {
        let dir = tempfile::tempdir().unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "logging::tests::panic_hook_child", "--nocapture"])
            .env("CASTGLEAN_PANIC_TEST_DIR", dir.path())
            .output()
            .unwrap();
        assert!(output.status.success());
        let record = std::fs::read_to_string(dir.path().join("last_panic.v2.txt")).unwrap();
        assert!(record.contains("payload omitted"));
        for output in [&record[..], std::str::from_utf8(&output.stderr).unwrap()] {
            assert!(!output.contains("私人正文"));
            assert!(!output.contains("sk-secret"));
        }
    }

    #[test]
    fn panic_record_excludes_untrusted_payload_and_paths() {
        let record = panic_record(Some(std::panic::Location::caller()));
        assert!(record.contains("payload omitted"));
        assert!(!record.contains("logging.rs"));
    }
}
