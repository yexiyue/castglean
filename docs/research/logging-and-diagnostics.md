# 桌面端日志与诊断系统调研

日期：2026-11-11。动因：用户真实生成失败（《吞噬星空》第 13 单元）只能靠只读数据库还原现场，应用没有任何可查的运行日志。本文回答：现状缺什么、主流方案是什么、CastGlean 应该怎么做。

**状态更新（同日）**：第 3 节推荐方案已按 [`host-logging-and-diagnostics`](../../openspec/changes/host-logging-and-diagnostics/proposal.md) OpenSpec 实施（宿主管道、埋点、TaleChime 规范化、前端捕获、诊断导出）。真实应用冒烟实证：INFO 启动序列与结构化字段落盘、`log` 门面依赖（apalis）汇入同一管道、真实 panic 记录（日志 + last_panic.txt）、`--verbose` 下 8 条 `init_stage` 性能事件。未做：界面侧窗口验收与"生成→按 run_id 检索→导出"完整闭环。

## 1. 现状盘点（2026-11-11）

| 层 | 现状 | 问题 |
| --- | --- | --- |
| Rust 宿主 | 无 `tracing`/`log`/`env_logger`/`tauri-plugin-log` 依赖；仅 8 处非测试 `eprintln!`（数据库初始化、下载 checkpoint、章节音频失败/拼接） | 只在开发构建的启动终端可见，打包后 stderr 无人看到；无级别、无轮转、无处可查 |
| 数据库 | schema v6 `chapter_audio_runs/units.error_detail`（本轮新增，截断 500 字符）；任务/回执表本身就是结构化"业务日志" | 只覆盖章节音频一个域；LLM、分章、归属分析、下载、试听都没有等价物 |
| 前端 | `console.*` 全零调用；无 window.onerror / unhandledrejection / ErrorBoundary 捕获 | WebView 里的 JS 异常彻底消失（开发时靠 devtools，用户侧无人知道） |
| 崩溃 | 无 panic hook（仅音色传输一处 `catch_unwind`）；未接 minidump/crashpad | Rust panic 与原生崩溃后无本地痕迹（macOS 系统会自动写 `~/Library/Logs/DiagnosticReports`，但用户不知道去哪找） |
| 引擎 | TaleChime 经 `tracing` 发性能事件（target `talechime_perf`：owner_pcm_ready、channel_wait 等）；candle 同为 tracing 事件源；`docs/data-format.md` 声称的"合成与设计共用日志 1024 条/4 MiB"在当前宿主代码中未找到落点，需在实施时核实（可能已失效或属引擎侧） | 宿主不装 subscriber，这些事件全部丢弃 |
| 导出 | 无"导出诊断"能力 | 用户反馈问题的唯一通道是口头描述+截图 |

结论：**没有日志系统**，只有零散 stderr 与本轮新加的单域 `error_detail`。用户反馈问题的排查流程目前不存在。

## 2. 主流方案与标准

### 2.1 Rust 日志门面与实现

| 方案 | 要点 | 适配度 |
| --- | --- | --- |
| **`tracing` + `tracing-subscriber` + `tracing-appender`** | 当前 Rust 生态事实标准；结构化字段（`run_id`、`unit` 直接是字段而非拼接字符串）、span、按 target 过滤；`rolling::daily` 轮转 + `non_blocking` 专用写线程（`WorkerGuard` 必须活到进程结束，否则丢尾部日志）；需自写保留策略（不清旧文件） | **高**：TaleChime/candle 已发 tracing 事件，装 subscriber 即免费获得引擎内部观测 |
| `log` + `env_logger`/`fern` | 老一代门面，纯文本无结构化字段；`log` 生态依赖经 `tracing-log::LogTracer` 可汇入 tracing | 低：单独采用等于放弃结构化与 TaleChime 事件 |
| `slog` | 结构化但生态萎缩 | 不考虑 |

### 2.2 Tauri 官方插件 `tauri-plugin-log`

- 官方插件，`log` 门面实现；targets：`Stdout`/`Stderr`/`Webview`（Rust 日志转发到 WebView 控制台）/`LogDir`（平台惯例目录：macOS `~/Library/Logs/<bundleId>`、Windows `%LOCALAPPDATA%\<bundleId>\logs`、Linux XDG data）/`Folder`。
- 轮转：`max_file_size`（默认超限整文件丢弃！需配 `RotationStrategy`）+ `KeepAll` 按时间轮转；曾有一个"运行中 `max_file_size` 不生效"的已知 bug（后续版本修复）。
- JS 侧 `attachConsole()`/`attachLogger()`：前端可把记录送进同一组 sink。
- 局限：`log` 门面（无 span/结构化字段）；要与 tracing 生态合流需要桥接；轮转与保留策略简单。

结论：它的独有价值（平台 LogDir 惯例、Webview 转发、JS API）要么 Tauri 已单独提供（`app.path().app_log_dir()`），要么可用 ~30 行自写代码补齐，不构成选它当核心的理由。

### 2.3 用户反馈闭环：诊断包（桌面应用通行做法）

VS Code 是参考范本：内置 Issue Reporter 自动附带版本、环境、扩展清单、启动耗时，**用户提交前可见全部内容**（知情同意）。通用做法：

1. 本地滚动日志文件（保留有限天数/容量）；
2. 应用内"导出诊断信息"按钮 → 打包最近日志 + 版本/系统/schema 版本/引擎资源盘点 +（可选）错误快照，用户主动发给你；
3. 隐私红线在采集端执行：**敏感内容不落日志**优于事后擦除（Skyflow/LogicMonitor 等实践共识：mask 保留结构、redact 保留上下文、最好根本不写）。

### 2.4 崩溃捕获（Rust 桌面）

