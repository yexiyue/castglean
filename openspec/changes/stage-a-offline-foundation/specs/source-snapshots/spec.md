## Purpose

为离线标注提供不可变 UTF-8 正文、摘要及经过检查的字节坐标，使独立使用方能够读取与标注明确绑定的原文，并在正文版本改变时拒绝旧范围。

## ADDED Requirements

### Requirement: 导入时保留规范化原文
库 SHALL 将 CRLF 和独立 CR 转为 LF，保留其他内容，记录原始及规范化正文 SHA-256 摘要和规范化版本 1。

#### Scenario: Unicode 与混合换行
- **WHEN** 输入包含中文、emoji、组合字符、空白和混合换行
- **THEN** 只有换行改变，两种摘要分别匹配对应字节

### Requirement: 保存后的正文不被重新解释
库 SHALL 拒绝摘要不符、摘要语法错误、规范化版本不支持或正文不符合规范化的快照。

#### Scenario: 正文改变或版本不支持
- **WHEN** 正文改变或使用不支持的规范化版本
- **THEN** 读取失败，不迁移位置

### Requirement: 范围符合 UTF-8 边界
库 SHALL 仅接受非空、左闭右开、正文内且端点位于 Unicode 字符边界的字节范围。

#### Scenario: 范围切入 emoji
- **WHEN** 端点落在 emoji 编码中间
- **THEN** 校验返回错误而不是 panic
