# Proposal: 选角审阅收进 AI 会话工具卡片

## Why

AI 会话的存在意义是简化操作链路。当前选角建议发布后，工具卡片只提供「查看结果与审阅状态」索引按钮，逐目标的候选试听与采用必须跳到角色中心完成，链路断裂；且试听生成进度渲染在线程尾部、结果卡折叠在工具卡片内部，用户批准后在会话里几乎看不到任何进展（2026-11-18 用户截图反馈）。用户已决定推翻 2026-11-18「聊天卡只做索引、审阅直达角色中心」的分层：审阅与采用就地完成，角色中心保留为完整审阅面。

## What Changes

- 选角工具卡片（`cast_voices` 的结果引用区）直接承载逐目标建议审阅：候选列表与理由、试听播放、采用绑定、采用画像，全部复用角色中心的建议对比面板与其显式命令；不再强制跳转。
- 试听生成进度从线程尾部（`ThreadTrailing`）迁入选角工具卡片上下文，锚定在 `cast_voices` 调用旁展示「已处理 / 总数 / 失败」；线程尾部的独立进度条移除，避免同屏双份。
- 建议结果区在工具卡片折叠态外可见（与候选分章方案卡同层级），不再折叠在工具调用内容内部。
- 卡片内采用后同步刷新会话结果状态；「在角色中心打开」保留为次级入口（身份操作、设计发起仍在角色中心）。
- **决策记录**：本 change 归档时，2026-11-18 角色中心重构中「聊天卡只做索引」的分层结论被本决策替代，知识库与记忆同步更新。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `character-voice-binding`: 新增「会话内选角建议审阅」需求——选角工具卡片提供与角色中心等价的逐目标候选审阅与采用（试听、绑定、画像走同一显式命令与期望修订校验），设计草稿与音色设计发起仍留在角色中心。现有「建议内容与人工采用」「角色中心页面」等需求语义不变，不受影响。

## Impact

- 前端：`src/components/assistant-ui/tools/delegated-tool-card.tsx`（结果区外提 + 卡内审阅挂载）、`agent-result.tsx`（casting 分支渲染完整审阅）、`thread/agent-workspace.tsx`（`ThreadTrailing` 进度条迁出）、新增卡片审阅容器组件（复用 `src/components/projects/casting-suggestion-panel.tsx`）。
- 数据复用：`voiceBindingSuggestion` / `voiceBindingBindings` / `voiceBindingProfiles` / `listModels` / `castingPreviewAudio` 与 `useVoiceStudio` 均为现有宿主命令与 hook，无协议或数据格式变化；`AgentPage.castingProgress` 已存在。
- 宿主：预计无改动；若卡内采用需复用结果版本刷新，仅消费既有 `version` 通道。
- 测试：浏览器会话回归 fixture 扩展卡内审阅与进度位置；窄窗口、中英文、亮暗主题验证。
- 依赖顺序：`add-casting-preview-approval` 尚未归档；本 change 的规格差量与其兼容，归档顺序必须在其之后。