主流：panic hook（Rust panic）+ minidump 进程外捕获（段错误/abort），`crashpad`/`minidumper`/`sentry-minidump`；Sentry Rust SDK 已内置原生 minidump 上报。对个人分发、无后端的 CastGlean：**联网上报暂不需要**——panic hook 写本地 + macOS 系统自动生成的 DiagnosticReports 已覆盖第一层；Sentry 属后续可选。

## 3. 推荐方案（供 OpenSpec 立项讨论）

**核心：宿主装 tracing-subscriber，tracing 为唯一日志门面。**

```
事件源                          汇聚层                          输出
────────                      ────────                      ────────
宿主模块（迁移/任务/引擎/LLM/IPC）  tracing 宏（结构化字段）      ┌ stdout fmt layer（仅 dev/verbose 启动）
TaleChime + candle（已有事件）  ─→  Registry subscriber   ─→  ├ rolling daily 文件 + non_blocking
log 门面依赖（hf-hub 等）        tracing-log::LogTracer 汇入    │   app_log_dir/castglean.log.*
前端 JS 异常/关键路径            IPC 命令 → 宿主 tracing 事件    └ 自清理：保留 N 天且总量上限
panic                          panic hook → 同一 sink + last_panic 标记
```

要点与理由：

1. **选 tracing 而非 tauri-plugin-log**：TaleChime/candle 的事件免费获得；结构化字段让"按 run_id 捞一次生成的全部记录"成为一行过滤；`error_detail` 的定位信息天然对齐。`log` 依赖用 `LogTracer` 汇入。不用 plugin 的 Webview 转发/JS API：dev 下 devtools 已够，用户侧价值在"前端异常进文件"——用现有 specta IPC 命令转发即可，不必引入插件权限面。
2. **输出目标**：文件为主（`app.path().app_log_dir()`，平台惯例免费）；stdout 仅开发构建或 `--verbose`。非阻塞写线程 + `WorkerGuard` 挂在 AppHandle 生命周期；按天轮转 + 自写保留（如 7 天 / 总量 32 MiB，超限删最旧）。
3. **事件分级与隐私红线（本项目特有）**：
   - 永不写入：小说正文/来源内容、LLM 对话内容、凭据、模型权重路径以外的用户路径偏好……执行原则是**只记 id 与度量**（run_id、unit index、字节数、时长、错误码+截断 detail），不记文本本身。
   - LLM 传输错误只记状态码/重试次数/端点 host，不记请求体。
   - 默认 INFO，引擎内部 target（`talechime_perf`）DEBUG 默认关、`--verbose` 开。
4. **前端**：`window.onerror` + `unhandledrejection` + 顶层 ErrorBoundary → 一个 IPC 命令进宿主 sink；关键路径（生成启动、播放器异常）补少量显式上报。不 hook console.*。
5. **诊断导出**：设置页"导出诊断信息"→ 宿主打 zip（最近日志 + app 版本/OS/schema 版本/引擎盘点摘要 + last_panic），系统保存对话框，用户自己发。导出内容在打包前列清单展示（对齐 VS Code 知情同意模式）。
6. **崩溃**：`std::panic::set_hook` 记录到同一 sink；minidump/Sentry 后置。

### 估计工作量（供排期参考，非承诺）

宿主 subscriber + 轮转/保留 + 模块埋点替换 eprintln（约 1.5 天）；前端异常捕获与 IPC 转发（0.5 天）；诊断导出 zip + 清单 UI（1 天）；隐私规则测试（只记 id 的断言测试）（0.5 天）。

## 4. 开放问题（立项时定）

- 保留策略具体值（天数/总量）与日志格式（默认 fmt 全格式 vs JSON——人读优先，暂建议 fmt 文本 + 结构化字段内联）。
- 既有 `error_detail` 与日志的关系：detail 落库不动（业务事实），日志补上下文链（run 生命周期事件），两者以 run_id 关联。
- `docs/data-format.md` 中"合成与设计共用日志 1024 条/4 MiB"一句的落点核实（疑似失效描述，需修正文档或找回实现）。
- 是否给 `-v/--verbose` 启动参数与日志级别运行时调节（第一版可只有启动参数）。

## 参考来源

- [Tauri Logging 官方插件](https://v2.tauri.app/plugin/logging/)、[JS API](https://v2.tauri.app/reference/javascript/log)、[crates.io](https://crates.io/crates/tauri-plugin-log)、[rotation bug #707](https://github.com/tauri-apps/plugins-workspace/issues/707)
- [tracing-appender 文档](https://docs.rs/tracing-appender/latest/tracing_appender)、[non_blocking 模块](https://docs.rs/tracing-appender/latest/tracing_appender/non_blocking/index.html)、[Tokio tracing 指南](https://tokio.rs/tokio/topics/tracing)、[non_blocking 丢日志讨论](https://github.com/tokio-rs/tracing/discussions/2276)
- [VS Code Issue Reporter / 性能问题流程](https://github.com/microsoft/vscode/wiki/Performance-Issues)、[VS Code 遥测与隐私 FAQ](https://code.visualstudio.com/docs/supporting/faq)
- 日志脱敏实践：[Skyflow 九条实践](https://www.skyflow.com/post/how-to-keep-sensitive-data-out-of-your-logs-nine-best-practices)、[LogicMonitor PII 处理](https://www.logicmonitor.com/blog/how-to-handle-sensitive-data-lm-logs)
- 崩溃捕获：[Jake Shadle: Crash reporting in Rust](https://jake-shadle.github.io/crash-reporting)、[sentry-minidump](https://lib.rs/crates/sentry-minidump)、[Sentry Rust SDK 原生崩溃](https://sentry.io/changelog/rust-sdk-0493-native-crash-reporting-minidumps)
