# Design

## 架构结论（已核验）

- **子代理层级零聚合**：`@assistant-ui/react-ag-ui@0.1.10` 的 `fromAgUiSnapshotMessages` 按 `SUBAGENT_STARTED.parentToolCallId` + 消息 `subagentRunId` 把子代理消息嵌套进 tool call part 的 `messages`；`run-aggregator` 处理运行期归属与生命周期。宿主 `protocol.rs` 的事件输出（SubagentStarted 带父归属、全事件带 subagentRunId、restore 合成 SUBAGENT 事件）与之逐项对齐，**协议层与 DB 不动**。
- **工具结果引用**：`TOOL_CALL_RESULT` content 为 `{"output", "reference": ResultReference}` 结构化 JSON（protocol.rs:198）。前端 tool 卡直接 parse，删除 `record.tools` 平铺映射。
- **会话标题**：title 由前端在 `agentSessionCreate` 传入、create 幂等（service.rs:20）；ThreadList 只提供 switch/new，裁剪 rename/archive。
- **Base UI flavor**：`components.json` style `base-nova` → registry `https://r.assistant-ui.com/styles/{style}/{name}.json` 命中 Base UI 变体，与项目 animate-ui/Base UI 现状一致。

## 分层契约

```
src/lib/ai/agent.ts            协议桥（DesktopAgent extends AbstractAgent，不动）
src/hooks/use-ai-session.ts    会话管理/发送/订阅恢复（收缩职责）
src/components/assistant-ui/
  elements/                    CLI 生成件（thread/thread-list 及依赖件），仅主题 token 与布局适配
  tools/                       委派工具卡、子消息渲染器、结果引用卡、interrupt 表单（业务定制）
  thread/                      AgentWorkspace 薄挂载层、ThreadList adapter、composer 组装
```

依赖单向：页面（imported-workspace / chapter-diagnostics）→ thread/tools → elements → `@assistant-ui/react`。elements 不 import 业务代码。

## 关键实现点

- **委派工具卡**（check_splitting / analyze_chapter / cast_voices）：官方 ToolFallback 不渲染嵌套子消息，故三卡为自定义 `ToolCallMessagePartComponent`：折叠行（标题/状态图标/耗时，requires-action 自动展开）+ 展开渲染 `part.messages`（递归复用 markdown-text / reasoning / tool-fallback）。注册优先 toolkit render API（`makeAssistantToolUI` 已 deprecated，兜底可用）。
- **interrupt 表单**：保留 `useAgUiInterrupts` / `useAgUiSubmitInterruptResponses`（react-ag-ui 原生 hooks），AgentQuestionGroup 草稿持久化机制不变，挂载点迁入消息流。
- **ThreadList adapter**：`useAgUiRuntime({ threadList })` 或 ExternalStore threadList 适配，对接 `agentSessions` 分页（SessionCursor）+ `selectSession`/`newSession`；面板标题栏的会话图标打开搜索弹窗，会话列表与新建操作都在弹窗内。
- **输入栏**：SessionInput 内 Enter 发送，Shift + Enter 换行。确认输入法候选和长按 Enter 时不触发发送。模型、思考强度、上下文用量与发送操作同排，完整模型名可悬停查看。 显式引用在输入框顶部显示来源和行号，可移除。工程助手按会话保留引用草稿，发送成功后清除。普通提问继续冻结章节范围供工具解析指代。
- **右侧面板**：分析进度与审阅入口随消息中的任务和结果卡显示，标题下的「分析观测与原文疑点」区移除。助手与检查器共用宽度，拖动左边缘或聚焦分隔线使用方向键调整。宽度保存在当前工程的界面会话中，窗口变窄时限制最大宽度，为正文保留空间。
- **双宿主**：chapter-diagnostics（chapter_splitting taskKind）与工程助手走同一 Thread 消费路径，仅 props（taskKind/scope/入口文案）不同。

## 风险与对策

- 生成件默认全屏布局（h-dvh 等）：拷入后即项目源码，随右侧面板尺寸调整。
- `part.messages` 递归渲染深度：委派工具只有一层子代理（invocation 无嵌套父），渲染器支持一层嵌套即可，不做通用深递归。
- e2e 存量失败（4 个 AG-UI 重写在途）：本 change 一并收编适配。
