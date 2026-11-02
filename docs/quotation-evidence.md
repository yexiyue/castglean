# 可验证的原文引文证据

引文模式是单章固定流程的可选接受条件。默认仍使用片段 ID 证据和版本 7 提示词；启用引文模式使用版本 8 提示词。两者均按窗口顺序执行，使用相同的请求、时间、大小与有限修复预算。

```bash
castglean analyze --backend local --source chapter.txt --book demo --chapter ch-001 --output output/demo --evidence-mode verified-quotes
```

库调用在 `AnalysisOptions` 中设置 `evidence_mode: EvidenceMode::VerifiedQuotes`。默认值是 `EvidenceMode::SegmentIds`。`AnalysisModel::generate` 方法不变，`ModelRequest` 增加显式的 `evidence_mode`，适配器据此选择 Schema；手工构造该草案请求时须补充字段。`CharacterSuggestion` 和 `SuggestedAttribution` 的 Rust 结构也增加 `evidence_quotes`，旧的结构体字面量需补充空数组；旧 JSON 可继续省略该字段。`analysis_suggestion_schema()` 保留旧 Schema，`analysis_suggestion_schema_for(mode)` 返回相应模式的 Schema。

## 建议与校验

新角色、`resolved` 和 `ambiguous` 归属在引文模式下必须提交非空 `evidence_quotes`，原有 `evidence_segment_ids` 同时保留。例如：

```json
{
  "evidence_segment_ids": ["seg-001"],
  "evidence_quotes": [{"segment_id": "seg-001", "quote": "张三说"}]
}
```

`unknown` 无须引文，仍是一次可接受的完整结果。引用书名的文本仍按表达类型处理，不因为能匹配原文就建成人物。默认模式也会核对主动提交的引文，不保存未经检查的引文数据。

程序只在指定的可见片段内定位；该片段还必须在同一对象的证据 ID 列表中。采用精确原文匹配，不进行繁简转换、空白清理、标点修正或模糊检索。引文最多 256 个 Unicode 标量，每个对象最多八条，纯空白、重复条目以及零次或多次出现均拒绝；重叠匹配也算多次出现。存在多个相同称呼时，可以提交包含动作或位置的较长连续原文，不能让程序猜其中一个位置。

程序生成 UTF-8 字节范围，模型不计算坐标。缺失及错误引文沿用有限修复入口，反馈使用固定错误码及程序生成的位置，不把被拒引文写入错误消息。候选未通过时，不应用其人物或片段；最终失败、取消或预算耗尽不发布输出目录。认证、服务错误、超时、截断和整体响应大小限制仍直接停止。

## 保存的证据

原正文、角色表、归属状态及格式版本保持不变。已接受引文保存到角色或目标片段的 `extensions["castglean.quotation_evidence"]`：

```json
{
  "version": 1,
  "quotes": [{
    "chapter_id": "ch-001",
    "source_sha256": "程序计算的原文摘要",
    "segment_id": "seg-001",
    "start": 0,
    "end": 9,
    "quote": "张三说"
  }]
}
```

该键是保留的受检扩展。完整 `validate_book` 和 CLI `validate` 会重新检查版本、引用关系、来源摘要、UTF-8 边界、精确文字及唯一位置；没有扩展的旧文档仍有效。其他应用扩展继续保持原有行为。重新分段或修改证据引用时，需要重新生成相应引文坐标并校验。

原文引文可以证明引用文字真实存在，却不能证明它支持人物身份或归属。例如把张三的提示语引用给李四，仍可能通过来源校验。此模式也没有要求程序判断别名等价、代词共指或每个候选的语义依据。语义收益以独立评测为准，真实小说组与原创开发/留出组分别报告；实测记录见 [引文对照](quotation-evaluation.md)。

模型请求内引用使用短名，最终扩展仍保存正式 ID，参见 [窗口内短引用](compact-window-references.md)。
