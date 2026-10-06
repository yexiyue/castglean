# 提案

## Why

CastGlean 目前只有工程骨架和人工 JSON 示例，缺少可复用的数据接口与校验。阶段 A 建立离线数据边界，让后续模型建议必须通过原文完整性和引用校验。

## What Changes

- 增加不可变正文快照、换行规范化及导入前后 SHA-256 摘要。
- 增加独立 ID、草案 DTO、已校验字节范围与只读书籍结果。
- 校验版本、原文覆盖、Unicode 边界、身份、修订与跨章证据。
- 提供 JSON 流读写、生成的 Schema、三个公开短场景及无效样例。
- 提供通用 Rust 库示例和复用同一校验器的 CLI validate。
- 不实现模型、自动切片、持久化事务、修正引擎或 TRNovel 集成；v1 仍为草案。

## Capabilities

### New Capabilities

- `source-snapshots`：不可变规范化正文、摘要与已校验字节范围。
- `annotation-validation`：草案领域类型、覆盖、归属、证据校验与只读结果。
- `offline-interface`：JSON、Schema 及独立 CLI 与库入口。

### Modified Capabilities

无。

## Impact

修改 core、CLI、workspace 依赖、样例、Schema 与文档。引入 serde、serde_json、sha2、thiserror、schemars；Schema 校验器仅用于测试。不调用网络模型，不修改外部仓库。
