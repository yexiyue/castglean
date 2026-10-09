# 离线数据格式草案

阶段 A 使用 `format_version: 1` 的草案格式，尚未冻结对外协议。角色表和章节标注可通过 Rust DTO 构造或 JSON 解析；两者均为未校验输入，必须经 `validate_book` 才能作为已校验结果使用。校验证明结构与原文一致，不证明人物归属的语义真实性。

## 正文与坐标

`SourceSnapshot::import` 接收 UTF-8 字符串，将 CRLF、独立 CR 转为 LF，保留其他 Unicode、空白和 BOM 内容。元数据记录规范化版本 1、`offset_unit: utf8_byte`、原始 `import_sha256` 与规范化 `sha256`，摘要使用小写十六进制。库不混入章节标题。

`SourceSnapshot::from_saved` 接收已经保存的快照及元数据，检查规范化规则和快照摘要，不重新规范化。没有原始输入时，导入摘要只能检查语法，不能重新验证其来源。调用方应在导入阶段保存原始摘要；坐标与归属始终绑定规范化快照。

仓库 `.gitattributes` 禁止 Git 改写公开正文快照的换行，以免 Windows/Linux checkout 改变摘要。输入文件的编码必须为 UTF-8；CLI 对无效 UTF-8 报读取错误。

`ByteRange` 是非空、左闭右开的 UTF-8 字节范围，必须位于正文内且在字符边界。组合字符可以含多个 Unicode 字符，边界检查不是视觉字素簇检查。范围本身不识别正文版本，跨快照切片再次检查边界；章节元数据另外检查正文绑定。

## 角色与归属

`BookId`、`ChapterId`、`CharacterId`、`SegmentId` 是不同类型的非空白字符串，不解释为数组下标、路径或排序。角色显示名及别名不要求跨人物唯一，重复角色 ID 则拒绝。角色表 `revision` 必须为正，章节 `character_revision` 必须匹配。

表达类型为 `narration`、`speech`、`thought`、`quoted_text`。speech 和 thought 必须带归属；其他类型可省略，已知第一人称叙述者也可带确定身份。归属以 `status` 区分：

| 状态 | 字段约束 |
| --- | --- |
| resolved | 一个现有 `character_id` |
| ambiguous | 至少两个不同且现有的 `candidate_ids` |
| unknown | 不含确定角色或候选字段 |

三种状态均含当前章的 `evidence_segment_ids` 和独立的 `review_status`（unreviewed / confirmed）；resolved 不代表人工确认。引述或旁白省略归属不等同于给未知发言者分配旁白身份。

可选 `voice_profile` 保留草案中的 gender、age_band、impressions、evidence，不包含后端音色参数。属性可省略或为 unknown，非未知属性和印象要求证据。阶段 A 的证据集合支持画像整体的结构引用校验，逐属性证据和取值词表留待后续协议细化。

## 完整校验集合

`validate_book` 消费一个角色表及全部显式提供的章节/快照配对。每章片段必须按序完整覆盖正文，不能遗漏空白、重叠或切入字符编码；空章必须没有片段。章节和章内片段 ID 唯一。

人物和声音画像证据含 chapter_id / segment_id；归属证据只引用当前章。所有引用必须在提供的集合中存在，缺少引用章会报错；库不会自动访问目录或外部文件。增量书级快照与身份获知边界已在 BookState 实现，见 [跨章文档](cross-chapter.md)；旧 validate_book 仍仅提供闭集结构校验，不推断章节顺序语义。

返回 `ValidatedBook` / `ValidatedChapter` 持有数据并只读访问，`segments()` 输出每个片段及精确正文切片。修改 DTO 克隆后必须重新校验。朗读片段当前仅表达完整分区；跨范围或嵌套语义台词层后续独立设计。

## JSON 与扩展

核心结构拒绝未知字段。角色表、人物、章节、片段提供可选 `extensions` 对象，扩展值参与 JSON 往返；不要把拼错的核心字段当作扩展。未知格式或规范化版本被拒绝。

Schema 检查 JSON 结构，不能替代摘要、范围、覆盖、修订和引用校验。JSON 读取成功仅得到 DTO，不授予“已校验”状态。读写助手及 Schema 生成入口随离线接口提供，生成文件放在 `schemas/`。

## 使用已实现的离线入口

从仓库根目录运行（示例均为公开人工标注）：

```bash
cargo run -- validate --characters examples/minimal/characters.json --annotations examples/minimal/chapter.annotations.json --source examples/minimal/chapter.txt
cargo run -p castglean-core --example validate_sample
cargo run -p castglean-core --example export_schema -- schemas
```

CLI 成功返回 0 并向 stdout 输出书籍及数量；文件读取、JSON 或业务校验失败返回非零并向 stderr 输出诊断，不修改输入。`--annotations`、`--source` 可以重复，按各自出现顺序配对，数量必须相等；同一批必须属于同书、同角色修订且提供全部引用证据。例如：

```bash
castglean validate --characters characters.json --annotations ch-001.annotations.json --source ch-001.txt --annotations ch-002.annotations.json --source ch-002.txt
```

上面的多章路径是使用方式示意，需替换为自己的已规范化快照。CLI 不隐式规范化或重算旧标注。

Rust 使用方通过 `read_json` 读取 DTO，或直接构造 DTO；正文可由 `SourceSnapshot::import` 创建。准备 `ChapterInput` 配对，调用 `validate_book`，从只读章节的 `segments()` 获得标注和精确文本。`write_json` 输出调用方提供的数据到指定流，不自动提交、缓存或选择路径。
