# Proposal: host-logging-and-diagnostics

## 为什么

2026-11-11 用户真实生成失败只能靠只读数据库还原现场：应用没有日志系统（宿主仅 8 处 `eprintln!`，打包后无人可见；前端 JS 异常彻底消失；TaleChime/candle 发出的 tracing 事件因宿主不装 subscriber 全部丢弃）。用户反馈问题后没有可排查的依据。

调研结论（`docs/research/logging-and-diagnostics.md`）：采用 `tracing` 作为宿主唯一日志门面（TaleChime 已是 tracing 事件源），滚动文件 + 保留上限，应用内"导出诊断信息"支撑用户反馈闭环。

## 变更内容

- 宿主安装 tracing-subscriber：按天滚动日志文件（平台 `app_log_dir`）+ 非阻塞写线程 + 保留清理（天数与总量上限）；stdout 仅开发构建；`log` 门面依赖经 LogTracer 汇入。
- 日志分层规范化：定义 ERROR/WARN/INFO/DEBUG/TRACE 语义、target 命名（模块默认、`perf` 宿主性能、`talechime_perf` 引擎性能、`frontend` 前端）、结构化字段规范（身份 id + 度量 + 错误码）。
- 埋点：替换全部 `eprintln!`；补启动/迁移/任务生命周期/LLM 传输/下载关键事件；性能埋点（启动阶段、引擎加载、逐单元与整章合成耗时、LLM 请求时长、下载速率）。
- TaleChime 日志规范化：性能事件统一 target/字段/级别，补引擎加载与合成调用 span，裸 `info!` 降级，作为 path 依赖在宿主侧直接受益。
- 前端异常捕获：`window.onerror`、`unhandledrejection`、顶层 ErrorBoundary → IPC 命令进宿主同一 sink。
- 崩溃：panic hook 写同一 sink。
- 诊断导出：设置"关于"区入口，先展示清单（知情），用户选择位置后打包 zip（最近日志 + 版本/系统/schema 版本/引擎盘点摘要 + last_panic）。

## 影响与边界

影响：`src-tauri`（新 `logging` 模块 + 各模块埋点）、前端（异常捕获 + 设置入口）、TaleChime sibling 仓库（事件规范化，其自身测试需通过）。不改变任何业务行为与数据格式；日志不属于工程文件，不进 Git。

非目标：联网上报（Sentry/minidump 上传）、遥测、按 target 的运行时 UI 配置、远程日志收集、tauri-plugin-log 采用。

## 现状核对

- 现状与缺口见调研文档第 1 节；`docs/data-format.md` "合成与设计共用日志 1024 条/4 MiB"一句在本变更中核实并修正。
- 与 `chapter-audio-generation` 的 `error_detail` 关系：detail 落库不动（业务事实），日志补 run 生命周期上下文，两者以 run_id 关联。
