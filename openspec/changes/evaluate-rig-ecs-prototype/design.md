## Context
Rig ECS 0.46 是 Bevy agent kernel，与 0.43–0.44 不兼容。源码依据为发布 crate，Context7 只作接口线索。宿主已有 TaleChime/Metal 与 Tauri 大依赖图；为保证实验独立运行、避免将 Bevy 引入产品，采用独立实验 package，不作为产品后端。

## Goals / Non-Goals
目标：真实 AgentPlugin/Deliver/TurnCall/TurnOutcome；三个并发子任务，共用不可变角色快照；预审只读；同一公共评测；取消、失败、超时、部分恢复均可检查。
非目标：整包 harness、编码工具、迁移生产数据库、自动采用预审、自动重试、UI、产品发布。

## Decisions
- package 使用显式 rig-ecs-prototype feature，锁定 rig-ecs/rig-core/rig-memory 0.46.0 与 Bevy 0.20.0。产品 Cargo 文件保持独立。
- 父 agent 为取消根，子 agent 用 SpawnedBy 关联，StopTurn 传播；模型使用真实内核 ModelAdapter dispatch，受控 transport 测试仅替换模型边界。
- 在 ReviewSystems 阶段将 RetryVerdict 改为 Final；0.46 内核固定四次重试不是资源配置，不能假设可直接设 max_retries=0。
- 完成结果必须结构校验后记录；每项发送前保存 in_flight，恢复保留 unknown/取消/失败事实且不重新 Deliver。仅尚未发送项可继续；身份改变拒绝恢复。
- trace 默认只含身份摘要、阶段、route、attempt、状态和耗时，真实 token 缺失为 null；不记录原文、密钥或原始响应。检查点与私人产物只写 target 忽略目录。
- 公共契约出现后对齐字段及公共固定 gold/宿主校验，不把脚本 transport 正确输出当作模型质量证明。

## Risks
Bevy 任务池不等于 Tokio HTTP runtime；在线适配需显式现有 Handle 桥接。取消本地 future 不证明服务商未计费。原型文件检查点不等于生产 SQLite 事务与并发 owner 租约。

## Validation
受控请求 barrier 证明三路实际重叠；未知/错误输出被拒；父取消停止子 turn；超时保留证据；可重试错误只调用一次；新进程恢复复用完成项且不重发在途项；预审不能改写分析或人工状态。真实在线评测等待父任务排期。
## 公共评测对齐（2026-11-08）

输入按 `evaluationTask:analysis|review` 分别执行。首次 analysis 不接受植错候选；review 仅使用 reviewInput，经宿主完整校验后从候选 segment 生成 sN targets。预审返回 suggestion 必须验证规范角色/类型，保存但不采用。review.status=completed 表示 AI 阶段完成，humanReviewStatus=unreviewed。

公共 suite 固定 known-only identity scope，不测角色发现、不按姓名对齐。configurationHash 只含模型配置、reasoning=low 和 identityScope=known-only；route/code/prompt/protocol 差异单列，受控脚本摘要和 deadline/concurrency 等执行控制另进恢复指纹。metadata 在请求 span 嵌套，isRequest=true，startedAt 固定六位微秒的 UTC 字符串；非请求父 span 不重复 token。SIGKILL 遗留 running span 恢复为 interrupted，elapsedMs 标为观测下界。

当前 driver 仅提供显式 mock transport，generic Kernel 可接 ErasedHandler，但尚无真实网关 CLI 及生产连接租约接入。在线评测须与父任务排期，不通过打开环境变量隐式发网关请求。

## 原生 live 模型边界接续（2026-11-08，已授权实施）

新增显式 `native-live` feature 与 `--live-config`，默认仍为原离线脚本。Live 配置显式指定 bridgeBinary/configPath/selection；只读重查非密钥配置取得实际 API model、revision 和可空容量，不读取密钥或把 URL/凭据复制到原型。

使用 Serve/ErasedHandler 处理内核实际 CompletionRequest，以受限 call job 委托原生 testbridge；真实模型使用用户模型 ModelSpec、未知容量和未验证能力，不复用 DeepSeek catalog 能力。每请求 600 秒、无重试；job/result 文件在 target 内私有临时目录，helper stdout/stderr 不落公开日志。子进程由原型拥有、取消/超时需 kill 并 wait，不允许 detach。取消已开始的 live 请求保留 unknown 和远端状态未知，不宣称提供商停算。

Live 配置 hash 采用主线统一 canonical JSON：{configuration:{selection:{connectionId,modelId},revision},capacity:[contextWindow,maxOutputTokens],model:<实际 API ID>,reasoning:'low'}。known-only scope 独立 metadata；mode、helper 身份、route、code、prompt、protocol、dataset 和执行控制另入恢复指纹。mock/live/受控 helper 分离，不能恢复串用。

先验受控 helper 与实际非密钥配置解析；后经父任务明确排期完成公共 dev/holdout live。两组均同配置可比但质量失败，保留实验，不迁移产品。测试必须保留原 19 项，并覆盖 snake_case 用量、子进程清理、超时、失败、配置漂移、unknown 恢复和零重发。
