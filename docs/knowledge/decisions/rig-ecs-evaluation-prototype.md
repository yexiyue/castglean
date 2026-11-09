# Rig ECS 评测原型的隔离与恢复边界

日期：2026-11-08。版本：Rig ECS/Core 0.46.0、Bevy 0.20.0；本机 macOS、Rust 1.99.0。状态：原型已实现，受控离线内核与公共评测验证完成，未接入正式 Tauri 应用。首轮离线证据保留；后续显式 native-live 桥及真实公开 suite 结果见[在线验证](../../desktop-studio/rig-ecs-native-live-validation.md)。取代[调研记录](../plans/agent-runtime-and-ai-pre-review.md)中“ECS 尚未实施”的原型状态，不取代主线产品运行时决定。

## 选择与理由

生产仍是 `src-tauri` 单 crate；独立实验 package 避免编译 TaleChime/Metal/Tauri 整个产品图，也避免 Bevy 被正式应用默认依赖。用户允许独立实验包；它不提供独立产品服务，不复活 legacy-main。只使用 `rig_ecs::AgentPlugin` 和 core 模型适配路径，未装载 coding harness 或 `rig_basics::subagents::SubagentsPlugin`，不宣称已验其 task/message/wait 插件。

宿主确定性地冻结来源和规范角色，再创建三个 `SpawnedBy` 子 agent，模型请求经 `Deliver → TurnCall → ModelAdapter → TurnOutcome`。`RuntimeHandler` 用调用方已拥有的 Tokio Handle 驱动请求及整个流，drop 取消 join task 并确认本地 active=0。独立 driver 才拥有一个 runtime；这不证明 Tauri 内原生线程/响应性已验。

配置身份只含模型参数、low 和 known-only；路由、代码、提示词、协议、受控脚本和执行控制分别记录或绑定恢复键。角色仅来自规范 ID，未知和歧义保留；同名不合并，不在公共 suite 做角色发现。`evaluationTask:analysis` 拒绝 reviewInput，`review` 单独进程只做一项只读预审；候选边界生成 sN targets，不读取 gold/reviewGold。

## 已验证的非直观约束

- 0.46 内核 `RETRY_POLICY` 是固定四次策略，不能插入一个假想资源来关闭。原型在 `ReviewSystems::Edit` 把 verdict 设 Final，并在 Gate 限每 agent 一次模型 dispatch，防止模型试图调用未授权工具后又产生反馈请求。
- `end_turns` 先移除 `TurnOf` 再插入 `Settled`；完成观察器必须读取保留的 `ForAgent`，否则请求已经完成却无法被宿主收集，继而误超时。源码与回归见[内核适配](../../../experiments/rig-ecs-prototype/src/kernel.rs)。
- `StopTurn` 遍历 SpawnedBy 后代，即使取消根自己没有活动 turn。完成事实不能仅从 partial stream 推断；父取消后必须见到各子 `TurnOutcome::Stopped` 并等待本地任务退出。
- 发送前 fsync `in_flight`；新进程仅重用身份匹配且重新校验过的 completed，旧在途改 unknown，不重新 Deliver。OS 文件锁防双写；这不是生产 SQLite owner/generation 事务。
- `time` 的 RFC3339 默认会省略尾零，本机 Python 对部分秒小数长度不兼容；适配器固定六位微秒。契约时间和请求 metadata 必须通过公共 evaluator 检查，不能只凭 Rust DTO 自测。

## 证据与边界

[验证记录](../../desktop-studio/rig-ecs-prototype-validation.md)列出 Rust 回归、共享测试、十例相同 gold 的 mock 比较以及真正 SIGKILL 后零重发。共享“全旁白、零问题”基线只证明适配器/分母/trace 兼容，不能作为 AI 准确率证据；脚本响应不来自 gold。未知 token 为 null，不宣称免费。

真实在线质量/耗时/费用、Tauri 嵌入、生产 SQLite 恢复、其他平台，以及新角色发现均未验。服务端是否继续处理被取消请求不由本地 active=0 证明。原型检查点无人工结果或产品发布权限；建议仍需宿主验证和人审。

## 原生 live 接续

2026-11-08：可选 Serve 模型边界已实现，实际 CompletionRequest 经原生 call helper 获取凭据并执行；默认离线不变。非密钥配置和 helper 身份先冻结，配置 hash 使用主线统一 preimage，stage/prompt/protocol/mode/并发不混入 generation 配置。真实用户 ModelSpec 不继承 DeepSeek 能力；容量未知保持 null，capabilitiesVerified=false。

helper 必须被 supervisor 拥有，调用方 future drop 只发送取消，监督任务继续到 kill＋wait 后结束；宿主返回前确认监督计数为零。取消已开始的请求记 unknown，保留取消/超时 trace，无法保证提供商停止计算。独立进程和三路请求在多个 runtime 间不能靠 detached join handle 清理；测试先等实际 helper PID 标记再取消，避免只测试了“请求尚未启动”。

实际公开 suite 中，即使 Schema enum 把 start/end 限在 owned UTF-8 边界，模型仍可能漏掉覆盖区间或顺序错乱。宿主完整覆盖校验继续拒绝这些结果，不从 partial、邻接段或金标补齐。该事实说明协议设计和模型服从性仍是验收条件，不是运行时内核成功即可替代；详见在线验证的失败分母。
