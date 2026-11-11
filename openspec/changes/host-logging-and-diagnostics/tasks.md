# Tasks

状态（2026-11-11）：宿主管道、埋点、TaleChime 规范化、前端捕获与诊断导出已实现；自动化门禁全绿，并完成一次真实应用冒烟（日志落盘、log→tracing 汇入、panic 落盘、`--verbose` 性能事件均实证）。**界面侧的真实验证未做**：导出按钮交互、前端异常注入与 4.2/4.4/4.5 对应的窗口检查保持未勾。

## 1. 管道与规范

- [x] 1.1 新增 `src-tauri/src/logging` 模块：tracing-subscriber 初始化（滚动文件 + 非阻塞写 + WorkerGuard 挂 managed state）、stdout 仅 `debug_assertions`、`--verbose` 启动参数提级 DEBUG、LogTracer 汇入 `log` 依赖。验证说明：subscriber 全局唯一，进程内单测会污染同进程其他测试，改以真实应用冒烟验证——INFO 启动序列落盘、apalis（`log` 门面）记录汇入、二进制直跑 `--verbose` 后 8 条 `init_stage` DEBUG 事件出现
- [x] 1.2 保留清理：启动时及运行期按 7 天窗口与 32 MiB 总量淘汰最旧受控分段；验证见 6.2
- [x] 1.3 分层与字段规范以 design.md D2 为本体，`logging.rs` 模块头注释引用；代码 review 清单并入验收记录
- [x] 1.4 panic hook：固定分类与行号写入日志及 `last_panic.v2.txt`，不转发可能泄露 payload 的默认 hook；修复后由子进程测试验证，真实窗口待重新验收

## 2. 宿主埋点

- [x] 2.1 替换全部非测试 `eprintln!`（lib.rs 数据库失败、engine.rs checkpoint、chapter_audio 失败/拼接、engine/events.rs 频道探针）为规范 tracing 事件
- [x] 2.2 生命周期事件：启动（版本/平台/arch/verbose）、各 init 阶段耗时（`perf` target DEBUG）、schema 迁移版本与耗时（`database_ready` INFO）、数据库不可用分支（ERROR）
- [ ] 2.3 章节音频：run 启动（INFO，run_id/units/backend/model）、逐单元完成（`perf` DEBUG，unit/duration_ms/bytes）、终态汇总（INFO，status/units/completed/failed_index/error_code）、resume（INFO）、恢复 interrupted（WARN）；**未完成**：当前 unit `duration_ms` 是音频时长，缺实际单元处理耗时及整章总耗时；章节代码由并行工作负责。
- [ ] 2.4 LLM 与下载：首字节时长/状态码（`perf` DEBUG，仅 host+status，不含请求体）、非成功请求（WARN，仅状态码）、下载 checkpoint 失败（WARN）、下载进度（`perf` DEBUG）。隐私边界为结构性实现（只记状态码与主机名）；首字节耗时已有，**完整 LLM 请求总耗时及重试次数尚未完成**；流结束、失败和取消均需明确计时边界与测试。
- [x] 2.5 性能 target `perf` 与引擎埋点：引擎加载耗时与合成耗时落在 TaleChime `talechime_perf`（见 3.2，宿主无需重复埋点即覆盖试听与整章两条路径）

## 3. TaleChime 规范化（sibling 仓库，未提交）

- [x] 3.1 统一 `talechime_perf` 事件字段：`seconds` → `duration_ms`（observation.rs、cosyvoice3/runtime.rs），事件名 snake_case，裸 `info!` 降 `debug!`（qwen3-tts profiling 提示）。`gpu_sync` target 属 CUDA-only 路径，保持不动（macOS 无影响，跨平台重构无当前收益）
- [x] 3.2 补 `engine_loaded`（backend/model/device/duration_ms，`Engine::load` 与 `prepare_in` 两条路径）与 `synthesis_stream_dropped`（state/chars/duration_ms，`PcmStream` Drop 发出，记录流存活时间）；talechime crate 增加 `tracing.workspace` 依赖
- [x] 3.3 TaleChime 自身测试通过（`cargo test -p talechime` 全绿，`cargo check -p talechime-backends --features performance-tools` 通过）；宿主 path 依赖重建后 379 项宿主测试全绿

## 4. 前端与诊断导出

- [x] 4.1 specta 命令 `frontend_log`（级别与事件类别白名单，丢弃消息/堆栈 → `frontend` target 事件）；保持现有 IPC 签名
- [ ] 4.2 全局 `window.onerror` + `unhandledrejection` + 顶层 ErrorBoundary 转发。代码已落地（`main.tsx` 装配、`app-error-boundary.tsx` 兜底 UI + 重载按钮）；纯函数（截断/分级）node 测试 4 项通过，**真实 WebView 注入异常的转发未验证**
- [x] 4.3 命令 `diagnostics_inventory`（清单）与 `diagnostics_export`（zip：最近日志 + manifest.json 应用/平台/schema/引擎盘点/last_panic）；验证：单测（清单只挑日志文件、zip 只含日志与 manifest、正文/密钥样本文件不进包）
- [ ] 4.4 设置"关于"区导出入口（清单展示 → 系统保存对话框 → 成功/失败回执，中英文案齐全）。代码已落地，tsc/Biome/构建/i18n 通过；**小窗口/亮暗主题与真实点击流未验证**
- [ ] 4.5 真实窗口验证：注入前端异常在日志文件可见；导出包可打开且清单一致。**未执行**

## 5. 验收与文档

- [x] 5.1 门禁：cargo fmt/clippy/test（379 项含新增 7 项 logging 测试）、rustdoc（0 警告）、tsc、Biome、node 测试、构建、`openspec validate` 全绿；TaleChime 自身测试同步通过
- [x] 5.2 隐私红线断言：异常采集边界与 panic hook 的正文/密钥样本测试；旧格式日志不纳入诊断包
- [x] 5.3 同步 `docs/data-format.md`（新增统一日志段落、删除已失效的"合成与设计共用日志"描述）、README、知识库索引与调研文档状态；记忆更新
- [ ] 5.4 真实应用冒烟：日志落盘、log→tracing 汇入、panic 落盘、`--verbose` 性能事件**已实证**（隔离标识 `com.yexiyue.castglean.logging20261111`，~/Library/Logs/ 下）；"生成→失败→按 run_id 检索→导出"完整闭环**未执行**（需窗口交互）。注：`pnpm tauri dev` 的 `--` 传参链路未把参数送到二进制，`--verbose` 冒烟用直跑 `target/debug/castglean --verbose` 完成

## 6. 审查修复（2026-11-11）

- [x] 6.1 前端异常和 panic 使用固定安全分类，保留旧日志但不将旧格式纳入诊断导出。
- [x] 6.2 后台日志按日和大小分段，运行期在新段写入前清理并预留容量；增加连续写入、重启和超大旧分段测试。
- [ ] 6.3 补齐章节单元处理耗时、整章总耗时、LLM 请求总耗时和重试次数，分别验证成功、失败、取消及恢复语义；不得把音频时长或首字节耗时当作请求总耗时。
