# 提案：证据优先的归属判断与 MiniMax 接入

## Why

本地 Qwen 的三个公开样例目前只对四个表达单元中的两个判断正确，主要把候选人物误判为确定归属。需要明确证据要求，并在国内 MiniMax 上做相同输入的前后对照，判断收益是否能够迁移。

## What Changes

- 提示词明确确定、有限候选与未知的区别，禁止仅凭轮次、名字相邻或同名合并猜测身份。
- 接入 MiniMax 国内 Chat Completions，配置隔离、错误脱敏，复用有限校验修复及发布流程。
- 在同一模型内比较旧版和新版提示词，记录失败、语义指标、token 和延迟；保持本地后端默认。

## Capabilities

### New Capabilities

- `attribution-guidance`：基于原文证据区分确定、歧义和未知，并版本化提示词与对照记录。
- `minimax-model-service`：显式配置国内 MiniMax 文本生成服务，与核心验证流程协作。

### Modified Capabilities

无；当前主规范尚未同步，已有阶段变更继续保留。

## Impact

涉及 core 提示词、model 服务适配器、CLI 配置、测试与说明。保持 AnalysisModel 接口和正文标注格式，不新增 crate、Agent、网络重试或自动后端回退。密钥、运行产物和模型权重均留在忽略目录。
