# Design

## 上下文

- 调研与选型依据：`docs/research/logging-and-diagnostics.md`。核心结论：tracing 为唯一门面（TaleChime/candle 已发 tracing 事件），tauri-plugin-log 不采用。
- 宿主初始化链（`lib.rs` setup）：database → llm → jobs → novel_import → engine → voices → chapter_audio → desktop_window。日志必须最先初始化（database 之前），且 panic hook 尽早安装。
- TaleChime 现有事件面：`talechime-backends`（observation.rs/performance.rs，target `talechime_perf`，字段 `event=...`/`seconds`）、talechime-core session span、qwen3-tts profiling 裸 `info!`、voxcpm/omnivoice `gpu_sync` 等，共约百处，风格不一。
- 前端无 `console.*`、无全局异常捕获；设置面板已有"关于"区（`about-settings.tsx`）。

## 目标 / 非目标

目标：宿主与前端全部可观测事件进同一本地文件（含引擎与崩溃）；分层与字段有规范可依；性能有埋点；用户反馈问题可一键导出诊断包。

非目标：联网上报、遥测、运行时 UI 级别调节（先 `--verbose` 启动参数）、JSON 行格式（人读优先）。

## 决策

### D1：tracing-subscriber Registry + 双 Layer；文件为主，stdout 仅开发

- 文件：受控分段 writer + `tracing_appender::non_blocking`，`WorkerGuard` 由 `LoggingState` 持有（AppHandle 生命周期）。
- 保留清理：启动时及每次分段轮转时，按 7 天窗口和 32 MiB 总量删除最旧受控分段；每段至多 1 MiB，按 UTC 日界轮转。新文件名前缀为 `castglean.log.v2.`，旧格式日志保留但不自动纳入导出。
- stdout：`cfg(debug_assertions)` 才装 fmt layer；发布构建安静。
- 级别过滤：默认 INFO；`talechime_perf` 与 `perf` target 默认 DEBUG（即默认不落盘），`--verbose` 启动参数把全局提到 DEBUG。用 `EnvFilter`（不带 env 变量读取，构造时写死 + 参数覆盖），避免环境变量意外注入。
- `log` 门面依赖（hf-hub 等）：`tracing_log::LogTracer` 汇入，级别映射后在同一过滤策略下。

理由：平台日志目录由 `app.path().app_log_dir()` 提供（无需插件）；非阻塞写线程避免推理热路径被 I/O 阻塞；按天轮转让"导出最近日志"就是拷贝最近 N 个文件。

### D2：分层与字段规范（本文档即规范，测试断言关键红线）

**级别语义**（从严到宽，写日志前先按此定级）：

| 级别 | 语义 | 例 |
| --- | --- | --- |
| ERROR | 用户可感知的失败或数据风险，需要人工介入 | 生成任务失败、数据库迁移失败、panic |
| WARN | 异常但已自动恢复/降级，值得关注 | 重试后成功、启动时把在途任务标为 interrupted、镜像回退续传 |
| INFO | 生命周期与里程碑，一次会话内数量有限 | 启动完成（含版本/平台）、迁移完成、任务开始/结束、引擎加载完成、导出诊断 |
| DEBUG | 细粒度过程与性能观测，默认关闭 | 逐单元合成完成、LLM 单次重试、下载 checkpoint、`talechime_perf`/`perf` 事件 |
| TRACE | 逐块/音素级，预留 | —— |

**target 命名**：

- 宿主业务事件：不指定 target，默认 `module_path!`（如 `castglean::chapter_audio::execution`）。
- 宿主性能事件：`perf`（如 `perf` target + `event=chapter_audio_unit` + `duration_ms`）。
- 引擎事件：TaleChime 统一 `talechime_perf`（见 D4）。
- 前端事件：`frontend`（异常捕获与显式上报）。

**字段规范**：全部 snake_case；身份类（`run_id`/`unit`/`media_id`/`request_id`/`backend`/`model`）、度量类（`duration_ms`/`bytes`/`chars`/`count`，带单位后缀）、错误类（`error_code` 稳定码 + `detail` 截断字符串）。事件名 `event` 字段用 snake_case 动词短语（`engine_loaded`、`unit_failed`）。

