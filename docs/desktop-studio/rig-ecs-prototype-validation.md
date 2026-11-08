# Rig ECS 隔离原型验证

日期：2026-11-08。范围：独立实验 package `experiments/rig-ecs-prototype`，不是生产运行时迁移。基线 `b43fa4be733f39978576d23ba2653d3920f850d0`，分支 `codex/rig-ecs-evaluation-prototype`；未合并、未推送。环境：本机 macOS，Rust 1.99.0；锁定 Rig ECS/Core/Memory 0.46.0、Bevy App/ECS 0.20.0。正式应用仍是单 Tauri crate，Cargo 与默认行为装配未改。

## 已验行为

- 真实 AgentPlugin、Deliver、TurnCall、ModelAdapter、TurnOutcome 和 EffectRecorded；三路 agent 在 barrier 下实际重叠，峰值 3。不是仅 Bevy 调普通 mock future。父取消根自己 idle 时，StopTurn 仍传播到三个 SpawnedBy 子 turn，确认 Stopped 和本地 Tokio 任务退出。
- 固定来源 hash、完整 UTF-8 范围、规范角色快照；三个请求共用同一身份，low 参数在实际 CompletionRequest 上核对。公共范围是 known-only，不测角色发现，不按名字对齐。
- 宿主验证覆盖/UTF-8/身份/类型/证据；预审只读，无工具权限，试图调用写工具也不能触发后续模型反馈循环。issue 引用和 suggestion 规范身份被验证，不采用建议，不改人工状态。
- evaluationTask=analysis 不接触植错候选；review 是独立进程的一项模型请求，用 reviewInput 候选边界生成 sN targets。无 gold/reviewGold 进入模型 payload。
- 可重试错误一次发送即终止，不发生内核固定四次自动重试；取消、超时、错误输出均保留终态和 trace。已知 token 原样保留，未知为 null，不把缓存额外加到输入。
- completed 子结果原子写入检查点；配置/来源/数据集/提示/代码/脚本/执行控制不匹配拒绝恢复，匹配也重新校验结果。OS 单写锁、正常重开、新内核和实际 SIGKILL 重开均验证；在途改 unknown，不重新发送。
- 默认 trace/检查点不含正文、姓名、提示或原始响应；产物限制为 package 的 target 忽略树。底层完整 EffectRecord 不写盘；已取消本地任务不证明服务端未处理或未计费。

## 自动检查

从仓库根目录执行，完整命令见[package README](../../experiments/rig-ecs-prototype/README.md)。

| 检查 | 结果 |
| --- | --- |
| `openspec validate evaluate-rig-ecs-prototype --strict` | 通过 |
| `cargo test --locked --manifest-path experiments/rig-ecs-prototype/Cargo.toml --features rig-ecs-prototype -- --test-threads=1` | 19 项通过 |
| 同 package 的 `cargo fmt --check` | 通过 |
| 同 package 的 `cargo clippy --locked --all-targets --all-features -- -D warnings` | 通过 |
| 同 package 的 `RUSTDOCFLAGS='-D warnings' cargo doc --locked --all-features --no-deps` | 通过 |
| `check_shared.py --shared-root /Volumes/yexiyue/castglean` | 公共 suite 24 项测试通过；十例固定数据、两类独立任务及比较器通过 |
| `check_process_recovery.py` | 真正 SIGKILL 后两项 completed 复用，第三项 unknown，新请求 0 |

不运行正式 Tauri/TaleChime 编译或 UI 测试，因为没有改其实现或装配；不据此宣称原生嵌入已验。standalone driver 拥有一个 Tokio runtime，Kernel/RuntimeHandler 接收调用方 Handle；嵌入时必须在宿主后台 owner 上驱动 ECS，不能直接阻塞 WebView 主线程。

## 公共固定评测

只读使用父任务的 `scripts/ai_eval/evaluate.py`、`mock_adapter.py` 和 `evaluations/chapter-analysis-v1`，不在原型另定义评分标准。输入全量白名单由公共 runner 构造，分析和植错预审分进程。数据固定为 dev7/holdout3：

- datasetHash：`099b24a5764827a9b4eae82eb421cff03d0f7b32f9f69dfcffb058e1d2ee8619`
- goldHash：`4c8985235ece2ad3666bfbaf00b39496dddcbe034935b8ee1c0e3afb1951126f`

