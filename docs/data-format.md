# 工程与离线数据格式草案

> 2026-11-02 重启备注：本文为重启前实现的格式草案，作为新应用数据格式设计的参考保留；文中实现与 Schema 位于 `legacy-main` 分支。

## 桌面工程文件 v1

当前 `src-tauri/src/project.rs` 实现的可移植 `.castglean` 文件是独立的新工程容器，不是下文 legacy 标注格式。UTF-8 JSON 使用 camelCase 字段：

```json
{
  "format": "castglean-project",
  "formatVersion": 1,
  "project": {
    "id": "稳定工程 ID",
    "title": "工程标题",
    "description": "可为空的备注",
    "chapters": [
      {
        "id": "稳定章节 ID",
        "title": "显示标题",
        "filename": "来源文件名.txt",
        "source": "精确的原始 UTF-8 文本",
        "sourceSha256": "原文字节的 SHA-256 小写十六进制"
      }
    ]
  }
}
```

章节数组即制作顺序。标题和来源文件名不参与原文摘要；ID 不解释为路径。保留原文 BOM、CRLF、CR 和其他空白，**不使用下文 legacy 的换行规范化规则**。文件嵌入原文，不依赖原始 TXT 路径；移动工程后仍可恢复正文。摘要检查完整性，不能证明作者身份或抵抗同时修改正文与摘要的行为。未保存角色、标注、音频或凭据。

所有层级拒绝未知字段，拒绝未知格式/版本、空章节、重复章节 ID、空标题、NUL、摘要不匹配及无效 UTF-8。工程标题最多 80 码点、备注 500、章节标题 120、文件名 255、ID 128；最多 50 章，每章 5 MiB、合计 20 MiB，容器输入最多 128 MiB（容纳 JSON 转义）。工程 ID `sample` 保留给设计示例。未来扩展需显式格式演进。

桌面保存由 Rust 命令选择路径并校验，在目标同目录写临时文件，flush + sync_all 成功后原子替换目标；失败清理临时文件，不覆盖旧工程。此处未承诺断电后的目录项持久性，也未实现自动备份/恢复日志。文件选择取消返回空值；打开失败保留现有 UI 工程。宿主不接受前端任意路径。浏览器仅提供同格式下载/选择打开的便携预览，不在 localStorage 保存正文，不把下载触发视为确认落盘。

覆盖精确原文及章节顺序往返、损坏摘要、未知字段/版本、重复 ID、超限、格式错误和注入写入失败保留旧文件的 Rust 测试。系统文件对话框需额外进行桌面应用验收。

## 引擎设置 engine.json v1

`src-tauri/src/engine/config.rs` 实现的引擎设置文件保存在应用配置目录（`engine.json`），UTF-8 JSON、snake_case 字段：

```json
{
  "version": 1,
  "settings": {
    "cache_dir": null,
    "download_endpoint": null,
    "download_token": null
  }
}
```

`settings` 三字段均可空：`cache_dir` 为空使用共享 Hugging Face 缓存（`~/.cache/huggingface/hub`，与其他 Hub 工具字节级复用），非空时必须是绝对路径；`download_endpoint` 为空使用官方端点，可填镜像（必须是 http(s) URL）；`download_token` 为可选 Hub 访问凭据，仅存本机应用配置目录，不入 Git。保存走同目录临时文件原子替换；版本不匹配或解析失败按默认值处理，下次保存覆盖。设置只对后续下载生效，不迁移已下载文件。引擎消费布局位于当前缓存目录的 `castglean/` 子目录，盘点随缓存目录切换；下载进行中需先完成或取消才能更改目录。

## Legacy 离线标注参考

多角色宿主如何消费完整已校验结果、处理未知/歧义及修订失效，见 [整章交接](chapter-consumption.md)。

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

人物和声音画像证据含 chapter_id / segment_id；归属证据只引用当前章。所有引用必须在提供的集合中存在，缺少引用章会报错；库不会自动访问目录或外部文件。增量书级快照与身份获知边界已在 BookState 实现，见 [跨章文档](archive/design/cross-chapter.md)；旧 validate_book 仍仅提供闭集结构校验，不推断章节顺序语义。

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

可选 [增量章节交接](archive/design/incremental-delivery.md)输出只读 `AcceptedPrefixBatch`，其 JSON 形状由 `accepted-prefix.schema.json` 描述。批次范围引用同一完整快照，不是完整章节 DTO 或正式提交；只有分析最终成功返回，宿主才可封闭全文。
