## Why

切章或收起再打开助手后，需要在对话里找到原来的章节生成任务，并直接试听已生成的音频。

## What Changes

- 在对话消息后用 assistant-ui Task Card 展示工程内近期生成任务，当前运行优先。
- 按宿主任务身份读取阶段、单元计数和可试听产物。卡片支持播放、暂停与返回原章节。

## Capabilities

### Modified Capabilities

- `assistant-interactions`：章节生成任务的只读恢复、试听和导航。

## Impact

新增只读章节音频查询，复用已有持久任务、音频播放和章节导航。
