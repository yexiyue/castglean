# 章节分析评测与可观测契约 v1

日期：2026-11-08。两条路线共享此契约：`recommended`（Rig＋Tokio）与 `rig-ecs` 原型。它是实验适配器边界，不替代正式工程格式、人工确认或发布事务。

## 版本化输入与输出

评测用例含 `version:1`、`caseId`、`split`（development/holdout）、`source:{text,sha256}`、`characters:[{id,name}]`、固定 UTF-8 检查单元 `gold:[{id,start,end,kind,speakers}]` 和可选 `reviewGold`。kind 为 narration/speech/thought；speakers 是规范身份 ID 的集合，narrator/unknown 是保留值，不能以显示名碰撞自动对齐。每个用例记录人工答案来源/复核状态。正文及答案的摘要冻结后才请求模型，修改答案产生新数据集版本。

各路线适配器接受一行 JSON 对象（也可由同等 Rust DTO 消费），返回 `version:1`、`caseId`、`route`、`status`（completed/failed/cancelled/interrupted）、`segments:[{start,end,kind,speaker,evidence}]`、`review:{status,issues}`、`trace`。start/end 为源内半开 UTF-8 字节坐标，speaker 为提供的规范 ID 或保留值；歧义另带 `candidates`，不能用名称替代身份。evidence 为 `[{start,end}]`。可另带诊断字段，但评分不从聊天解释推断标注。

所有输出先验完整覆盖、非空 UTF-8 范围、类型/归属一致性、身份及证据合法；失败/半章不计作有效交付。模型角色发现的身份对齐另列，不与已知身份用例混用；不能靠测试夹具传入 gold 生成假模型结果再声称真实准确率。

## Trace

每次运行拥有稳定 `runId`；每个阶段/请求记录 `spanId,parentSpanId,stage,route,attempt,status,startedAt,elapsedMs`。stage 至少包括 prepare、identity（有则记）、analysis、validation、review、publish（原型只验证不得伪造发布）。时间为真实观测；span 的父子关系区分并行组和模型请求。

请求元数据含 `model`、`configurationHash`、`promptVersion,promptHash,protocolVersion,sourceHash`；可附 `datasetHash,codeRevision`。`usage:{inputTokens,outputTokens,cachedInputTokens,reasoningTokens}` 缺失为 null，不把未知当零，不把缓存加到输入总量。失败、取消与超时也留终态；无响应的成本未知。

默认事件和报告不含正文、凭据、人物名、提示词或响应原文。显式私人诊断文件仅放 Cargo target 忽略目录。评测缓存键必须包含来源/提示词/协议/配置/代码及数据集版本；重放、受控 mock 和真实在线请求分别标识。

## 指标和对照

- 完整有效交付率；失败按解析、覆盖、身份、证据、取消、超时区分。
- 固定单元类型＋规范身份联合正确数、逐字节类型/归属准确率；缺失交付仍保留在分母，不只看成功样本。
- 各阶段及端到端时间、请求数、实际并发峰值、token 已知部分与未知请求数。
- AI 审阅按预置错误位置计检出、漏检、误报及建议有效性；AI 自评不是 gold。审阅通过仍是未人工确认。
- 对照必须具有相同 datasetHash、caseIds、goldHash 和配置身份；提示词/协议/route 差异显式列出。开发集与留出集分开，不能用留出结果调提示词再称泛化。

公开合成数据位于 `evaluations/chapter-analysis-v1/`。私人小说验证沿用已授权冻结输入，但不得提交全文、原始响应或用例原文。每轮可复现实验记录命令、程序/数据/配置摘要、执行顺序、已知缓存与平台边界。自动门禁优先校验完整性/确定性回归；真实模型质量门槛须用固定评测报告证明，不能以 SDK 编译成功代替。
