# Tasks

## 1. 窗口行两态化

- [x] 1.1 重构 `chapter_analysis/checkpoint.rs`：`WindowRecord` 收敛为 `{format_version, plan, context_hash, configuration_hash, outcome: Option<Outcome>}`，`WINDOW_VERSION` 6→7；`validate()` 不变式在两态语义上保留（审阅必须伴随分析、plan 一致性）。验证：`cargo test -p castglean checkpoint` 通过
- [x] 1.2 `execution_agent.rs` 恢复流程简化：`outcome: Some` → 跳过；`None` → 从头重做该窗口（不再比较草稿级 identity）；身份守卫哈希比较上移到记录层。验证：恢复路由单测覆盖 completed-skip 与 redo 两分支
- [x] 1.3 完成时机收敛：分析+审阅两阶段全部完成后一次性落 `outcome`；删除各阶段中间落库点。验证：单测断言中间阶段无落库、完成后产物字段齐全
- [x] 1.4 全量 grep 核对 `checkpoint`/`traces`/`Identity` 的引用方（效率实验 harness、review/observation/audit 模块、publication），迁移或确认无需变更。验证：`grep -rn "record.traces\|Checkpoint"` 无遗漏引用，编译通过

## 2. traces 内存化

- [x] 2.1 `agent_core` 草稿（`SharedDraft`）持有内存 traces；`operation()` 指纹去重改读内存草稿，live-loop 幂等行为保持。验证：现有 agent_core 操作重放测试通过
- [x] 2.2 `agent_runtime.rs` 删除 `save_trace` 持久化与 `WindowRecord.traces` 写入；Trace 类型移入草稿内部。验证：`grep -rn "save_trace"` 无残留，编译与测试通过

## 3. 删除 implementation_hash

- [x] 3.1 删除 `execution_agent.rs::implementation_hash()` 与 22 文件 `include_str!` 列表；`Identity` 结构随之消解（守卫哈希已上移记录层）。验证：编译通过，无残留引用
- [x] 3.2 agent 骨架契约追加「WINDOW_VERSION bump 纪律」条款（unify-agent-architecture 落地则在 engineering.md 契约节追加；未落地则先登记于本 change 与 `docs/knowledge/decisions/chapter-attribution-workflow.md`）。验证：文档 diff
- [x] 3.3 `WINDOW_VERSION` 常量注释与契约条款互相引用，注明「影响分析阶段行为的改动必须 bump」。验证：注释 diff

## 4. 兼容边界与守卫保留验证

- [x] 4.1 反向测试：旧格式（v6，含 session 式 identity/traces 字段）fixture 解码失败且错误清晰。验证：新单测通过
- [x] 4.2 跨 run 采纳守卫保留测试：`resume_input_id` 采纳旧窗口行时，`context_hash`（别名变化）与 `configuration_hash`（配置/模型变化）任一不一致即拒绝。验证：新单测通过
- [x] 4.3 已完成窗口跳过、未完成窗口重做、发布前重验源文本三项端到端行为不变。验证：恢复路由集成测试

## 5. 门禁与收尾

- [x] 5.1 格式化、全目标 Clippy `-D warnings`、rustdoc `-D warnings`。验证：三项命令通过
- [x] 5.2 全量 Rust 库测试 + 集成测试达到既有基线。验证：测试命令与基线对比
- [x] 5.3 `chapter-analysis` e2e 矩阵全绿（含恢复/中断场景）。验证：e2e 命令
- [x] 5.4 知识库收尾：取舍登记（implementation_hash→版本纪律、traces→内存化、窗口重做成本账）与规格对照说明。验证：文档 diff


## 验证记录

- 2026-11-18，macOS Apple Silicon 隔离实例，公开两章工程、GLM Flash。第二章完成归属与预审后发布初稿，可从任务卡打开结果。另一次第一章分析通过助手停止按钮取消。
- 宿主回归分别在第一窗和第二窗预审注入失败，核对未完成记录只有计划、完成窗口复用、配置与上下文摘要不符时零模型请求。原文保护与正式发布沿用既有回归。
- Playwright 18 项通过，含章节分析中英、亮暗、宽窄矩阵，以及恢复、失败导航和审批键盘交互。
