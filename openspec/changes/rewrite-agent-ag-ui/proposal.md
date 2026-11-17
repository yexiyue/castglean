# Proposal

## Why

当前桌面助手将 Rust 自定义会话更新转换为 AI SDK 消息流，专业子 Agent 的身份、进度和人工挂起需要额外投影。用户已于 2026-11-17 确认将 CastGlean 桌面工程助手及专业任务前后端一起重写，采用 AG-UI，并优先实测 typify 生成 Rust 协议类型。

## What Changes

- **BREAKING**：替换旧 agent IPC、`StreamEvent`、AI SDK `ChatTransport`/消息投影与助手状态接线，不保留旧 agent 的双栈、转换兼容层或旧执行续跑入口。
- Rust 宿主以 AG-UI 表达文本、工具、运行、专业子 Agent 和中断/继续；仍拥有会话、执行准入、持久化、取消、业务校验与人工决定。
- 前端采用 `@assistant-ui/react-ag-ui` 与 Tauri `AbstractAgent`，重写消息、工具、子 Agent 及人工决定交互；不增加桌面 HTTP 服务。
- 以固定版本的官方 JSON Schema 为协议权威；已先验证 typify，再按用户补充要求对照 `ag-ui` 0.5.0-alpha.3。设计采用该 crate 的现成协议类型，按用户补充决定不修正库命名差异、不增加通用 schema 拦截，保证后端实际输出符合标准，不自建整套类型；类型实验不代表完整协议一致性验收。
- 新 agent 数据采用独立版本边界。旧 agent 记录原样保留且不续跑，不转换旧协议；工程正文、目录、角色、人工修正、声音资产及领域候选继续保留。
- 保留固定任务目标、宿主权威历史、原子结果发布、幂等受理、只读重连和明确重试等产品保证；旧实现可删除，保证不可因换协议丢失。

## Capabilities

### New Capabilities

- `agent-ui-protocol`：AG-UI 协议边界、类型来源、Tauri 传输、子 Agent 归因、中断继续及协议验证。

### Modified Capabilities

- `ai-task-sessions`：将权威消息与恢复交付改为 AG-UI，并规定新旧 agent 数据的隔离与旧执行拒绝。
- `project-assistant`：专业任务显示为有稳定归因的子 Agent，挂起、结果待采用和任务失败分别表达。

## Impact

- 后端：`src-tauri/src/ai/`、`jobs{,/runtime}.rs`、`llm/` 的接线，分章、归属分析/只读预审、选角任务的运行 hook、检查点及发布边界；增加私有协议门面复用 `ag-ui` 类型，重生成 IPC bindings。
- 前端：`src/lib/ai/`、`src/hooks/use-ai-session.ts`、助手及工具结果组件、专业任务入口、fixtures 和浏览器测试；移除不再被应用使用的 AI SDK 依赖与旧消息组件。
- 数据与验收：应用数据库/agent 记录版本、正式评测实现摘要、协议/恢复测试及真实桌面验收；不发布或废弃外部 `rig-ai-sdk` 包。
- 文档：更新 AG-UI 调研及知识库索引；切换真正实施后再更新 README、工程约定、桌面路线图与数据格式中的已实现状态。
- 关联在途方案：`migrate-ai-elements-shadcn` 的助手消息基座、`assistant-guided-production` 的助手编排需在实施时协调，既有领域制作主链继续适用。
