# 原文引文证据：v2 与真实小说对照

本轮共 344 次章节运行：原创 v2 每后端每模式 40 例各两次，真实小说组每后端每模式六例各一次。金标和原文均在调用前冻结，没有按输出调整答案。v1 历史分数未改写。

## 本轮结论与下一步

默认保留片段 ID 模式。引文作为显式实验选项保留：本地原创 v2 的严格联合准确率从 33.3% 到 54.9%，留出集从 32% 到 48%；MiniMax 的整体分数从 93.1% 到 72.5%，留出集从 88% 到 62%。这些是本轮组合条件下的观察，不能宣称引文必然改善归属。

本地的额外人物从 42 到 16，角色精确率提高，但召回率从 67.3% 到 60%，交付从 62/80 到 59/80。原模式失败为 10 次服务错误、6 次截断、2 次证据错误；引文模式为 16 次截断、3 次重复目标、2 次服务错误。来源要求改善部分成功输出，同时增加输出压力。

MiniMax 原创组的失败从 5 到 15 次，引文模式主要是 JSON 语法、建议结构和覆盖错误。只统计已交付章节，联合正确仍从 95/97 到 74/78：一例无主声音被限定为两个候选，一例心理活动被改为发言；另有组合显示名和同名人物附加编号不在允许称呼中而被拒绝匹配。后两类是严格对齐限制，不能直接称为身份幻觉，也不能按输出事后放宽评分。

小说补充组本地原模式交付 1/6、引文 0/6，所有未交付均为截断，联合严格分数均为 0/12。唯一交付的片段表达类型字节全正确，但对白身份判断错误，且把群体建成额外人物。MiniMax 原模式交付 5/6、联合 8/12，引文模式交付 1/6、联合 3/12；引文失败包括不存在的精确引文、语法、结构及身份引用。真实组为同一作者三篇作品的六个短片段，金标未经用户独立复核，不能概括成完整长篇或现代网文能力。

下一轮优先在开发集研究降低模型协议长度：检查重复的长片段 ID、完整窗口重复结构及引文负担，保持最终正文、稳定身份、数据格式和程序校验不变，再以冻结的新实验条件复测。当前先解决截断和交付，再推进 C 阶段的身份、人工修正与跨章编排；TRNovel 集成仍在最后。本轮没有改动默认提示词或扩大本地输出/上下文预算。

原文引文模式以提示词版本 6、引文 Schema 和来源校验共同构成一个实验条件；结果不能单独归因于提示词、Schema 或修复。片段模式为版本 5。引文存在不证明语义归属。

预算保持：窗口 1000 字符 / 8 片段，每章 8 请求，每窗口一次修复，请求 / 章节时限 120 / 600 秒，本地 / MiniMax 输出 2048 / 8192 token。每后端串行，无自动网络重试和后端回退。

## 原创 v2：开发与留出

| 后端 | 模式 | 分组 | 交付 / 计划 | 联合正确 / 表达 | 联合准确率区间 | 类型字节准确率 | resolved 准确率 / 覆盖率 | 角色精确率 / 召回率 | 额外 / 遗漏 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local | 片段 ID | 整体 | 62 / 80 | 34 / 102 | 33.3% | 69.9% | 56.7% / 58.8% | 63.8% / 67.3% | 42 / 36 |
| local | 片段 ID | development | 32 / 40 | 18 / 52 | 34.6% | 63.6% | 60.0% / 57.7% | 66.7% / 72.7% | 16 / 12 |
| local | 片段 ID | holdout | 30 / 40 | 16 / 50 | 32.0% | 75.2% | 53.3% / 60.0% | 61.8% / 63.6% | 26 / 24 |
| local | 引文 | 整体 | 59 / 80 | 56 / 102 | 54.9% | 68.9% | 79.4% / 66.7% | 80.5% / 60.0% | 16 / 44 |
| local | 引文 | development | 30 / 40 | 32 / 52 | 61.5% | 68.2% | 88.2% / 65.4% | 78.9% / 68.2% | 8 / 14 |
| local | 引文 | holdout | 29 / 40 | 24 / 50 | 48.0% | 69.4% | 70.6% / 68.0% | 81.8% / 54.5% | 8 / 30 |
| minimax | 片段 ID | 整体 | 75 / 80 | 95 / 102 | 93.1% | 94.2% | 98.8% / 79.4% | 98.9% / 79.1% | 1 / 23 |
| minimax | 片段 ID | development | 39 / 40 | 51 / 52 | 98.1% | 97.4% | 100.0% / 82.7% | 100.0% / 93.2% | 0 / 3 |
| minimax | 片段 ID | holdout | 36 / 40 | 44 / 50 | 88.0% | 91.6% | 97.4% / 76.0% | 97.9% / 69.7% | 1 / 20 |
| minimax | 引文 | 整体 | 65 / 80 | 74 / 102 | 72.5% | 78.8% | 96.7% / 59.8% | 96.1% / 67.3% | 3 / 36 |
| minimax | 引文 | development | 35 / 40 | 43 / 52 | 82.7% | 86.0% | 97.2% / 69.2% | 97.4% / 84.1% | 1 / 7 |
| minimax | 引文 | holdout | 30 / 40 | 31 / 50 | 62.0% | 73.0% | 96.0% / 50.0% | 94.9% / 56.1% | 2 / 29 |

