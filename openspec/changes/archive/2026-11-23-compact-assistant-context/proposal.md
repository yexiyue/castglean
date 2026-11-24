# Proposal

## Why

工程助手需要在大段正文和多轮工具结果累积后继续对话。用户也需要主动整理发往模型的上下文，同时保留完整记录。

## What Changes

- 接入 Rig 0.47 压缩准备、摘要生成与应用。
- 用量面板提供手动压缩。已知模型窗口时，主助手接近窗口自动尝试压缩。
- 摘要与原始聊天分别持久化，保护工具调用配对及重启续跑。

## Capabilities

### New Capabilities

### Modified Capabilities

- `ai-conversation-controls`：手动与自动压缩及持久恢复。

## Impact

影响工程助手的模型请求、SQLite 和现有用量面板。