离线机制冒烟显式采用 `--smoke-narrator`：三个分析范围全为旁白、review 返回空 issues；这个控制模型不读取 gold，不是 AI 质量模型。与公共 Python 全旁白/零问题基线采用事前声明的相同行为配置 `controlled-all-narration-policy-v1`，公共 compare 判定可比，delivery/unit/byte 差值均 0；实际 route、模型请求、提示和协议差异仍列在报告中。这个覆盖配置仅用于两种受控实现的机制检查，不能沿用它掩盖真实两条路线的模型配置差异。

| 共享指标 | 原型与公共控制基线 |
| --- | --- |
| 合法完整交付 | 10/10（dev7/7、holdout3/3） |
| 固定单元联合正确数 | 19/31 |
| 逐字节类型＋规范身份联合正确数 | 553/915 |
| 独立预审完成 | 10/10 |
| 植错检出/漏检/误报 | 0/9/0（刻意零问题基线） |
| ECS 实际 dispatch 与 trace 计数 | 50 个：每章三分析＋自带预审，再独立植错预审 |
| 峰值并发 | 3 |
| 四类 token | 50 个请求均未知，不宣称成本为零 |
| 质量证据 | offline-only；不证明真实模型质量、低思考收益或架构性能优势 |

configurationHash 在 ECS 内统一模型配置＋low＋known-only；mock 脚本/并发/期限、route/code/prompt/protocol 另行绑定或记录。以后与 recommended 做真实比较时必须使用同一实际模型配置和冻结数据，不能把 controlled-script 视为真实网关的同一模型身份。角色发现留给单独真实小说/受控验证，不计本表分数。

最近一次完成的模型配置 scope 检查，configurationHash 为 `02dc2c26d99ed0c898b8c7cbe68159c741369a39b5e18c628f05c8e9e993a1d5`；它代表 controlled-script、未设置 temperature/maxOutputTokens、low 和 known-only，不能与真实模型配置冒充相同。

报告都位于忽略目录 `experiments/rig-ecs-prototype/target/shared-checks/<run>/`，含 ecs-report、baseline-report、comparison、adapter-results 和 verification（含二进制 SHA256）；公共报告同时记录 evaluator 源码 hash，原型 build.rs 把 Git 基线＋实际编译源文件/锁文件 hash 写入 codeRevision，避免只记 HEAD。生成脚本每次创建新目录，不把旧检查点当新模型运行。SIGKILL 证据位于 `target/process-recovery/<run>/summary.json`。

本机最后一轮证据：共享报告 `target/shared-checks/8e6538a3-b9be-4da4-b430-26afa61b7953/`，二进制 SHA256 `dc4aeb17fa80f9130f04819b73749c624aa898e3de99471068aac1b4f846c9d8`；SIGKILL 摘要 `target/process-recovery/ef48daef-f444-49ea-9a10-6920138ec5e3/summary.json`。`failure-checks.json` 额外验证取消和超时通过公共 scorer 保留自身请求 trace，分别分类 cancelled/timeout，未被丢成 adapter_exit。这些目录均相对于 package 根目录；产物不提交。

## 未验证与接续（首轮离线记录）

当前仅有离线受控模型 CLI；Kernel 接受通用 ErasedHandler，真实网关连接、系统凭据、固定模型配置租约仍需父任务排期接入/执行。没有调用已授权私人小说、没有与主线抢连接，没有在线速度/质量/费用结论。

当前三片计划要求来源至少三个 Unicode 字符；更短文本不在原型支持范围。

没有装载 rig-basics SubagentsPlugin 或整包 harness，不宣称 task/message/wait 插件已验。独立 JSON 检查点不替代生产 SQLite 原子事务、owner/generation、人工修正保护或项目采用。尚未验真实桌面 UI、平台线程约束、Windows/Linux、网络断连及远端取消。没有发布阶段或自动采用权限。

## 后继原生 live 验证

本页“尚未接真实网关”的描述属于 `eb934f2` 首轮离线边界，已由后续显式 `native-live` feature 和[在线验证](rig-ecs-native-live-validation.md)替代；原离线数字和证据保持不改写。正式应用、SQLite 和平台边界仍未验，不因实验桥可调用而变成已交付产品功能。
