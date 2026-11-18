## Why
真实原生制作中出现 Worker 心跳停止、已接受任务持续排队。Apalis 1.0 的持久化错误使消费器退出，宿主忽略退出结果，只有重启能恢复。

## What Changes
- 宿主监督消费器退出和 panic，以有上限的退避间隔重建消费器。
- 每次消费器使用独立身份，保留宿主所有者、run 身份和领取栅栏，不重发已开始的模型请求。
- 记录消费器故障与恢复事件，补充真实 SQLite 心跳故障注入。

## Capabilities
### Modified Capabilities
- `background-ai-execution`: 消费器自动恢复与业务重试边界。

## Impact
修改 jobs runtime 和测试，无数据库或 IPC 格式变化；不实施下一阶段界面简化。
