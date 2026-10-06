# 本地模型服务接入

## Why

Qwen3-14B 已在本机通过 mistral.rs CUDA 服务实测，但正式 library 与 CLI 仍仅支持 GLM。需要将验证过的本地路径纳入独立工程，继续使用程序校验和有限修复。

## What Changes

- model 增加显式配置的本地 OpenAI 兼容 Chat Completions 适配器，默认 Schema、关闭思考，无凭据要求。
- CLI 增加 local/glm 后端选择及本地独立环境变量；已有无后端配置保持 GLM 兼容，本机 `.env` 显式选择 local。
- 核心提示词明确表达类型与空白覆盖，版本递增，保持接受和发布规则。
- 记录本地启动、库用法与真实 CLI 对照，保留 GLM，不自动回退或启动模型进程。

## Capabilities

### New Capabilities

- `local-model-service`: 本地服务配置、Schema 请求、受限响应转换、后端装配与失败隔离。

### Modified Capabilities

无；现有阶段能力尚未归档，本次沿用核心校验与发布合同。

## Impact

涉及 model、CLI、核心提示词及版本、测试和使用说明。增加直接 HTTP 客户端依赖，不引入 GPU 依赖、crate、Agent 框架或外部项目集成。权重、凭据、运行结果继续忽略。
