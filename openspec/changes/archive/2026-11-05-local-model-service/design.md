# 本地服务设计

## Context

见 proposal.md 的动机及 docs/qwen3-14b-local-test.md 的实测。核心为泛型 AnalysisModel，CLI 当前直接装配 GlmModel，环境读取和发布集中在 analyze.rs。

## Goals / Non-Goals

目标是提供 LocalConfig/LocalModel 的独立库接口，以及 CLI 显式后端切换。复用宿主运行时，GPU 与服务进程仍由用户管理。不做嵌入推理、凭据代理、能力自动探测、网络重试或 TRNovel 集成。

## Decisions

- model/local.rs 直接使用 reqwest 的 Chat Completions HTTP 请求，固定使用已验证的 Schema 与关闭思考配置。genai 的 GLM 适配保持不变，避免把厂商思考及工具枚举强行复用为本地公共 API。
- LocalConfig 校验模型与基础 URL，LocalModel 禁用重定向与隐式代理，分块读取响应并限制到 1 MiB；解析完整单 choice、非空 content、finish_reason、用量，过滤异常响应。程序的建议大小及业务预算继续由 core 控制。
- CLI model_config.rs 管环境优先级、后端选择、私有模型枚举和安全元数据；analyze.rs 继续只调用核心和发布。MODEL_BACKEND/--backend 选择后端，LOCAL_MODEL/LOCAL_API_BASE_URL 与 GLM 变量独立。无后端选择仍默认为 glm；本机忽略的 .env 改为 local，原 GLM 配置保留。
- local 默认 window_chars=1000、window_segments=8、max_output_tokens=2048；参数可覆盖。GLM 默认值保持原样。本地不接受 GLM 专属思考值或非 Schema 模式，显式报配置错误。
- 在核心协议提示词明确类型定义、空白覆盖，提升 ANALYSIS_PROMPT_VERSION；不改变 DTO 或接受条件。

## Risks / Trade-offs

- 12 GB 显存余量较小 → 默认单并发和小窗口，部署与上下文上限由说明明确。
- Schema 无法证明引用及语义正确 → 保留纯校验与有限修复，真实样例独立评分。
- 本地接口扩展属于 mistral.rs → 只承诺已验证服务，其他兼容服务需另行测试，不静默忽略失败。

## Migration Plan

先完成离线 HTTP 与 CLI 测试，再启动已保留容器跑真实 CLI 样例。本机 .env 显式选择 local，可用 --backend glm 回到保留的原配置。产物格式不变，提示词版本递增使后续缓存能区分。
