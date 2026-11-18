# Design

## Context

四条链路的现状差异矩阵（2026-11-18 逐文件核实）：

| 维度 | 助手 | 分章 | 归属分析 | 选角 |
| --- | --- | --- | --- | --- |
| 模型循环 | rig-agent `Subagent` | 同（diagnose 内） | 同（逐窗 stage + review stage） | 同 |
| 工具事实 | `ToolDispatch`→共享 `ai_message` | 同 | 同（`agent_runtime`/`execution_agent`） | 同（含 `propose_auditions`） |
| 用量/预算 | `Output` + `runs::charge` | 同 | 同 | 同 |
| 归属记账 | run 本身 | `ai_invocation` | `ai_invocation` | `ai_invocation` |
| 编排 | 单循环 | **graph-flow 四节点图** | 宿主窗口流水线 | 单循环 + 审批四态恢复 |
| 检查点 | 无（事实即恢复） | `ai_run.checkpoint` blob | `analysis_window` 领域行 | 冻结输入 + 审批记录 |
| Hook | 自有（含任务边界停止） | 复用助手 Hook | 自有 | 自有 |

graph-flow 实际提供的只有节点转移、`Session` 结构、`SessionStorage` 抽象、`WaitForInput` 枚举；版本 CAS、`last_tool` 工具边界、scope 校验、600 秒超时全是宿主代码。冻结输入表（`analysis_input`/`casting_input`）与「按执行身份与持久事实恢复」已是归属与选角的既有模式。

## Goals / Non-Goals

**Goals**

- 四条链路收敛为**同一份成文骨架契约**，消除「每条链路一套恢复/编排心智」的混乱；
- graph-flow 删除，分章成为骨架契约的普通实例；
- 三处 Hook 的公共部分单一路径化，事实记录与用量不再有漂移空间。

**Non-Goals**

- **不提取通用编排框架**（无 `AgentPipeline` trait、无通用节点抽象）——统一靠成文契约与同构布局，不做运行时泛化；共享 Hook 是唯一例外（见决策 4，事实路径重复是真实痛点）；
- 不做并行 invocation、生产目标链、WorkspaceContext 下沉（各自独立 OpenSpec）；
- 不迁移任何旧格式数据，不做旧在途 run 的兼容解码；
- 不动候选/绑定/审批格式、数据库 schema、前端。

## Decisions

### 1. 骨架契约成文（统一的主交付物）

以下六条写进 `docs/engineering.md`，四条链路逐一对照审计：

1. **冻结输入**：每个领域先冻结自足输入（`analysis_input`/`casting_input`；助手用 `workspace_context`，分章用 run 上的 revision+源哈希）；
2. **阶段序列**：编排 = 确定性代码阶段与 agent 循环阶段的线性序列，无图、无隐藏 runner；
3. **领域行检查点**：多产物阶段每步先落库再继续（`analysis_window` 模式）；线性小状态可用 run 列（分章 checkpoint），禁第三种形态；
4. **运行状态**：`Ok(())` 交由宿主收尾。有待答复的持久 AG-UI interrupt 时，run 为 `waiting_for_input`，相关 invocation 为 `suspended`。没有待答复中断时，run 为 `succeeded`，候选仍可处于领域待审阅状态。失败与取消沿用宿主终态。
5. **恢复身份**：订阅重连读取已持久化事实。队列重复投递沿用同一执行身份，由领取 CAS 去重。有效人工答复继续原任务，沿用持久审批回执的消费关系。显式重试创建关联原执行的新 run，从冻结输入和持久事实重建，保留已完成工具与试听结果，未知的远程执行结果禁止盲目重放。
6. **归属与记账**：专业任务一律 `ai_invocation`，工具事实一律 `ToolDispatch` 共享消息路径，用量一律 `Output`。

### 2. 分章 pipeline：宿主状态机 + 简化检查点

