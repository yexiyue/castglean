# Agent 运行时与 AI 预审调研

日期：2026-11-08。适用：CastGlean 当前 Tauri/Tokio/SQLite 宿主，已锁定 rig-core/rig-agent/rig-reqwest 0.46.0。状态：源码与发布信息调研、一次真实模型盲预审完成；未引入新依赖、替换运行时或修改并发限制。

后继实施（2026-11-08）：已按用户授权完成[隔离 ECS 原型](../decisions/rig-ecs-evaluation-prototype.md)的受控离线验证；本文的源码调研和真实盲审记录保留为历史依据。正式应用是否迁移、真实 ECS 模型质量和性能仍未决定或验证。

## 用户方向

①宿主预切片＋②紧凑归属输出＋③低思考预算已选定。用户进一步提出由 AI agent 先做最后一道审阅，再交给人查看，纳入落地方向；这是新增的 AI 预审阶段，不能把模型生成或模型认可当成人工确认。

候选流程：预切片与引语层级→整章人物快照→有限并发标注→宿主完整校验→AI 预审→宿主验证审阅建议→待人工审阅初稿。预审应读完整章及待审阅标注，返回问题片段 ID、依据、明确错误/疑点区分及修正建议，避免重写整个章节。人工字段与边界继续保护；AI 预审通过也保持未审阅状态。复核、修正和复核后检查必须有界，不能无限自我修改。

## 当前限制在哪里

| 层级 | 当前行为 | 拥有者 |
| --- | --- | --- |
| 运行准入 | 全局两个运行；同一连接只准入一个运行 | `src-tauri/src/jobs/runtime.rs::Runtime::{new,admit}` |
| 队列 Worker | `.concurrency(2)` | 同文件 `start` |
| 章节模型调用 | 循环等待当前窗口完成，后窗继承本章人物候选 | `src-tauri/src/chapter_analysis/execution.rs::execute` |
| 工程助手工具批次 | `.tool_concurrency(1)`；rig-agent 默认也为 1，API 可调整 | `src-tauri/src/novel_import/splitting/execution.rs` 与已下载的 rig-agent 0.46.0 `agent/runner.rs` |
| 后台 HTTP/模型调用期限 | 每请求 600 秒 | `src-tauri/src/llm/{providers,transport}.rs` |

这些是本地应用策略及执行顺序，不能由此推断远端网关、Coding Plan 或底层模型的并发上限。尚未做 2/3 路服务商并发实测。`Runtime::handle` 的 `workers = Semaphore::new(1)` 用于工具工作退出后的收尾等待，不应误算成又一层模型请求限流。

增加子运行仍会受同连接准入约束。并行标注应设计为同一父运行下的有界子任务，并给所有相关调用施加共享的连接级请求并发配额、取消和用量记录；不能靠子任务绕过应用限制。

## 上游 0.46.0 的实际定位

核对 crates.io API、发布说明、版本固定文档，并下载 0.46.0 的 crate 源码到系统临时目录阅读；没有执行上游代码或修改 Cargo 依赖。rig-ecs 与 rig-harness 均已发布 0.46.0，2026-10-31 发布，未标记 yanked，声明 Rust 1.97.1。

| 包 | 定位及能力 | 对当前任务的影响 |
| --- | --- | --- |
| `rig-core` / `rig-agent` | 当前已接入的模型抽象和经典 Agent/工具运行时 | 可继续支撑并发结构化请求与独立预审角色；无需为几路请求先切换内核 |
| `rig-ecs` | Bevy agent 内核：agent/turn/call/effect 实体、消息、任务调度、会话日志、恢复与 fork | 适合探索多 agent 长期协作和可观测生命周期；会引入新的调度与会话状态模型 |
| `rig-harness` | 建于 ECS 内核上的编码 agent 宿主；提供会话、launcher、进程服务、命令、问题与插件扩展 | 可用于独立 agent 产品；整体接入 CastGlean 会与既有 Tauri 宿主、Apalis 和 SQLite 会话职责重叠 |
| `rig-basics::subagents::SubagentsPlugin` | 可选插件，提供 task/message/wait、子任务报告、层级策略、停止传播和工具范围 | 现成子 agent 功能位于这里，不能只添加 rig-harness 就假设已得到该能力 |

