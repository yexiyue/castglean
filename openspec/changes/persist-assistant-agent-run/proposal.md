# Proposal

## Why

工程助手在进程退出后需要从已接受的模型或工具步骤续跑。领域写入和 Rig 应答属于不同提交边界，恢复时必须优先读取已完成的工具回执。

## What Changes

- 为工程助手主运行持久化 AgentRun 和输出边界，并在重启时重新领取原运行。
- 工具调用用冻结的运行和轮次定位，领域写入与工具回执同事务提交。恢复时用原回执补交 Rig 应答。
- 使用新数据库版本。旧数据库继续由用户保管，开发环境以新库启动。

## Capabilities

### New Capabilities

### Modified Capabilities

- `project-assistant`：工程助手主运行的进程级恢复。
- `ai-task-sessions`：可自动续跑的主运行与其他中断运行的恢复行为。

## Impact

Rust 宿主、SQLite、队列启动恢复及验证。独立专业任务继续按其领域检查点执行。
