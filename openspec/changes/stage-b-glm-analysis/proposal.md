# Proposal

## Why

阶段 A 已支持正文和标注离线校验，但尚不能自动分析。现在需要独立的单章固定分析能力，先复用 comfy-agent 的 GLM 配置习惯，验证角色发现与归属的实际质量。

## What Changes

- 程序确定完整原文分区和有预算的分析窗口；模型每个窗口一次返回角色与归属建议。
- 建立独立建议协议、最小异步模型接口、顺序分析及应用校验；正式 ID 和坐标由程序管理。
- 实现 GLM/genai 适配、显式配置、CLI `.env` 加载及 `analyze` 命令。
- 支持超时、取消、截断及无效输出的明确失败；失败不发布结果，未知归属保持未知。
- 增加离线替身测试、公开中文样例真实调用基线和使用文档。
- 根据用户批准的真实章节性能诊断，增加默认 low 的显式 GLM 思考等级与可选推理 token、最终文本字节统计，保持相同窗口做对照。
- 根据用户批准的结构化输出调研，增加 JSON/Schema/单工具三种显式传输与脱敏解析分类；实际探测显示严格 Schema 未可靠生效、工具复杂协议出现结构失败，采用 JSON mode 默认且不自动降级。

## Capabilities

### New Capabilities

- `chapter-analysis`: 确定性切片、有限窗口、建议校验和独立库分析结果。
- `model-access`: 显式 GLM 接入配置及 CLI 环境文件和模型错误边界。

### Modified Capabilities

无。阶段 A 的校验规则保持不变。

## Impact

涉及 core 的 document/analysis、model 适配与 CLI 装配，增加 Tokio、tokio-util、genai、dotenvy 等必要依赖。正文与持久化 DTO 不修改；模型建议另行定义。TRNovel、工具循环、跨章自动合并、持久化恢复及完整人工修正工作流留在后续阶段。