发布源码中的 harness 使用 Bevy `=0.20.0`、关闭 Bevy 默认 features，不应误称必须接入完整渲染引擎。`rig-basics` 的 TUI 是默认 feature，可以关闭。`rig_harness::services::TokioRuntime` 接受已有 Tokio Handle；技术上存在复用宿主 runtime 的入口，尚未在 Tauri 中验证，不能断言必须创建第二个 Tokio runtime。

0.45 开始的 rig-ecs 是对 0.43–0.44 同名 crate 的替换，API 不相关，旧 `CONTRACT.md` 的 checkpoint/World 接口不能直接作为 0.46 的接入依据。0.46 ECS 还有自己的模型重试策略；接入时必须对齐应用恢复及请求次数语义，不能叠加出隐式重发。ECS 会话保存也不能直接替代来源绑定、人工保护、发布事务和本地副作用幂等。

## 建议与未验证项

短期沿用现有 Rust 宿主及 Rig 0.46，优先实现明确的分析/预审职责和请求级有限并发，再以同一章节测 1/2/3 路的端到端耗时、审阅增量耗时、检错/误报及完整交付。AI 预审的独立提示并不代表独立模型证据，同一模型仍可能重复原判断；已知嵌套称号错误可作为预审检错样例，但不能把答案写进盲审提示。

ECS 可另做隔离 spike，重点验证三个子任务、只读审阅角色、复用 Tokio、取消传播、重启后有效子结果复用，以及 SQLite 与模型配置修订的单一权威。只有功能与验收证明收益后，再决定是否迁移。当前没有理由仅为并发请求整体接入编码 agent harness。

## 一次真实模型盲预审

以已授权的同章、①②③第二轮原始结果为输入，另写独立审阅提示。审阅员读取完整 284 个带短 ID 的正文片段、角色及原始标注；没有提供冻结检查答案、已知错误位置或原分析提示。沿用同一 GLM 服务和 low 请求，通过现有实验桥调用一次模型，未接入 ECS/harness 或新的工具循环。

- 耗时 46.553 秒；服务报告输入 14426、输出 2293、缓存输入 0、推理 0 tokens。
- 返回 4 组、涉及 11 个不同片段的类型疑点，全部标为 uncertain，没有宣称确定错误。
- 命中此前已确认的台词内部嵌套称号误判；其余提示也集中于引语内部术语被分成旁白，尚未独立逐项核实，不计算精确率、召回率或自动修正收益。
- JSON 形状、片段及人物键引用校验通过；未自动改写标注或改变人工确认状态。它证明一次独立提示的预审能发现该样本中的已知问题，不证明同模型双审有独立性保证。
- 本次预审本身增加约 47 秒，后续端到端实验应单独记录其耗时，并检查确定性引语层级提示能否降低审阅成本和误报。

本机证据保存在忽略目录 `src-tauri/target/analysis-experiment-20261108-background/ai-pre-review/`，含盲审来源记录、请求、响应与引用校验；不提交正文及模型原始报告。原正式四组实验统计不因这次预审而改写。

## 来源

- [rig-ecs 0.46.0 API](https://docs.rs/rig-ecs/0.46.0/rig_ecs/)
- [rig-harness 0.46.0 API](https://docs.rs/rig-harness/0.46.0/rig_harness/)
- [rig-basics 子 agent 插件](https://docs.rs/rig-basics/0.46.0/rig_basics/subagents/)
- [Rig 0.46 发布说明](https://github.com/0xPlaygrounds/rig/releases/tag/v0.46.0)
- [上游迁移说明](https://github.com/0xPlaygrounds/rig/blob/v0.46.0/MIGRATING.md)
- [已选协议与对照结果](chapter-protocol-experiment.md)
