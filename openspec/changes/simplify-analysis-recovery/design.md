# Design

## Context

归属窗口行现状为双层结构：`WindowRecord {format_version=6, plan, checkpoint: Option<Checkpoint>, traces: BTreeMap<String, Trace>}`。

- `Checkpoint`（窗内草稿态）= `{identity{plan, implementation_hash, context_hash, configuration_hash}, analysis, local, segments, review, generation}`，在分析/审阅两阶段的多个时机落库，恢复时从中续作；
- `traces` = 窗内逐操作日志，`save_trace` 每次落库，`agent_core::operation` 用 `operation_id` 指纹做跨进程重放（同操作直接返回已存结果）；
- `implementation_hash` = `execution_agent.rs` 用 22 个 `include_str!` 拼接源文件哈希，恢复时重算并整体比较（`c.identity != identity → StaleProject`）；
- 身份守卫中 `plan.anchor_hash` 保护源文本变更，`context_hash`（roles+aliases）与 `configuration_hash`（配置+模型+生成参数）保护**跨 run 采纳**路径：`origin = resume_input_id` 允许新 run 采纳旧 run 的窗口行，别名编辑或配置变化时不得混用（V2 人机裁决设计的守卫）。

## Goals / Non-Goals

**Goals**

- 窗口行两态化：`planned` / `completed`，删除窗内草稿持久化与逐操作日志持久化；
- 删除 `implementation_hash`，代码身份收敛到 `WINDOW_VERSION` 纪律；
- 保留全部真守卫：源文本身份（`anchor_hash`）、跨 run 采纳守卫（`context_hash`/`configuration_hash`）、版本 CAS、完成窗口不重跑、整章发布事务。

**Non-Goals**

- 不动共享基底（`ai/runs`/`history`/`dispatch`/`interrupts`）与其他三条链路的恢复；
- 不做旧格式兼容解码（延续 unify-agent-architecture 的无兼容立场）；
- 保留分析产物格式和冻结输入表。进度继续显示窗口总数、完成数和当前阶段。

## Decisions

### 1. `implementation_hash` → `WINDOW_VERSION` bump 纪律

删除 22 文件拼接哈希。代码/提示词变更使旧窗口草稿失效的职责改由 `WINDOW_VERSION` 手动 bump 承担：任何影响分析阶段行为的改动必须 bump，条款写入 agent 骨架契约并在 PR 检查单登记。备选方案否决理由：保留但缩减文件清单——清单本身依赖手工维护，漏登记新文件会产生比删除更隐蔽的陈旧盲区；构建期生成哈希——引入 build script 换来的仍是同一保证。代价：忘 bump 时陈旧草稿会静默混入，属接受的风险（缓解见 Risks）。

### 2. `traces` 内存化：live-loop 幂等保留，跨进程重放取消

`agent_core::operation` 的 `operation_id` 指纹去重在**内存草稿内保留**（模型在活跃循环里重复提交同一操作仍被幂等拦截）；`save_trace` 持久化与恢复时重放删除。备选方案（保留窗内草稿 checkpoint 仅去 traces 持久化）被否：窗内续作的价值只剩「中断时省一个窗口的重烧」，却仍需维护草稿恢复与身份比较两条路径；两态化的结构更简单且重做成本已被用户接受。

### 3. 窗口行两态化

`WindowRecord` 收敛为 `{format_version, plan, context_hash, configuration_hash, outcome: Option<Outcome>}`：

- `planned`（`outcome: None`）：仅计划身份，恢复时从头重做该窗口；
- `completed`（`outcome: Some`）：分析+审阅两阶段全部完成后**一次性**落最终产物（已校验的分析草稿和审阅结果），恢复时跳过；
- 身份守卫哈希从 `Checkpoint.identity` 上移到记录层（比较发生在记录级，而非草稿级）；
- 阶段间崩溃（分析完成、审阅未开始）→ 该窗口整体重做，接受重烧。

`WINDOW_VERSION` 6→7；`checkpoint.rs` 的 `validate()` 结构不变式（review 必须伴随 analysis、plan 一致性等）在两态语义上等价保留。

### 4. 重做成本的可见性

重烧成本经既有窗口进度投影可见（`RunProgress{total/completed/stage}`），符合规格「未完成请求重新执行的成本与范围可见」；进度派生逻辑（`observation.rs` 聚合窗口行）在两态化后读 `outcome` 有无，零新写入路径。

## Risks / Trade-offs

- [忘 bump `WINDOW_VERSION` → 陈旧草稿静默混入新代码语义] → 骨架契约条款 + PR 检查单 + 契约与 `WINDOW_VERSION` 常量的注释互相引用；影响面有限于归属单链路。
- [中断窗口重烧的 token 成本] → 用户已明确接受；成本 ≈ 单窗口（约 1/N 章、分钟级），经进度投影可见。
- [live-loop 幂等从跨进程降级为进程内] → 模型在活跃循环内重复操作仍被拦截；仅恢复场景改为重做，无重复副作用（操作作用于内存草稿，确定性）。
- [两态化遗漏中间态读取方] → grep 全量核对 `checkpoint`/`traces` 引用（效率实验 harness、review/observation 模块）；tasks 单列核对项。

## Migration Plan

单 PR：两态化 + traces 内存化 + implementation_hash 删除一次落地（三者共享 `WINDOW_VERSION` 7 与同一批测试）；无数据迁移；升级时在途归属 run 重发即可。回滚 = revert 单 commit。

## Open Questions

无。
