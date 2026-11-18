# Proposal

## Why

恢复机制盘点（2026-11-18，对照 rig 官方 Durable Runs 与本仓事实重建方案）确认：轮循环重入、跨人工闸门恢复、UI 投影同源均已由共享基底覆盖，归属分析里两处机制的复杂度大于收益——①`implementation_hash` 用 22 个源文件 `include_str!` 拼接哈希做代码身份，且依赖手工维护文件清单（漏登记反而引入陈旧盲区）；②`traces` 操作日志持久化支撑窗内断点续作，换取的只是「中断时省一个窗口的重烧」。用户拍板砍掉这两处，接受「未完成窗口从头重做」的成本。

## What Changes

- **删除 `implementation_hash`**：`execution_agent.rs` 的 22 文件拼接哈希机制删除；窗口代码身份改由 `WINDOW_VERSION` 手动 bump 纪律承担（任何影响分析阶段行为的代码/提示词改动必须 bump，条款登记进 agent 骨架契约）。窗口行身份守卫保留：`plan`（含 `anchor_hash` 源文本身份）+ `context_hash`/`configuration_hash` **升级到记录层**——这两个哈希保护「跨 run 采纳旧窗口」（`resume_input_id`）不被不同别名/配置污染，不属于可砍项。
- **删除 `traces` 持久化与窗内断点续作**：窗口行收敛为两态——`planned`（仅有计划身份）与 `completed`（一次性落窗口最终产物）；分析/审阅两阶段的窗内草稿不再持久化；恢复时已 `completed` 窗口跳过、未完成窗口**从头重做**（重烧成本 ≈ 单一窗口，约 1/N 章）。`traces` 的 live-loop 操作幂等守卫（`operation_id` 指纹去重）改为纯内存实现（agent_core 草稿内），跨进程重放能力随「窗内断点续作」一并取消。
- `WINDOW_VERSION` 6→7；不解码旧格式（延续本仓「不考虑旧在途 run 兼容」的既定立场）。
- 共享基底（runs/history/dispatch/interrupts）、冻结输入、跨 run 采纳守卫、发布整章事务、进度投影全部不变。

**BREAKING**：升级时在途归属分析 run 的旧格式窗口行不解码，恢复失败（用户重发任务，整章重做）；排队未开始的已接受意图不受影响。分析产物格式（候选/片段/审阅）与用户数据不动。

## Capabilities

**无规格变化（skip_specs: true）。** `chapter-attribution-analysis` 规格要求的行为全部保持：「用户明确继续可复用**已校验窗口**」——completed 窗口复用保留；「未完成请求重新执行的**成本与范围可见**」——重做成本经既有窗口进度投影可见；中断标记、重试可追溯、整章完整校验后发布——均不变。规格未承诺窗内逐操作续作（内部粒度属实现）。

- New Capabilities：无。
- Modified Capabilities：无。

## Impact

- 宿主代码：`chapter_analysis/checkpoint.rs`（WindowRecord 两态化）、`agent_runtime.rs`（traces 持久化删除、内存化）、`agent_core.rs`（operation 指纹改读内存草稿）、`execution_agent.rs`（implementation_hash 删除、resume 流程简化）。
- 依赖：无增删。
- 测试：窗口行两态单测、恢复=重做当前窗、旧格式 fixture 反向失败、跨 run 采纳守卫（context/configuration 哈希）保留、既有归属库测试与 `chapter-analysis` e2e 矩阵为门禁。
- 文档：agent 骨架契约追加「WINDOW_VERSION bump 纪律」条款（与 unify-agent-architecture 的契约节衔接）；`docs/knowledge` 收尾登记取舍。
- 不涉及：前端、协议绑定、其他三条链路、数据库 schema。