## 真实小说：独立补充组

| 后端 | 模式 | 分组 | 交付 / 计划 | 联合正确 / 表达 | 联合准确率区间 | 类型字节准确率 | resolved 准确率 / 覆盖率 | 角色精确率 / 召回率 | 额外 / 遗漏 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local | 片段 ID | 整体 | 1 / 6 | 0 / 12 | 0.0% | 10.3% | 0.0% / 8.3% | 80.0% / 26.7% | 1 / 11 |
| local | 片段 ID | supplemental | 1 / 6 | 0 / 12 | 0.0% | 10.3% | 0.0% / 8.3% | 80.0% / 26.7% | 1 / 11 |
| local | 引文 | 整体 | 0 / 6 | 0 / 12 | 0.0% | 0.0% | — / 0.0% | — / 0.0% | 0 / 15 |
| local | 引文 | supplemental | 0 / 6 | 0 / 12 | 0.0% | 0.0% | — / 0.0% | — / 0.0% | 0 / 15 |
| minimax | 片段 ID | 整体 | 5 / 6 | 8 / 12 | 66.7% | 77.2% | 100.0% / 66.7% | 100.0% / 73.3% | 0 / 4 |
| minimax | 片段 ID | supplemental | 5 / 6 | 8 / 12 | 66.7% | 77.2% | 100.0% / 66.7% | 100.0% / 73.3% | 0 / 4 |
| minimax | 引文 | 整体 | 1 / 6 | 3 / 12 | 25.0% | 11.3% | 100.0% / 25.0% | 100.0% / 13.3% | 0 / 13 |
| minimax | 引文 | supplemental | 1 / 6 | 3 / 12 | 25.0% | 11.3% | 100.0% / 25.0% | 100.0% / 13.3% | 0 / 13 |

## 交付、修复、失败与身份对齐

| 套件 | 后端 | 模式 | 已交付中的联合正确 / 表达 | 未使用修复交付 / 使用修复交付 | 已交付中的修复调用 / 修复成功窗口 | 身份匹配分布 |
| --- | --- | --- | --- | --- | --- | --- |
| attribution-v2 | local | 片段 ID | 34 / 72 | 58 / 4 | 4 / 4 | multiple: 8, not_delivered: 18, partial: 2, unique: 52 |
| attribution-v2 | local | 引文 | 56 / 77 | 56 / 3 | 3 / 3 | multiple: 3, not_delivered: 21, partial: 2, unique: 54 |
| attribution-v2 | minimax | 片段 ID | 95 / 97 | 62 / 13 | 13 / 13 | multiple: 1, not_delivered: 5, partial: 1, unique: 73 |
| attribution-v2 | minimax | 引文 | 74 / 78 | 28 / 37 | 37 / 37 | multiple: 1, not_delivered: 15, partial: 2, unique: 62 |
| literary-v1 | local | 片段 ID | 0 / 1 | 1 / 0 | 0 / 0 | not_delivered: 5, unique: 1 |
| literary-v1 | local | 引文 | 0 / 0 | 0 / 0 | 0 / 0 | not_delivered: 6 |
| literary-v1 | minimax | 片段 ID | 8 / 8 | 3 / 2 | 2 / 2 | not_delivered: 1, unique: 5 |
| literary-v1 | minimax | 引文 | 3 / 3 | 0 / 1 | 1 / 1 | not_delivered: 5, unique: 1 |

