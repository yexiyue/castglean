# Proposal

## Why

分章诊断目前将对话、执行、候选与整个工程恢复状态绑定在 `recovery.json` 和 `DiagnosticSnapshot` 中，限制历史分页、任务复用及后续章节并发分析。建立本地数据库和独立后台执行边界，使关闭前端只解除订阅，历史、执行状态与业务事实可可靠恢复。

## What Changes

- 引入 SQLite 与 SeaORM 2.x 实体优先建模，以本地工程记录统一现有导入草案及工作状态；原始小说、不可变 UTF-8 正文、音频和音色资产继续存文件。
- 抽出通用 AI 会话、消息与执行三张核心表；消息 parts 承载文本、工具输入/结果及业务引用，分章候选独立保存。
- 引入 Apalis 持久队列与受控并发，复用宿主运行时；显式区分订阅断开、取消、失败重试和进程中断恢复。保留 graph-flow 现有诊断流程职责，不同时迁移为 Apalis 工作流。
- 以通用 Tauri 命令、恢复快照和增量 Channel 适配 AI SDK UI，业务状态通过独立查询/通知读取，不再持续推送整个分章状态作为聊天流。
- **BREAKING** 本地工作状态直接采用新数据库与新消息协议；移除旧恢复 JSON、旧分章专用消息与 `.castglean` 打开/保存路径，不提供迁移、双写或兼容适配层。已有本机文件不自动删除，不承诺读取。
- 暂不开发工程导出/另存为。主流程自动保存，不以另存为作为完成条件；音色包已有导入导出不受此范围调整影响。
- 按 KISS、DRY、YAGNI 与 SOLID 职责/依赖边界组织模块；参考官方 Entity、Worker handler 与 ChatTransport 实践，保留单 Rust crate，不增加通用 repository 框架或多实现兼容层。
- 不实施 AI 页面视觉重设计、章节分析业务或整书批处理；本轮验证通用运行时并发能力。

## Capabilities

### New Capabilities

- `local-project-storage`：本地工程数据库、受控文件资产、自动保存与存储初始化边界。
- `ai-task-sessions`：按任务划分的通用会话、消息、执行、恢复订阅与业务结果引用。
- `background-ai-execution`：持久调度、受控并发、取消、重试和宿主重启后的执行处理。

### Modified Capabilities

无。当前主规格仅有模型准备和音色搬运；分章规格仍位于已完成但未归档的 `add-assisted-chapter-splitting` 变更。本提案以新增能力补齐共享边界，明确替代其中的存储/传输实现与另存为要求；不修改该变更历史，不放宽来源、人工修正、采用与预算约束。后续同步规格时需一并消解重叠。

## Impact

- 宿主：`project`、`novel_import/store`、`storage`、诊断执行与命令、应用初始化和窗口退出上下文；新增私有数据库、AI 会话与后台调度模块。
- 前端：`diagnostic-transport.ts`、`diagnostic-stream.ts`、诊断页面及工程列表/保存入口、生成的 IPC bindings；沿用当前视觉体系。
- 依赖：SeaORM、迁移支持、Apalis 与 SQLite 后端；锁定相互兼容的版本。未核实存在独立 SeaORM 扩展，不据此承诺事务互操作。
- 数据：全新私有数据库、文件引用完整性；不导入旧恢复或 v2 工程。LLM 凭据仍留系统凭据库，TaleChime 音色库和模型缓存不迁移。
- 文档：README、数据格式、工程约定、桌面技术边界、分章验证和知识库索引同步新事实。
