## Why

选角可以跨审批、试听与建议保存，用户需要在原选角消息里看到进度并继续处理待确认项。

## What Changes

- 使用 assistant-ui Todo List 在选角调用旁显示默认收起的步骤。
- 根据宿主 AG-UI 归属、中断、试听回执和发布结果更新同一份列表。展开后复用试听审批表单。

## Capabilities

### Modified Capabilities

- `agent-workspace`：显示选角步骤与待确认操作。

## Impact

复用现有选角执行器、权限、回执及 SQLite 格式。