### attribution-v2 / local / 片段 ID

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: missing or invisible evidence at /segments/0/attribution | 2 |
| Error: analysis: invalid model suggestion: truncated response | 6 |
| Error: analysis: model transport or service failed | 10 |

### attribution-v2 / local / 引文

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: duplicate target annotation at /segments/2/segment_id | 3 |
| Error: analysis: invalid model suggestion: truncated response | 16 |
| Error: analysis: model transport or service failed | 2 |

### attribution-v2 / minimax / 片段 ID

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: missing target annotation at /segments | 4 |
| Error: analysis: analysis repair exhausted: unknown existing identity at /segments/1/attribution | 1 |

### attribution-v2 / minimax / 引文

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: invalid JSON syntax | 4 |
| Error: analysis: analysis repair exhausted: invalid suggestion structure | 5 |
| Error: analysis: analysis repair exhausted: missing target annotation at /segments | 4 |
| Error: analysis: analysis repair exhausted: undeclared temporary identity at /segments/0/attribution | 1 |
| Error: analysis: analysis repair exhausted: unknown existing identity at /segments/3/attribution | 1 |

### literary-v1 / local / 片段 ID

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: invalid model suggestion: truncated response | 5 |

### literary-v1 / local / 引文

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: invalid model suggestion: truncated response | 6 |

### literary-v1 / minimax / 片段 ID

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: missing target annotation at /segments | 1 |

### literary-v1 / minimax / 引文

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: invalid JSON syntax | 1 |
| Error: analysis: analysis repair exhausted: invalid suggestion structure | 1 |
| Error: analysis: analysis repair exhausted: source quotation not found in evidence segment at /characters/0/evidence_quotes/1 | 1 |
| Error: analysis: analysis repair exhausted: source quotation not found in evidence segment at /segments/7/attribution/evidence_quotes/1 | 1 |
| Error: analysis: analysis repair exhausted: unknown existing identity at /segments/7/attribution | 1 |

## 用量与延迟

| 套件 | 后端 | 模式 | 已观察请求 | 已观察输入 / 输出 token | 已知用量章节 / 计划 | 全部输入 / 输出 token | 总章节秒 / 平均章节秒 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| attribution-v2 | local | 片段 ID | 66 | 59668 / 46722 | 62 / 80 | None / None | 3188.333 / 39.854 |
| attribution-v2 | local | 引文 | 62 | 70809 / 66530 | 59 / 80 | None / None | 4345.781 / 54.322 |
| attribution-v2 | minimax | 片段 ID | 88 | 73648 / 79874 | 75 / 80 | None / None | 797.566 / 9.970 |
| attribution-v2 | minimax | 引文 | 102 | 120188 / 116004 | 65 / 80 | None / None | 1370.634 / 17.133 |
| literary-v1 | local | 片段 ID | 1 | 1216 / 1611 | 1 / 6 | None / None | 492.081 / 82.013 |
| literary-v1 | local | 引文 | None | None / None | 0 / 6 | None / None | 506.485 / 84.414 |
| literary-v1 | minimax | 片段 ID | 12 | 16482 / 16916 | 5 / 6 | None / None | 187.671 / 31.279 |
| literary-v1 | minimax | 引文 | 3 | 5597 / 6770 | 1 / 6 | None / None | 257.079 / 42.846 |

## 执行环境与复核

