# Tasks

## 1. 骨架契约成文与对齐审计

- [x] 1.1 `docs/engineering.md` 新增「agent 骨架契约」节：design 决策 1 的六条契约逐条成文，含例外登记规则。验证：文档 diff
- [x] 1.2 四条链路对照契约审计表（助手/分章/归属/选角 × 六条），逐格记录符合/例外。验证：审计表落 design 附录或知识库
- [x] 1.3 修齐审计发现的廉价对齐项（入口 `freeze`/`execute`/`resume` 命名、模块布局）。验证：`cargo check` + 对应链路测试通过

## 2. 分章 pipeline 重写（删 graph-flow 前置）

- [x] 2.1 重写 `novel_import/splitting/graph.rs` 为 `pipeline.rs`：`Phase` 枚举 + design 决策 2 转移表的唯一转移函数。验证：`cargo test -p castglean pipeline` 通过
- [x] 2.2 检查点简化为 `{version, phase, last_tool}`（版本 CAS 保留）；不实现旧格式解码。验证：新格式单测通过
- [x] 2.3 反向测试：手工构造旧格式 checkpoint fixture，断言恢复失败且错误清晰（`InvalidResponse`）。验证：新单测通过
- [x] 2.4 平移 `prepare`/`validate` 的 scope 与源文件校验（每阶段重查）；`diagnose` 仍经 `ai::assistant::execute`；600 秒超时保持在 `ai/tasks.rs`。验证：任务路由测试通过
- [x] 2.5 `splitting.rs` 模块声明与 `ai/tasks.rs` 调用点更新（入口签名不变）。验证：`cargo check -p castglean` 通过
- [x] 2.6 graph 测试平移为 `pipeline/tests.rs`（恢复路由全覆盖：validate 中断不重跑模型、review 后新 turn 重置 prepare、崩溃恢复不重放已完成业务工具）。验证：平移测试全绿

## 3. 共享 Hook 整合（逐链路迁移）

- [x] 3.1 提取共享 Hook 实现到 `ai/`（dispatch 事实记录、usage、取消、失败暂存；域差异回调注入），先以助手链路迁移接入。验证：助手链路库测试 + e2e（chapter-agent、unified-issues 等）通过
- [x] 3.2 归属分析 Hook 迁移到共享实现（窗口持久化回调保留）。验证：归属库测试 + `chapter-analysis` e2e 矩阵通过
- [x] 3.3 选角 Hook 迁移到共享实现（draft 失败旗标回调保留）。验证：选角库测试与 casting 相关 e2e 通过。覆盖同源候选 Schema、字符串候选的位置及修复示例、累计三次失败停环、审批挂起与重启恢复、重复决定和投递去重、建议只发布一次
- [x] 3.4 删除三处旧 Hook 重复实现；`grep` 确认无残留自有 `AgentHook` impl（共享实现除外）。验证：生产链路仅使用共享实现，保留测试及评测探针

- [x] 3.5 验证运行状态与恢复身份。覆盖无中断完成与待审批挂起、队列重投同一身份、显式重试新身份、订阅重连回放持久事实。

## 4. 依赖移除

- [x] 4.1 `src-tauri/Cargo.toml` 删除 `graph-flow = "=0.8.1"`；限定范围刷新锁文件，不批量升级其他依赖。验证：`cargo build -p castglean` 通过且 `Cargo.lock` 无 graph-flow

## 5. 门禁与收尾

- [x] 5.1 格式化、全目标 Clippy `-D warnings`、rustdoc `-D warnings`。验证：三项命令通过
- [x] 5.2 specta 绑定导出无 diff、前端生产构建通过。验证：导出与构建命令
- [x] 5.3 全量 Rust 库测试 + 集成测试达到既有基线。验证：测试命令与基线对比
- [x] 5.4 e2e 恢复套件全绿：`chapter-boundary-recovery`、`split-recovery-route`、`pause-draft-replacement`、`pause-recovery`、`pause-run-replacement`。验证：e2e 命令
- [x] 5.5 知识库收尾：更新 `docs/knowledge/decisions/normalize-splitting-agent.md`（指向 `pipeline.rs` 宿主状态机与统一骨架契约，记录「无兼容」决定及升级边界）。验证：文档 diff

## 验证记录

2026-11-18，macOS Apple Silicon。Rust 库测试 446 项与集成测试 2 项通过，13 项按测试配置忽略。浏览器回归 17 项通过。格式、全目标 Clippy、rustdoc、宿主与前端构建、OpenSpec 严格校验通过，Specta 导出与工作区原有绑定逐字节相同。

选角用本地 HTTP 夹具驱动真实 Rig 工具循环。第三次错误提案的修复回执已持久化，循环停止，未产生审批。SQLite 协议和队列测试覆盖审批恢复、重复决定、执行身份和建议唯一发布。旧分章检查点回归覆盖拒绝旧格式且不请求模型。本次验证未复跑原生桌面的真实模型和试听合成。

Rig 原生接口复核后接入 `args_schema`、按作用域注册的 `ToolServer` 和仅在测试启用的 `rig-cassette`。选角审批计划与工具成功回执合并为一次 SQLite 提交。使用锁定依赖通过 448 项 Rust 库测试和 2 项集成测试，以及全目标 Clippy 与两个相关 OpenSpec 严格校验。注入回执写入故障时，审批记录随事务回滚。合成模型回放核对请求并复用录制输出。