### D3：隐私红线（采集端执行，测试断言）

永不写入：小说正文与来源文本片段、LLM 请求/响应体、凭据与 API key、音色资产内容。执行手段是"只记 id 与度量"：单元日志只有 index/字节数/时长，异常 payload 一律不记录；只有确定不含用户内容的错误详情才可记录。诊断导出内容打包前以清单展示给用户（对齐 VS Code 知情模式）。测试：对代表性日志函数断言输出不含正文样本与 key 模式。

### D4：TaleChime 规范化（sibling 仓库改动，独立可测）

- 统一性能事件：`target: "talechime_perf"`、`event` 字段 snake_case、度量字段带单位（`duration_ms`/`bytes`），裸 `info!`（如 profiling 提示）降为 `debug!`。
- 补关键事件：`Engine::load` 完成事件（`event=engine_loaded`，backend/model/device/duration_ms）；合成流丢弃事件（`event=synthesis_stream_dropped`，state/chars/duration_ms），记录流存活时间，不将取消或提前丢弃视为合成成功。
- 已有 `talechime_perf` 事件（owner_pcm_ready/channel_wait 等）字段对齐：`seconds` → `duration_ms` 统一。
- TaleChime 自身测试（`cargo test -p ...` 相关 crate）保持通过；宿主通过 path 依赖直接获得，不需宿主适配代码。

### D5：前端异常捕获与上报

- `main.tsx` 装全局 `window.onerror` + `unhandledrejection`；顶层 React ErrorBoundary 包应用根。只捕获固定异常类别，不转发消息、堆栈或来源 URL；经 specta IPC 命令 `frontend_log` 以 `tracing::warn!/error!(target: "frontend", ...)` 进宿主 sink。
- 关键路径少量显式上报（生成启动、导出诊断）。不 hook `console.*`。

### D6：诊断导出

- 命令：`diagnostics_inventory`（只读清单：日志文件名与大小、将包含的摘要项）与 `diagnostics_export`（目标路径，写 zip）。
- zip 内容：最近 N 天日志文件（≤ 保留窗口）、`manifest.json`（应用版本、bundle id、OS 版本、CPU 架构、schema user_version、TaleChime 引擎盘点摘要（backend/model/status）、last_panic 截断）。
- UI：设置"关于"区"导出诊断信息"按钮 → 先展示清单 → 系统保存对话框（tauri-plugin-dialog 已接入）选位置 → 宿主写 zip → 回执路径。默认不含任何工程数据；正文永不进入。

### D7：panic hook

`std::panic::set_hook` 在 logging 初始化时装：panic 固定分类与行号以 ERROR 落同一 sink 并写 `app_log_dir/last_panic.v2.txt`（覆盖写，导出时纳入）；不输出 payload、源码路径或调用会原样打印 payload 的默认 hook。

## 风险与边界

- WorkerGuard 生命周期：由 Tauri managed state 持有到进程退出；drop 顺序在 Tauri 里由状态清理保证，崩溃前日志已在非阻塞队列，极端情况下可能丢最后几条（可接受，last_panic 文件兜底 panic 场景）。
- 磁盘：32 MiB 上限 + 7 天窗口双约束；用户目录无写权限时降级为仅 stdout（dev）并 WARN（记录到数据库不可用提示链路之外，不阻塞启动）。
- TaleChime 改动跨仓库：以 host path 依赖重新编译即生效；两个仓库需同时保持可构建（不提交 TaleChime 时宿主构建依赖本地未提交改动，与现有 candle patch 工作方式一致）。
- 格式：fmt 层默认文本格式（时间、级别、target、字段内联），不做 JSON；若未来需要机器解析再议。

## 工作量

宿主 subscriber/保留/panic hook（~1 天）；宿主埋点与 eprintln 替换（~1 天）；TaleChime 规范化（~0.5 天）；前端捕获 + 设置入口（~0.5 天）；诊断导出（~1 天）；测试与文档（~0.5 天）。
