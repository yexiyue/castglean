## Why
已授权与现有 Rig+Tokio 路线并行实施 Rig ECS 0.46.0 隔离原型，用同一评测契约验证真实 agent 内核、并发、取消和恢复语义，不改变正式应用默认行为。

## What Changes
- 独立实验 package，仅显式 feature `rig-ecs-prototype` 构建；不引入正式宿主依赖，不复活 legacy-main。
- 统一冻结角色快照后启动三个分析 agent，聚合并宿主校验后调用无工具的只读 AI 预审。
- 模型 effect trace、取消传播、期限、完成子结果检查点和在途请求不自动重发。
- 接入父任务维护的公共评测契约和 fixtures，不自定义质量评分 gold。

## Capabilities
### New Capabilities
- `rig-ecs-evaluation`: 隔离 ECS 分析运行与比较证据。

## Impact
写入 experiments/rig-ecs-prototype、自身规格和验证文档；生产仍是单 Tauri crate。不上线、不合并、不推送。