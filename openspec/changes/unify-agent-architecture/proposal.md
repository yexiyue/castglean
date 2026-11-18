# Proposal

## Why

四条 agent 链路已共享大部分骨架（rig-agent 循环、`ToolDispatch` 共享工具事实、`Output` 用量、`ai_invocation` 归属、宿主运行状态收尾），但三处混乱仍未收敛：①编排形态各异——分章用 graph-flow 外来范式（单维护者依赖，全应用仅此一处使用），归属是窗口流水线，选角/助手是单循环；②检查点三套约定——`ai_run.checkpoint` graph session blob、`analysis_window` 领域行、选角冻结输入+审批记录；③`AgentHook` 在助手/归属/选角三处重复实现，事实记录与用量路径有漂移空间。用户已拍板：不考虑旧数据兼容，借移除 graph-flow 的机会把全部 agent 统一为同一架构。

## What Changes

- **删除 graph-flow**：`novel_import/splitting/graph.rs` 的四节点图重写为 `pipeline.rs` 宿主状态机（`Phase` 枚举 + 唯一转移函数），`review` 完成后交由宿主按待处理人工中断收尾；从 `Cargo.toml` 删除依赖。
- **检查点简化（无兼容负担）**：分章检查点从 `{version, session{...}, last_tool}` 简化为 `{version, phase, last_tool}`；不做旧格式解码与迁移。
- **共享 Hook 整合**：把助手/归属/选角三处 `AgentHook` 的公共部分（dispatch 事实记录、用量落库、取消处理）提取为共享实现，域特有边界逻辑以回调注入；三处重复实现删除。
- **统一骨架成文**：在 `docs/engineering.md` 固化 agent 骨架契约（冻结输入 → 阶段序列〔确定性代码或 agent 循环〕→ 领域行检查点 → 宿主根据中断收尾 → 按恢复来源重建），并按契约对四条链路做对齐审计与命名/布局修齐（入口 `freeze`/`execute` 命名、模块布局约定）。
- 分章工具面、scope 白名单、候选发布事务、预算记账、共享消息事实全部不变；归属窗口流水线与选角审批恢复机制保持既有设计（它们已是目标骨架的实例）。

**BREAKING**：①升级时**已开始且中断**的分章 run 不再可恢复（旧 checkpoint 格式不解码，用户重发任务即可；排队未开始的已接受意图不受影响，规格「可恢复派发」仍成立）；②归属分析与选角的升级时在途 run 恢复依赖既有格式，本次不动其格式，无影响。用户工程正文、人工修正、候选、绑定、历史结果一概不动。

## Capabilities

**无规格变化（skip_specs: true）。** 全部为内部实现统一：恢复、派发、审阅等规格级行为在升级后的系统上不变；旧在途运行的不可恢复是用户明确接受的升级边界，不属于规格描述的前向行为。已核实 `openspec/specs/` 无引用 graph-flow/checkpoint 形状的条款。

- New Capabilities：无。
- Modified Capabilities：无。

## Impact

- 宿主代码：`src-tauri/src/novel_import/splitting/graph.rs`（重写为 `pipeline.rs`）与 `graph/` 子模块；`ai/assistant.rs`、`chapter_analysis/agent_runtime.rs`、`voice_binding/suggest.rs` 三处 Hook 整合为共享实现（预计落 `ai/` 下共享模块）；`ai/tasks.rs` 调用点。
- 依赖：`Cargo.toml` 删除 `graph-flow`；无新增依赖。
- 测试：graph 测试平移；三链路 Hook 迁移各自的库测试与 e2e 恢复套件为门禁；新增旧格式 fixture「恢复失败且报错清晰」的反向测试。
- 文档：`docs/engineering.md` 新增 agent 骨架契约节；`docs/knowledge/decisions/normalize-splitting-agent.md` 收尾更新。
- 不涉及：前端、数据库 schema 迁移（检查点同列复用）、协议绑定、候选/绑定/审批格式。
