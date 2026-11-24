# Proposal

## Why

AI SDK Elements（elements.ai-sdk.dev，`ai-elements/message.tsx` 的血统来源）官方宣布 2026-11 月底弃用，继任者是 shadcn/ui 的 AI Elements 形态：`ui/` 通用组件（Message、Bubble、Message Scroller、Trace、Code Block…）+ `@shadcn/react` headless 原语 + 拷贝进项目的组合模式。本项目 `src/components/ai-elements/` 里输入栏、模型/思考选择器已按 shadcn 方式组合，但消息层仍是一份自适配的弃用血统文件与约 80 行自研滚动逻辑，继续维护没有上游；而 shadcn 的 Message Scroller 官方覆盖了我们自研的全部语义（跟随流式、前置历史不跳动、回到最新按钮）。

## What Changes

- **BREAKING** 删除 `src/components/ai-elements/message.tsx`（Message/MessageContent/MessageResponse 三件套），不考虑兼容：
  - `MessageResponse`（Streamdown + CJK/code 插件 + Typeset prose 映射）迁移为 `src/components/markdown.tsx`，作为全应用共享的 markdown 渲染器。
  - 消息结构改用新增的 `ui/message`（Message/MessageContent/MessageFooter）与 `ui/bubble`（用户消息气泡）。
- 新增 `src/components/ui/message.tsx`、`src/components/ui/bubble.tsx`、`src/components/ui/message-scroller.tsx`（基于 `@shadcn/react@0.3.1`，Base UI 变体，适配项目 token）。
- `session-messages.tsx` 重写消息线程容器：Message Scroller 替代自研滚动（`autoScroll` 跟随、`preserveScrollOnPrepend` 分页、"更早的消息"行、"回到最新"按钮）；行为契约（markdown 转义、失败工具体隐藏、分页加载、中断提示）不变。
- `context-usage.tsx` 展示层换用 `ui/progress`。
- `session-input.tsx`、`model-picker.tsx`、`reasoning-picker.tsx`、`start-recovery.tsx` 保持不动（已对齐 shadcn 形态）。
- 新增依赖 `@shadcn/react`；无导出兼容层，调用方一次性切换。

## Capabilities

本次为组件层重构，不改变任何 spec 级行为（`.openspec.yaml` 已设 `skip_specs: true`）。消息线程的行为契约（安全转义、工具体隐藏、分页、跟随）由既有测试 `tests/unit/ai-components.test.mjs` 继续锚定，不另立规格。

## Impact

- 代码：`src/components/ai-elements/`（删 1 增 0 改 1）、`src/components/ui/`（+3）、`src/components/markdown.tsx`（+1）、消费方 `imported-workspace.tsx`、`chapter-diagnostics.tsx`。
- 依赖：+`@shadcn/react`；`@ai-sdk/react`（useChat）与 `streamdown` 不变。
- 测试：`ai-components.test.mjs`、`context-usage.test.mjs` 更新渲染断言；`visual-boundaries.test.mjs` 按需核对。
- 文档：`README.md` 状态、`docs/desktop-studio/` 相关条目同步。
