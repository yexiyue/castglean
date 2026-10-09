# Proposal

## Why

TaleChime 已提供同模型多音色朗读计划，CastGlean 需要明确宿主如何从完整校验结果取得不可变正文、稳定身份与连续分区。现有 API 已具备基础能力，但缺少完整的多角色消费示例与修订失效契约。

## What Changes

- 明确整章消费的正文身份、UTF-8 坐标、角色修订、表达类型与归属状态契约。
- 增加无需 CLI、模型凭据或 TTS 的宿主示例及公开多角色夹具。
- 验证同名人物、第一人称旁白、未知/歧义、Unicode/空白/空章及修正后的新交接上下文。
- 复用现有只读 API，不新增音色字段、播放依赖或增量发布接口。

## Capabilities

### New Capabilities

- `chapter-consumption`: 完整已校验章节的只读宿主消费及修订失效边界。

### Modified Capabilities

无。

## Impact

影响 core 的 rustdoc、独立示例和测试，以及公开夹具和使用文档；不改变分析接受条件、持久化格式、Schema、提示词或运行指纹。对应 CastGlean #1 的整章交接部分；增量交付、画像选角、实际 TaleChime/TRNovel 集成和阶段 D 发布验收仍单独推进。
