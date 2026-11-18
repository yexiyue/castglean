# Agent 会话区全面 assistant-ui 化（2026-11-17）

- 适用：`rebuild-agent-ui-on-assistant-ui` change；CastGlean 前端 agent 会话区（工程助手 + 分章诊断）。
- 触发：旧层（shadcn AI Elements 自渲染 + `task-index.ts` 自建任务树聚合）无法表达 Codex 式 tool/思考层级，聚合塌缩全手写。

## 决策

1. **子代理层级零聚合**：`@assistant-ui/react-ag-ui@0.1.10` 的 conversions 原生按 `SUBAGENT_STARTED.parentToolCallId` + 消息 `subagentRunId` 把子代理消息嵌套进 `ToolCallMessagePart.messages`（`readonly ThreadMessage[]`）；`task-index.ts` 因此整体删除。UI 只做渲染（`tools/subagent-messages.tsx`），不做归属。
2. **宿主协议层不动**（逐项核验过）：tool 三连=AG-UI 参数流语义（执行完成由 result 表示）；`TOOL_CALL_RESULT` content 是 `{"output","reference"}` 结构化 JSON（`protocol.rs`），前端 tool 卡直接 parse；SUBAGENT 事件带完整父归属；会话 title 创建时前端传入且幂等（`service.rs`）。**结论：授权后端可改≠需要改。**
3. **elements vendored 约定**：`src/components/assistant-ui/elements/` 是 r.assistant-ui.com registry 拷贝源码（base-nova→Base UI flavor）。裁剪了 file/image/attachment/voice/dictation/follow-up 死路径；Tailwind nursery 与 a11y 风格规则按目录豁免（biome.json），spread 按文件计数登记（`scripts/visual-prop-spreads.json`）；**用户可见文案已 i18n 化**（tool 状态行/思考折叠/composer/回到最新等）。升级 element 时需重做这三件事。
4. **分层契约**：`lib/ai/agent.ts`（协议桥）→ `hooks/use-ai-session.ts`（会话管理/发送/订阅恢复）→ `components/assistant-ui/{elements,tools,thread,input}`（生成件→业务卡→挂载层→输入区）。依赖单向，elements 不 import 业务。
5. **输入栏保留旧 SessionInput**：runtime composer 无法承接 draft 按 session 持久化、原文引用拼装发送、interrupt/model/loading 禁用语义与输入框快捷发送——迁移即行为退化。Thread 的 `Composer` 槽置 null（thread.aui 已支持），未来迁移有现成槽位。
6. **会话切换**：`useAgUiRuntime({ adapters: { threadList } })` 对接 `agentSessions`（switch/new；rename/archive 无宿主命令不做）。**adapter 必须 useMemo 稳定引用**——`threads` 数组每渲染换引用会让 threadList runtime notify↔render 死循环（Maximum update depth，页面崩到错误态）。已在 hook 内注释。
7. **快捷入口结果展示**：宿主直启的专业任务（检查分章/分析本章快捷键）不走委派 tool call，其结果引用在 `record.results`——由 `AssistantMessageWithResults`（消息级）渲染 AgentResult 与上下文 chip；委派路径的结果引用在 tool result 的 `reference` 里，由 DelegatedToolCard 渲染。两条路径都要保留。
8. **失败工具体隐藏**：官方 ToolFallback 的 Result 组件不区分 isError，主消息流经 `AgentToolUI` 的 `stripFailedToolBody` 剥离；子消息 SubagentToolCall 同规则。单测 `tests/unit/ai-components.test.mjs` 锚定。
9. **vendor 滚动语义**：ThreadPrimitive.Viewport（turnAnchor="top"）的行为是"新 run 开始即自动跟随；用户上滚后停止跟随，'回到最新'按钮回底"。与旧自研"前置历史不拉扯"不同但属主流聊天语义，e2e 按新语义断言（`e2e/assistant/session-messages.spec.mjs`，useLocalRuntime fixture）。viewport 补了 `role="log" aria-relevant="additions"`（旧实现有无障碍语义，多个 spec 依赖）。

2026-11-18，SessionInput 的发送键改为 Enter，Shift + Enter 保留原生换行。WebKit 可能先结束组合再派发确认用的 Enter，输入框同时检查组合状态和键值 229。发送与草稿仍使用原会话路径。

2026-11-18，历史会话、新建和分页入口移入参考 [Command Palette](https://www.assistant-ui.com/elements/command-palette) 的可搜索弹窗。WKWebView 中长消息曾让滚动视口越过独立输入区，消息视口现在允许收缩并在输入区上方裁切，输入区使用实色背景。

2026-11-18，借鉴 IDE 助手的可移除选区引用，将显式选中的原文显示在输入框顶部，包含来源、行号和预览。工程助手按会话保留引用草稿，发送成功后清除该次引用。宿主仍冻结当前章节 ID，供工具解析「本章」等指代。底栏与消息区使用同一实色背景，输入框通过轻微色差与阴影区分，消息区在底栏上方裁切。[VS Code Chat Context](https://code.visualstudio.com/docs/chat/copilot-chat-context) · [Cursor Keyboard Shortcuts](https://docs.cursor.com/advanced/keyboard-shortcuts) · [JetBrains AI Assistant](https://www.jetbrains.com/help/ai-assistant/chat-mode.html)

## 验证

- 2026-11-18，macOS WKWebView 的自定义滚动条在 assistant-ui 折叠动画期间仍占宽，`useScrollLock` 补的 10px 内边距让消息列在 277px 和 267px 之间切换。思考、工具组和单个工具的折叠保留自身动画，由会话视口管理滚动。加入逐帧宽度和滚动位置回归。

- tsc/Biome（lint+check）/build 绿；`test:ai` 22/22。
- 浏览器 fixture e2e：unified-workspace 全链路（分章候选采用/分析/draft 保存/切章/结构编辑）、split-recovery-route、recovery-actions（agent 部分）、session-messages 滚动语义通过。
- 未完成：桌面真窗口验收（tasks 9）；settings 相关失败（chapter-agent 后半/`workspace-chrome` 8px 与 settings main 泄漏）属 settings-as-route 等在途 change，与本 change 无关。

## 关联

- [docs/research/ag-ui-adoption.md](../../research/ag-ui-adoption.md)（UI 层已实现的标注）
- OpenSpec：`openspec/changes/rebuild-agent-ui-on-assistant-ui/`
