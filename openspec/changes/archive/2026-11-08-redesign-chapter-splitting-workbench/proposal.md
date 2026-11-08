# Proposal

## Why

本地工程和共享 AI 运行时已完成，但分章界面仍将目录、原文与诊断分成互斥页面，候选堆在输入框之后，工具以 JSON 展示。用户难以核对建议对应的正文并做出制作决定，需要重新组织完整的分章审阅体验。

## What Changes

- 将已导入工程的检查入口重写为目录、原文/方案审阅、右侧助手组成的工作台，保留导入与人工修章能力。
- 提供可定位的结构差异、仅看变化、整套方案采用/放弃和过期反馈；原文始终只读。
- 重写会话历史、执行状态、工具摘要、输入草稿及原文上下文交互；按用户追加要求使用 Tiptap 输入和官方 AI Elements 流式 Markdown 消息。
- 宽窗口支持调整面板宽度，小窗口可收起目录和助手，各区域独立滚动。
- 保留宿主权威历史、后台生命周期与人工确认；不增加逐条采用、章节分析或新的后端协议。

## Capabilities

### New Capabilities

- `chapter-splitting-workbench`：目录、原文、助手与候选方案联动的分章检查和审阅体验。

### Modified Capabilities

无。沿用已完成 `refactor-local-ai-task-runtime` 的会话与事务契约；本变更补齐其明确排除的界面重设计。

## Impact

影响 `/new?draft=…`、projects 分章组件和共享 AI 展示组件；继续使用现有 Tauri IPC、React、Lingui 和主题 token，新增 Tiptap、Streamdown 及 CJK/代码插件以完成助手输入与消息体验。更新交互说明、README、知识库与验收记录。用户工程数据和音色功能不变。
