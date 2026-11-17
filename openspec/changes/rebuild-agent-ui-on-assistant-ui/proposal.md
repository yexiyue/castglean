# Proposal

## Why

当前 agent 会话区（`src/components/ai-elements/`，约 1600 行）用 shadcn AI Elements 通用件自渲染消息循环：`task-index.ts` 自建 TaskNode 树做子任务聚合与折叠、`session-messages.tsx` 手工遍历 parts 渲染 tool/思考行。委派专业任务（检查分章/章节分析/选角建议）的子 Agent 消息没有原生层级表达，聚合塌缩全靠手写维护。而已核验：`@assistant-ui/react-ag-ui` 的转换层**原生把子代理消息按 `SUBAGENT_STARTED.parentToolCallId` 嵌套进 tool call part 的 `messages` 字段**，与宿主协议层输出完全对齐——Codex 式 tool/思考标准展示可以零聚合获得，自建聚合层失去存在理由。

## What Changes

- **BREAKING** 删除自建聚合与自渲染层，不考虑兼容：
  - 删 `src/lib/ai/task-index.ts`（TaskNode 树聚合，被 react-ag-ui 原生嵌套替代）。
  - 删 `src/components/ai-elements/session-messages.tsx`、`agent-workspace.tsx`（自渲染循环），由 `src/components/assistant-ui/thread/` 薄挂载层替代。
  - 删 `src/components/ui/message.tsx`、`ui/bubble.tsx`、`ui/message-scroller.tsx`、`src/components/markdown.tsx`（shadcn AI Elements 消息件与共享 markdown 封装，被 assistant-ui elements 替代；`ui/trace.tsx` 保留——章节分析进度仍在用）。
  - 删会话历史对话框（imported-workspace 内），替换为面板内嵌 ThreadList。
- 新增 `src/components/assistant-ui/elements/`：CLI 生成的 assistant-ui elements（thread、thread-list 及其依赖件 tool-fallback/reasoning/markdown-text 等，Base UI flavor，适配项目 token）。
- 新增 `src/components/assistant-ui/tools/`：三个委派工具卡（折叠行 + 展开渲染 `part.messages` 子代理消息流）+ 子消息渲染器；工具结果直接 `JSON.parse` 取 `{output, reference}` 挂 AgentResult（删 record.tools 平铺映射）。
- `use-ai-session.ts` 职责收缩为会话管理/发送/订阅恢复，删除向 UI 透传消息的双轨合并。
- 输入栏迁 composer element（ModelPicker/ReasoningPicker/ContextUsage 保留为 toolbar 插槽）；`chapter-diagnostics.tsx` 复用同一 Thread 消费路径。
- 依赖方向单向：页面 → thread/tools → elements → `@assistant-ui/react`；elements 不 import 业务代码。
- 宿主协议层**不动**（已逐项核验：tool 三连为参数流语义、result 为结构化 JSON 含 reference、SUBAGENT 归属完整、会话 title 创建时定且幂等）。

## Capabilities

本次为 UI 实现层重构，不改变 spec 级行为（`.openspec.yaml` 已设 `skip_specs: true`）。会话历史展示、异常表达、审阅直达等行为契约由 `project-assistant`、`ai-task-sessions`、`ai-conversation-controls` 既有规格继续锚定；单元测试 `tests/unit/ai-components.test.mjs` 随实现更新断言，不另立规格。

## Impact

- 代码：`src/components/ai-elements/`（清空删除）、`src/components/assistant-ui/`（新增）、`src/hooks/use-ai-session.ts`（精简）、消费方 `imported-workspace.tsx`、`chapter-diagnostics.tsx`、`src/components/ui/`（-3）、`src/lib/ai/task-index.ts`（删）。
- 依赖：CLI 生成件带入 `tw-shimmer` 等；`@assistant-ui/react`、`@assistant-ui/react-ag-ui`、`streamdown` 已在依赖中。
- 测试：`tests/unit/ai-components.test.mjs`、assistant/chapters 相关 e2e（含在途 4 个 AG-UI 重写存量失败）适配。
- 文档：`README.md` 状态、`docs/research/ag-ui-adoption.md` 标注 UI 层已实现、知识库 decisions 记录架构决策与后端审视结论。
