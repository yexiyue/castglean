# 整章多角色标注交接

CastGlean 已能通过现有只读 API 交付完整章节的正文、连续分区和稳定角色身份。本轮补齐消费契约、公开人工夹具和独立示例，没有新增播放 API。对应 [CastGlean #1](https://github.com/yexiyue/castglean/issues/1) 的整章部分；可选增量入口另见 [增量章节交接](incremental-delivery.md)。

## 取得同一正文与完整结果

宿主可先调用 `SourceSnapshot::import`，取得规范化正文和元数据，再将这个快照传给分析。CRLF/独立 CR 转为 LF，其余 Unicode 与空白保持。阅读、高亮和朗读都应使用 `source.text()`，坐标针对该规范化快照，不能套回原始文件。`sha256` 是快照正文摘要；`import_sha256` 记录导入前字节，不用于保存正文的范围身份。

消费入口可来自成功的 `analyze_chapter`/详细入口、`BookState::analyze`，或重新校验保存数据后的 `validate_book`/`BookState::from_document`。JSON 解析成功只得到 DTO；不得直接作为已校验结果使用。跨章证据要求提供完整引用集合，不能只取一个章节的 JSON 再忽略缺失的前章证据。

| 现有 API | 消费内容 |
| --- | --- |
| `ValidatedBook::registry()` | 同一本书的稳定 ID、显示名、别名、共同修订和角色证据 |
| `ValidatedBook::chapters()` | 按调用方提供的顺序排列的完整已校验章节 |
| `ValidatedChapter::source()` | 不可变规范化正文、摘要和坐标单位 |
| `ValidatedChapter::annotations()` | book_id、chapter_id、character_revision、表达类型和归属 |
| `ValidatedChapter::segments()` | 按原文顺序返回 `(&Segment, &str)`；范围完整不重不漏 |

逐个消费 `segments()` 即可重建原文，包括空白。空章返回零个片段，仍有正文摘要和修订；不得凭空生成一个空范围。UTF-8 字节边界不等于视觉字素簇边界，宿主不应把范围当成字符或音频帧序号。

## 宿主选角与语义状态

`CharacterId` 只在书籍上下文中使用，不能用显示名作为键。同名可以对应多个 ID；后章复用身份时沿用该 ID。宿主保存 `(book_id, character_id)` 到当前 backend/model 音色的绑定，声音配置与执行版本由宿主管理。

| 标注 | 宿主处理依据 |
| --- | --- |
| resolved | 用稳定 ID 查当前固定声音配置；未绑定时使用宿主显式默认策略 |
| ambiguous | 保留全部候选 ID，使用显式歧义策略，不自动挑第一人 |
| unknown | 保留未知归属，使用显式未知策略；它仍可为 speech/thought |
| 无归属 narration | 使用宿主旁白策略，不创建虚构旁白角色 |
| 有 resolved 归属的 narration | 可为第一人称旁白，仍保留明确角色身份 |
| 无归属 quoted_text | 使用宿主引述策略，不自动视为人物发言 |

表达功能与人物身份是独立维度，应先检查归属，再决定表达功能如何影响声音安排。resolved 不等于人工 confirmed，也不证明语义准确。合法 unknown/ambiguous 不触发分析重试。具体不存在或不受支持的音色如何拒绝，由声音执行方负责；这里的默认策略不能掩盖音色错误。

可选 `voice_profile` 仅是有证据的语义描述；当前分析尚不生成画像，也不能根据姓名猜性别或声线。它不包含 backend/model/voice ID。画像推荐与音色设计属于 [后续 #2](https://github.com/yexiyue/castglean/issues/2)。

## 修订与执行失效

宿主交接上下文至少包含 `book_id`、`chapter_id`、规范化 `source.sha256`、共同 `character_revision`，并加上宿主声音配置修订和执行身份。这是宿主比较的字段组合，不是新增核心 DTO，也不代表单一 SHA 的永久协议。

人工归属/别名修正、重分析和后续章节提交都会推进共同修订。按保守策略重新获取完整已校验状态、构造新的声音计划；已经运行的旧执行应由宿主显式停止或替换，隔离旧事件与预取。正文变化则必须重新取得相应快照及标注，原坐标不能继续套用。已有人工确认继续由修正和重分析工作流保护。

旧 `ValidatedBook`/`BookState` 是不可变快照，修正返回新状态，不会原地改写旧对象；旧对象本身也不会得知有新修订。宿主启动或替换执行前须比较当前状态，不能把“旧结果仍结构有效”当成“当前结果”。角色表和章节需来自同一完整状态；不混用不同修订的 JSON。

## 整章失败与增量边界

整章入口只在最终完整校验成功后返回结果，失败或取消不会交付当前章完整结果。失败诊断中的 `accepted_windows` 是私有候选数，不是已提交朗读范围或可恢复播放位置；宿主不能据此补齐旁白或 seal 全文。前章正式提交可继续读取，当前失败章由宿主决定停止或显式重试。

可选增量入口遵循独立的稳定前缀交付契约：新身份先可解析、证据可交付、取消与背压有界、部分成功后的失败明确、已发布范围不隐式修改。本页示例保持整章成功后消费；实际播放联调仍需单独验证。

当前 `segments()` 是唯一完整朗读分区；证据只是引用，不能另读一遍。未来跨范围或嵌套语义标注需作为语义层消费，不直接追加为第二组朗读范围。TTS 后端可在同一声音范围内再次分段，须保留原文映射并遵守声音边界；语义片段与模型合成段并不等同。

## 可运行的独立示例

```bash
cargo run -p castglean-core --example consume_chapter
cargo run -- validate --characters examples/chapter-consumption/characters.json --annotations examples/chapter-consumption/chapter.annotations.json --source examples/chapter-consumption/chapter.txt
cargo test -p castglean-core --test consumption --locked
```

[公开人工夹具](../examples/chapter-consumption/README.md)演示同名不同 ID 的 A/B/A、第一人称旁白、未知/歧义、心理活动与引述，以及 emoji、组合字符和纯空白。示例中的 `Casting` 是本地宿主策略，打印按范围的安排并重建正文，不调用模型或 TTS。消费测试验证人工修正后的新修订、旧对象保持，以及错误摘要、范围、覆盖、证据和角色引用的拒绝。

本轮验收只证明整章结构消费与失效契约；增量离线验收另见其交接文档。实际多音色听感、性能和 TaleChime/TRNovel 联调未验收，阶段 D 发布冻结仍未完成。

2026-10-09 本地 Windows 验收：新增 4 项消费测试，workspace 共 144 项 Rust 测试、46 项 Python 测试和 2 项 doctest 通过；fmt、Clippy `-D warnings`、rustdoc `-D warnings`、Schema 同步及 13 项 OpenSpec 严格校验通过。示例和上面的 CLI 校验命令已实际运行。没有新增线上模型调用或音频生成。
