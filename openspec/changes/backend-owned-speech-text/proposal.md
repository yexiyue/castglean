## Why

章节宿主将 Kokoro 专用文本映射应用于所有后端，可能破坏其他模型的文本和标记。

## What Changes

- 将不可变原文范围直接交给选定引擎；模型特定处理归对应后端。
- 保留来源范围、失败状态和已生成产物，冻结输入兼容策略需纳入续跑判断。

## Capabilities

### New Capabilities

- `chapter-backend-text`：章节原文到后端的文本边界。

### Modified Capabilities

无。

## Impact

影响章节生成及 TaleChime 各后端适配；不修改源文本。
