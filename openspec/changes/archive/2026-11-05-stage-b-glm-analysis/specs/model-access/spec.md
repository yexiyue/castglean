# Spec Delta

## Purpose

提供可替换的文本模型接入边界，首个实现对接 GLM，并支持用户现有 comfy-agent 配置。环境文件加载限制在 CLI，库接收显式模型、服务端点及认证信息，使独立库可安全嵌入宿主应用。

## ADDED Requirements

### Requirement: 显式输出约束
系统 SHALL 支持 json、schema、tool 三种显式输出方式，CLI 参数优先于进程环境和环境文件。建议 Schema SHALL 从同一 Rust 建议类型生成。工具方式 SHALL 强制单次 submit_analysis 返回，仅接受一个同名工具调用，不执行副作用或工具循环；其他方式 SHALL 拒绝工具调用。模式失败 SHALL 不隐式降级或重试。默认方式 SHALL 在实际端点和协议验证后确定。

#### Scenario: 工具结果经过统一校验
- **WHEN** 模型返回一个 submit_analysis 调用
- **THEN** 参数交由同一 core 建议及引用校验，不直接写入结果

#### Scenario: 多次或未知工具调用
- **WHEN** 响应包含多个调用或其他工具名
- **THEN** 返回脱敏响应错误，不执行调用

#### Scenario: 参数接受不代表严格约束
- **WHEN** 端点接受严格 Schema 但返回违反 Schema 的响应
- **THEN** 报告约束未被该探测证明，不据此宣称服务端保证结构有效

### Requirement: 显式思考预算与可选统计
GLM 配置 SHALL 默认请求 low 思考等级，允许显式 high/max。CLI SHALL 支持 REASONING_EFFORT 及 --reasoning-effort，参数优先于进程环境、环境文件与默认值；无效等级 SHALL 明确失败。统计 SHALL 记录请求等级、服务端可选推理 token 和最终建议字节数，缺失明细 SHALL 保留未知而非零，不记录思考正文。

#### Scenario: CLI 覆盖思考等级
- **WHEN** 参数与环境提供不同思考等级
- **THEN** 实际请求与运行统计使用参数指定等级

#### Scenario: 缺少推理明细
- **WHEN** 服务端只报告总完成 token
- **THEN** 保留总数，推理 token 为 null，不推测最终文本 token

### Requirement: 显式配置 GLM
系统 SHALL 支持显式模型、HTTP(S) 服务端点和密钥，拒绝空白值及无效端点；库 SHALL 不读取环境文件或修改进程环境。模型请求 SHALL 使用普通文本 JSON 建议，不依赖工具调用。

#### Scenario: 嵌入调用
- **WHEN** 宿主传入 GLM 配置及现有异步运行时
- **THEN** 库使用该配置调用模型，不创建独立运行时

### Requirement: CLI 环境文件
CLI SHALL 支持 `.env` 及显式环境文件路径，使用 MODEL、API_BASE_URL、BIGMODEL_API_KEY；已有进程环境变量优先。离线 validate SHALL 不依赖环境文件或模型凭据。

#### Scenario: 环境覆盖文件
- **WHEN** 环境变量与环境文件提供不同模型
- **THEN** 使用环境变量的值

### Requirement: 凭据与错误保护
系统 SHALL 将模型错误转成不含认证值和原始响应正文的诊断。真实 `.env` 和运行输出 SHALL 不进入 Git；可提交的环境示例 SHALL 只含占位密钥。

#### Scenario: 服务调用失败
- **WHEN** GLM 返回认证或网络错误
- **THEN** 返回可区分的模型失败，不输出密钥或完整请求正文

### Requirement: CLI 显式发布结果
CLI SHALL 提供 analyze 输入正文与书章 ID，完成分析后在新的指定目录发布快照、角色表、标注与统计，不覆盖已有目录。失败 SHALL 不留下可误认为成功的最终目录。

#### Scenario: 新目录成功分析
- **WHEN** 模型建议经完整校验且未取消
- **THEN** 输出目录包含可由 validate 消费的规范化正文、角色表和标注

#### Scenario: 已有输出目录
- **WHEN** 用户指定的输出路径已存在
- **THEN** 拒绝执行，不覆盖文件
