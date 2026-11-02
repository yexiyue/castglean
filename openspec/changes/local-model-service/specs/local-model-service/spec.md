# 本地模型服务

## Purpose

允许独立库与命令行使用用户管理的本地文本模型服务分析章节，复用原文保护、建议验证及有限修复，并明确区分服务协议成功、结构校验成功和语义正确。

## ADDED Requirements

### Requirement: 显式本地配置

系统 SHALL 接收模型标识及 HTTP/HTTPS 基础地址，无需 GLM 凭据，不读取库内环境变量。地址中的用户信息、查询和片段 SHALL 被拒绝。

#### Scenario: 本地服务无凭据
- **WHEN** 调用方提供有效模型与本地基础地址
- **THEN** 请求发送到该地址的 chat/completions，且不携带 GLM 密钥

### Requirement: Schema 与响应边界

系统 SHALL 发送分析 JSON Schema、关闭思考、温度零及调用方输出上限。只接受一个非空文本结果，转换用量及截断状态；服务错误、超限响应和无效响应 SHALL 使用安全错误类别，不自动回退或重试。

#### Scenario: 接收有效建议
- **WHEN** 服务返回一份文本结果及用量
- **THEN** 核心继续执行相同的覆盖、引用和最终章节校验

#### Scenario: 服务拒绝或候选无效
- **WHEN** 服务返回错误、超限内容或候选不能在预算内修复
- **THEN** 操作停止且不发布产物，不暴露服务正文

### Requirement: CLI 后端选择

CLI SHALL 以参数、进程环境、环境文件、兼容默认值顺序选择 local/glm。local SHALL 使用独立本地变量及保守窗口预算，忽略 GLM 凭据；统计记录实际后端、模型、端点、模式和版本。不得自动启动或下载模型。

#### Scenario: 切换到本地
- **WHEN** 配置 MODEL_BACKEND=local，且未设置 GLM 密钥
- **THEN** 使用本地服务，成功产物可由 validate 检查，保存原文一致

#### Scenario: 既有 GLM 用法
- **WHEN** 没有设置后端选择
- **THEN** 继续使用已有 GLM 配置与默认预算