`Phase {Prepare, Diagnose, Validate, Review}` + 唯一转移函数：新 run→Prepare；Prepare→Diagnose；Diagnose 模型轮自然结束→Validate；Validate→Review→`Ok(())`。Review 表示可供人工审阅的领域阶段。新诊断 turn 从 Prepare 开始，从 Validate 恢复直接校验并进入 Review。检查点简化为 `{version, phase, last_tool}`。`version` 是阶段保存的 CAS 版本。阶段保存从锁内当前行合并最近的工具边界，候选与工具边界仍在同一事务。`prepare`/`validate` 的 scope 与源文件校验每阶段重查；600 秒超时保持在 `ai/tasks.rs`。

Rig 的工作流文档以普通 Rust 的函数与控制流串接确定性阶段，所以分章外层使用宿主状态机，诊断阶段调用现有 `AgentRunner`。[Rig Workflows](https://www.rig.rs/docs/concepts/chains)

Rig 的 `AgentRun` 可以序列化模型历史、预算和待执行调用，由应用在恢复后驱动。CastGlean 已将待审批计划、回执、尝试身份、消息事实和领域产物持久化，审批继续按这些记录还原。若将来采用 `AgentRun`，仍需定义其与宿主记录的事务一致性、工具重放和跨版本边界。[Rig Durable Runs](https://www.rig.rs/docs/concepts/runs)

### 3. 兼容性立场：不考虑旧在途 run

用户拍板。升级时已开始且中断的分章 run 恢复失败（`InvalidResponse`），用户重发任务；排队未开始的已接受意图走队列记录恢复派发，不受影响。归属与选角格式本次不动，其升级时在途 run 恢复正常。用户工程数据（正文、修正、候选、绑定、历史结果）不动。

### 4. 共享 Hook 整合

三处 `AgentHook` 的公共路径（`on_dispatch` 的 start/工具 begin、`on_outcome` 的 usage + 工具 complete、取消处理、失败暂存）提取为 `ai/` 下共享实现；域差异（助手的任务边界停止表、选角的 draft 失败旗标、归属的窗口持久化）以显式回调注入。备选方案（保留三份 Hook 仅文档化约定）被否：事实记录路径的漂移正是本次要消除的混乱源之一，且三份实现的公共部分占大头。

归属分析继续使用摘要记录参数与结果。选角工具仍使用同源 Schema，字符串候选回执保留位置与合法示例，累计三次参数或计划校验失败停止。审批计划和成功工具回执在同一 SQLite 事务提交，随后停止模型循环，审批恢复、决定重放、合成尝试与建议发布去重由选角域负责。迁移时覆盖这些回归。

#### Rig 0.46 原生能力对照

| 能力 | CastGlean 的用法 |
| --- | --- |
| `AgentRunner`、`AgentHook`、类型化 `Tool` | 由 Rig 执行模型与工具回合。持久化 Hook 通过 `observes` 订阅所需事件，以 `ToolOutput::as_json` 读取结构化回执。选角参数由 Rig 的 `args_schema` 从 Serde/Schemars 类型生成。 |
| `MockCompletionModel`、HTTP/SSE 夹具 | 选角修复循环由 Rig 自带的脚本模型驱动，覆盖真实工具和 SQLite 回执。传输测试保留本机 HTTP/SSE 夹具，核对请求封装、流式解析和提前断开。 |
| `Extractor`、`prompt_typed` | 适合独立的纯结构化抽取或最终结构化答复。选角和归属提交还需要比对冻结输入、返回领域修复反馈和管理持久化边界。 |
| `AgentRun`、Recording & Replay | `AgentRun` 适合恢复到 Rig 内部的待执行调用，当前产品恢复点是已持久化的业务步骤。开发测试使用 `rig-cassette` 录制和重放合成输入。项目历史与审批回执由 SQLite 保存。Rig 0.46 的 `Agent::resume` 会重新派发未收到回执的调用，宿主审批恢复仍以已提交的回执和尝试身份为准。 |
| 流式事件、共享工具表与 `ToolContext` | 助手已读取 Rig 的流式事件，宿主负责 AG-UI 与消息落库。工程助手和分章通过官方 `ToolServer` 按作用域注册，测试也从同一注册表调用。锁定版本的 Hook 能读取 `ToolContext`，业务工具仍通过已受理调用取得事务身份。 |

[Rig AgentRunner](https://www.rig.rs/docs/concepts/agentrunner) · [Rig Hooks](https://www.rig.rs/docs/concepts/hooks) · [Rig Tools](https://www.rig.rs/docs/concepts/tools) · [Rig Testing](https://www.rig.rs/docs/concepts/testing) · [Rig Structured Output](https://www.rig.rs/docs/concepts/extractors) · [Rig Recording & Replay](https://www.rig.rs/docs/concepts/recording) · [Rig Streaming](https://www.rig.rs/docs/concepts/streaming)

### 5. 命名与布局约定

入口统一 `execute()`、冻结统一 `freeze()`、恢复统一 `resume()`（选角/归属已基本符合）；编排文件统一 `pipeline.rs` 名（分章从 `graph.rs` 改名）；领域私有草稿保持在领域模块内（`agent_core`/`draft`），不上升为共享抽象。

## Risks / Trade-offs

- [Hook 整合的语义回归：三处边界停止逻辑有真实差异] → 按链路分阶段迁移，每迁移一条跑该链路全部库测试 + e2e；差异项（助手 continuation 表、选角失败旗标）在共享实现中以回调显式化，不合并语义。
- [重构面扩大、一次 PR 过大] → tasks 按阶段排序（骨架成文→分章→Hook→删依赖→门禁），每阶段独立验证。
- [骨架契约沦为纸面文档] → 契约的每条都绑定可执行审计任务（对照表逐链路打勾），例外须在契约处登记。
- [无兼容的升级边界被遗忘] → proposal/design/任务三处显式标注；新增「旧格式 fixture 恢复失败且错误清晰」反向测试。

## Migration Plan

按 tasks 阶段顺序落地：①骨架契约成文与审计；②分章 pipeline 重写（含检查点简化）；③共享 Hook 整合（助手→归属→选角逐链路）；④删依赖与全量门禁。本次无数据迁移。回退代码后，旧版本也无法读取新阶段检查点，需要重新发起受影响的分章诊断。

## Open Questions

整章自动推进由 `assistant-guided-production` 后续交付。

## 四条链路对齐审计

| 契约 | 工程助手 | 分章 | 章节归属 | 选角 |
| --- | --- | --- | --- | --- |
| 冻结输入 | 新 run 存 `workspace_context` 和触发消息 | run 存工程修订和来源摘要，保留任务触发身份 | `analysis_input` 存任务依赖与参数 | `casting_input` 存角色、目录、要求及证据来源 |
| 阶段与执行入口 | `ai::assistant::execute` 运行对话 | `pipeline::execute` 运行四阶段，Diagnose 调用助手循环 | `execution::execute` 驱动窗口与预审 | `suggest::execute` 恢复审批并运行选角 |
| 阶段检查点 | 以持久工具事实恢复 | run 列存阶段、版本和工具边界 | `analysis_window` 存窗口或审阅结果 | 中断记录存计划、回执和尝试，领域表存最终建议 |
| 状态收尾 | 文字回答或提问中断 | 候选待审阅可随 run 成功一起落库 | 窗口与预审结束后发布候选 | 待审批挂起，已发布建议随 run 完成 |
| 恢复 | 从共享消息事实重建合法历史 | Validate 继续校验，Review 新一轮从 Prepare 开始 | 按冻结输入与有效窗口重建 | 按 `auditions::resume` 还原审批或复用已有尝试 |
| 归属与记账 | 根 run 记账 | 专业分章有 invocation，对话路由使用根 run | invocation 下记录，工具观察持久化摘要 | invocation 下记录，任务入口记冻结输入，审批工具走共享事实，最终建议由领域事务发布 |