| 套件 | 后端 | 模式 | 模型 | 平台 / Python | 开始 / 结束（UTC） | 金标冻结摘要 |
| --- | --- | --- | --- | --- | --- | --- |
| attribution-v2 | local | 片段 ID | default | Windows-10-10.0.28000-SP0 / 3.11.15 | 2026-10-06T07:39:39.305032+00:00 / 2026-10-06T08:32:49.702928+00:00 | ba99ef39e7662ee9e2ddc7303640c173902821d6e253a67407a9be1087902463 |
| attribution-v2 | local | 引文 | default | Windows-10-10.0.28000-SP0 / 3.11.15 | 2026-10-06T08:32:51.758552+00:00 / 2026-10-06T09:45:19.179355+00:00 | ba99ef39e7662ee9e2ddc7303640c173902821d6e253a67407a9be1087902463 |
| attribution-v2 | minimax | 片段 ID | MiniMax-M2.5 | Windows-10-10.0.28000-SP0 / 3.11.15 | 2026-10-06T07:39:49.669773+00:00 / 2026-10-06T07:53:51.590760+00:00 | ba99ef39e7662ee9e2ddc7303640c173902821d6e253a67407a9be1087902463 |
| attribution-v2 | minimax | 引文 | MiniMax-M2.5 | Windows-10-10.0.28000-SP0 / 3.11.15 | 2026-10-06T07:53:54.439495+00:00 / 2026-10-06T08:16:46.740002+00:00 | ba99ef39e7662ee9e2ddc7303640c173902821d6e253a67407a9be1087902463 |
| literary-v1 | local | 片段 ID | default | Windows-10-10.0.28000-SP0 / 3.11.15 | 2026-10-06T09:45:21.046750+00:00 / 2026-10-06T09:53:33.193093+00:00 | 6393cb9e80f174db6e065dd67a4780fda4b255ec9048e4dd74bd3912ad4815dc |
| literary-v1 | local | 引文 | default | Windows-10-10.0.28000-SP0 / 3.11.15 | 2026-10-06T09:53:33.628915+00:00 / 2026-10-06T10:02:00.151664+00:00 | 6393cb9e80f174db6e065dd67a4780fda4b255ec9048e4dd74bd3912ad4815dc |
| literary-v1 | minimax | 片段 ID | MiniMax-M2.5 | Windows-10-10.0.28000-SP0 / 3.11.15 | 2026-10-06T08:16:49.358575+00:00 / 2026-10-06T08:19:57.156028+00:00 | 6393cb9e80f174db6e065dd67a4780fda4b255ec9048e4dd74bd3912ad4815dc |
| literary-v1 | minimax | 引文 | MiniMax-M2.5 | Windows-10-10.0.28000-SP0 / 3.11.15 | 2026-10-06T08:19:57.691376+00:00 / 2026-10-06T08:24:14.817297+00:00 | 6393cb9e80f174db6e065dd67a4780fda4b255ec9048e4dd74bd3912ad4815dc |

v2 片段基线使用保存的旧二进制与旧源码快照。旧运行器在收尾时因工作目录源码改变而拒绝完成；独立收尾工具逐项验证执行二进制、保存的源码、冻结金标及全部尝试后完成报告，记录 completion_verification。它没有重跑调用或补填未执行项。新版默认模式另用离线服务比对确认请求、Schema、提示词和文档字节一致。

同一后端串行，两个后端独立并行；基线期间同时发生编译和实现工作，墙钟延迟受本机负载影响，不能视为纯模型性能基准。本地配置名称 default 是服务别名，observed_configurations 记录客户端有效配置而非权重身份证明。本轮核对容器参数为 mistral.rs 0.9.4、Qwen3-14B Q4_K_M、4096 上下文、单并发、服务种子 42；权重摘要与部署说明见 [本地部署记录](qwen3-14b-local-test.md)。服务日志确认部分失败为 CUDA 显存压力导致 503；本轮未重启、未调整参数。

None/null 表示全部调用成本未知；已观察 token 和修复次数来自已交付章节，只是下限，失败调用不能按零计。所有失败仍进入交付率、表达与角色分母。章节耗时含修复与失败，不含离线评分。身份匹配使用允许称呼与证据覆盖，同名多解取下界；匹配拒绝不自动等同幻觉。

真实小说来源与标注边界见 [语料说明](literary-evaluation.md)，来源校验见 [引文模式](quotation-evidence.md)。经典作品可能已在训练语料中，六例补充组不是泛化留出集。逐次配置、状态矩阵、执行顺序和摘要见 docs/evaluations/quotation-*.json。

## 交付验证

32 项 Python 测试、100 项 Rust workspace 测试、2 项 doctest、fmt、Clippy（拒绝警告）、rustdoc（拒绝警告）和七个 OpenSpec 变更严格校验通过。检查通过后的生产源码指纹及构建二进制与实测副本一致。三组冻结语料、八份完整报告及 344 次实际执行已复核；所有失败的目标产物目录均不存在。完整模型产物、旧源码和二进制快照、整篇来源快照继续留在忽略目录，公共内容没有凭据。OpenSpec change 为 verified-quotation-evidence，五项任务完成；本轮未提交或推送。
