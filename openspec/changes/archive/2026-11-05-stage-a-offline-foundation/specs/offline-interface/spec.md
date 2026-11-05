## Purpose

让 Rust 应用和命令行使用者共享离线校验规则，通过可移植 JSON、公开短样例与可独立检查的 Schema 使用草案协议，不依赖模型或外部阅读器。

## ADDED Requirements

### Requirement: JSON 与 Schema 可移植
库 SHALL 基于调用方读写流处理草案文档并生成角色表、章节 Schema；格式 SHALL 附至少三个公开短场景和结构、语义无效样例。

#### Scenario: 样例往返
- **WHEN** 样例读入、写出再读入
- **THEN** 数据与扩展值相等

### Requirement: CLI 校验显式配对
CLI SHALL 校验角色表和一个或多个标注正文路径对；成功向 stdout 输出，IO、解析或业务失败向 stderr 诊断并返回非零，输入不变。

#### Scenario: 摘要不符
- **WHEN** 正文不匹配标注
- **THEN** CLI 失败，不输出成功或修改输入

#### Scenario: 配对数量不同
- **WHEN** 标注和正文路径数量不同
- **THEN** 返回明确配对错误

### Requirement: 库示例独立运行
系统 SHALL 提供 Rust 示例，无需 CLI、模型凭据或外部应用即可读取已校验标注。

#### Scenario: 离线库示例
- **WHEN** 示例使用公开样例运行
- **THEN** 输出原文片段与归属，不联系模型
