## Why

助手消息、过程、结果和输入使用不同的缩进及操作权重。展开长审批时，粘性区域会挤占对话阅读空间。

## What Changes

- 按《Refactoring UI》的主次、留白及表面规则重新整理助手。
- 复用现有 assistant-ui 会话、Thinking Indicator、Todo List 和共享输入、折叠、按钮组件。
- 待确认操作随会话滚动，输入区可直接返回并打开对应内容。

## Capabilities

### Modified Capabilities

- `agent-workspace`：明确任务、结果及当前可用操作的视觉层级。

## Impact

改动集中在助手会话和章节工作台的呈现。
