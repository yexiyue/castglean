# Proposal

## Why

Rig 0.47 更新了模型与工具执行接口，并提供独立的上下文压缩原语。先完成宿主升级，验证 AgentRun 检查点能否复用现有流式驱动，并明确它与制作状态的职责。

## What Changes

- 锁定 Rig 0.47.0，适配请求与工具 hook、HTTP 传输和模型参数校验。
- 通过合成测试验证 AgentRun 序列化后的续跑及已应答工具的保留，作为后续接入依据。
- 正式评测摘要纳入 Rig 声明和宿主传输适配代码。

## Capabilities

### New Capabilities

### Modified Capabilities


## Impact

Rust 宿主共享 AI 执行、模型传输和评测入口。AgentRun 序列化版本不参与现有工程会话存储。
