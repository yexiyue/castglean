# TanStack AI 1.0 vs Vercel AI SDK 调研

调研日期：2026-11-13。来源：[TanStack AI 1.0 发布博客](https://tanstack.com/blog/tanstack-ai-1-0)、[官方对比页](https://tanstack.com/ai/latest/docs/framework/react/comparison/vercel-ai-sdk)、[headless chat UI recipe](https://tanstack.com/ai/latest/docs/framework/react/ui/recipes/basic-chat)。结论基于当日文档，TanStack AI 1.0 发布于 2026-10-23（约三周前），演化快，重启评估前先重读官方对比页。

## TanStack AI 是什么

TanStack 出品的框架/供应商中立 AI 工具包，口号 "no lock-in, ever"：供应商、框架、沙箱、线协议全部自选。1.0 为首个稳定版。

- **核心 API**：`chat()` 一个函数覆盖 `streamText` / `generateText` / `generateObject`（`outputSchema`）三件事；`systemPrompts` 数组；`middleware` 代替 `wrapLanguageModel`/`prepareStep`。
- **线协议**：原生 AG-UI（双向、标准协议，带 interrupt/approval 语义），**不读也不写 Vercel UI Message Stream**。官方提供 `@ag-ui/vercel-ai-sdk` 桥的方向是反向的（Vercel 生态接 AG-UI agent）。
- **包结构**：`@tanstack/ai`（核心）+ 每框架一个 adapter（React/Vue/Solid/Svelte/Preact/Angular/Octane/Remix/RN 共 9 个）+ 每供应商一个 adapter（23 个，含 `openaiCompatible` 逃生舱）。按 activity 拆包，只打包用到的。
- **类型安全**：按 model 收窄（每个模型的 options/inputs 类型独立），比 Vercel 按 provider 收窄更细。
- **进阶**：持久化 + 可恢复流（断线自动重连）、memory/compaction 中间件、MCP 双向（既能当 client 也能 `createMCPServer` 把工具暴露给 Claude Desktop/Cursor）、沙箱/编码 agent 集成（Claude Code/Codex/ACP）、BYOK + OAuth 登录、媒体生成（图/视频/语音）。
- **Harness**（`@tanstack/ai-harness`，0.x 实验）：长寿命持久 agent 会话，运行中可 `mode: 'steer'` 插话、崩溃/部署后恢复、类型化子 agent。这是它对比 Vercel 最大的独有牌。
- **测试**：端到端测试跑确定性 model fixture 不打真 API；`fakeText()` 无网络测试。

## 与本项目 ai-sdk 用法的对比

关键前提：**我们只用了 ai-sdk 的客户端那一半**。`@ai-sdk/react` ^4 + `ai` ^7，没有任何 `@ai-sdk/*` provider 包 —— LLM 调用、会话、持久化、工具执行全部在 Rust 宿主（`src-tauri/src/ai/`、`llm/`）。前端拿到的是宿主 `StreamEvent`，由 `AiTransport implements ChatTransport<UIMessage>`（`src/lib/ai/transport.ts`）+ `SessionProjection`（`src/lib/ai/stream.ts`）翻译成 Vercel UI Message Stream 的 chunk（`text-start/delta/end`、`tool-input-available`、`data-result`、`finish`）喂给 `useChat`。UI 组件是从 Vercel AI Elements 摘改的三个（`src/components/ai-elements/message.tsx`）。

| 维度 | Vercel AI SDK（现状） | TanStack AI 1.0 | 对我们的意义 |
|---|---|---|---|
| 线协议 | UI Message Stream（专有） | AG-UI（标准、双向） | 迁移 = 重写 chunk 翻译层；AG-UI 的 interrupt/approval 我们由宿主 StreamEvent 自己承载 |
| 供应商层 | 38 个 provider 包（我们未用） | 23 个 + openaiCompatible（我们不适用——LLM 在 Rust） | 无关 |
| useChat | `@ai-sdk/react` | `@tanstack/ai-react`，同形态 | 平手，迁移纯改 import + 协议层 |
| 自定义 transport | `ChatTransport` 接口，我们已实现 | connection 抽象 | 我们的价值全在这层，两边都要自己写 |
| 持久化/恢复 | 自己写（我们已在 Rust 宿主自建） | 内建 `withPersistence` + 可恢复流 | 宿主自建已覆盖，且权威数据在 Rust 侧，JS 内建反而多余 |
| Harness/agent | 无 | 0.x 实验性强项（steer/持久会话/子 agent） | 不需要；宿主是权威 |
| 测试 | 我们用 node --test 覆盖翻译层 | fixture/fakeText | 我们已用确定性测试，无缺口 |
| 协议 | Apache 2.0 | MIT | 无差别 |

官方对比页自己的建议：**已经在说 UI Message Stream 协议的应用留在 Vercel AI SDK** —— 精确命中我们的情况（我们手工实现了该协议的发射端）。

## 开箱即用的 UI

**TanStack AI 1.0 没有带样式的预制 UI 组件。** 0.x 曾有 `@tanstack/ai-react-ui` / `ai-solid-ui` / `ai-vue-ui`，1.0 已废弃移除，替换物是 `@tanstack/ai-react/ui` 的 `createChatHook` —— 类型化 headless 聊天 UI 工厂：

- 你提供结构组件（`layout` / `message` / `input`）和 per-part 渲染器（`partsComponents`: `text` / `tool` / `fallback`），它返回 `useAppChat` + `useChatContext` + 组装好的 `chat.AppChat`，行为（流式、状态、context）全包，**markup 和样式一行不给**，连 interrupt 也只是 layout 上的一个插槽。
- 官方 basic-chat 教程同样是手写 JSX。

对比之下 Vercel 生态反而有带样式的 AI Elements（我们已摘改），另有 ai-elements.dev 等周边。两边对"开箱 UI"的答案其实一致：headless + 自带设计系统才是主路线，这与我们 shadcn/Base UI + 主题 token + Uncodixfy 约束正交——预制 UI 套件本来就不是我们的选项。

## 结论

**不迁移，继续 ai-sdk。** 判断依据：

1. 迁移成本精确落在我们自建的最有价值的一层（StreamEvent → 协议 chunk 翻译 + AI Elements 类型依赖），收益却全在我们不用的区域（供应商中立、JS 侧持久化、harness）。
2. TanStack 官方对比页的留守条件命中我们。
3. UI 上 TanStack 给的比 Vercel 生态更少（headless 工厂 vs 摘改组件）。

重启评估的触发条件（满足其一再回头看）：

- 前端需要直连 LLM provider（绕过 Rust 宿主）的需求出现；
- AG-UI 成为桌面应用间互操作的事实标准且我们需要对外暴露 agent 接口；
- `@tanstack/ai-harness` 转稳定，且宿主侧想要 steer/中断恢复这类会话语义而 Rust 侧实现代价高；
- ai-sdk 出现维护停滞或 breaking 断层。
