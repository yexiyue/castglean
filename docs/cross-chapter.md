# 跨章状态与人工修正

核心库提供 `BookState`，持有有序且整体校验的正文、角色与章节。`document()` 输出 `BookDocument`，`from_document()` 重新核对来源、引用、获知边界和修订；没有隐式文件 IO。章节 ID 是不透明身份，实际章节顺序来自数组。

`BookState::analyze` 接受 `BookAnalysisInput`：chapter_id、source、expected_revision、mode。Append 分析新章，ReanalyzeLast 只重跑最后一章，必须正文和全部切片相同。模型看到当前已提交前缀的角色；程序不按同名合并。`known_at` 由人物最早证据派生，`candidates(label, through)` 返回边界内多候选，人工别名查询也受其证据章节限制。模型是否复用了正确身份仍是语义问题。

每次成功操作共同修订递增一次，旧标注同步引用新修订，正文、身份与字节范围保持。操作返回新状态，不修改原状态。预期修订冲突及溢出在模型调用前拒绝。聚合文档的 changes 记录动作；从旧的 ValidatedBook 导入可没有历史，记录不是签名审计日志，无法证明编辑文件者的真实意图。

人工输入 `CorrectionBatch` 包含 book_id、expected_revision、corrections。归属修正必须给 chapter_id、source_sha256、segment_id、expression_kind、attribution；程序将归属标为 confirmed，且标记整个片段。unknown 和没有归属的非对白也可确认。该片段旧模型引文被移除，其他扩展保留。别名操作替换完整 aliases，所供 evidence 片段必须包含每个非空别名，空数组可清除别名；不改 display_name 或 CharacterId。整批整体校验失败时，先前成功项也不生效。

末章重分析继续使用同一窗口生成与校验流程，随后保留所有已确认片段和人物；未确认片段可更新。现有人物不会自动删除。换正文、换切片、重跑更早章节、身份合并与撤销暂不支持。完整快照随书增长，分文件事务、活动指针和跨运行缓存后置；独立的 [BookRun 章节恢复](run-recovery.md) 已提供运行内锁与完整提交链。

运行离线两章示例，不调用服务：

```powershell
cargo run -p castglean-core --example book_offline
```

[原创两章](../examples/cross-chapter/README.md)展示追加复用与人工 unknown。原单章 analyze_chapter 和单章 JSON 格式保留；历史文件导入书状态须提供证据闭集与明确顺序，人物须有非空有效证据锚点。


## CLI 最小闭环

```powershell
cargo run -p castglean-cli -- analyze --backend glm --book demo --chapter first --source examples/cross-chapter/chapter-1.txt --output runs/demo/first
cargo run -p castglean-cli -- analyze --backend glm --book demo --chapter second --source examples/cross-chapter/chapter-2.txt --book-file runs/demo/first/book.json --expected-revision 1 --output runs/demo/second
cargo run -p castglean-cli -- inspect --book-file runs/demo/second/book.json --label 张三 --through second
cargo run -p castglean-cli -- validate --book-file runs/demo/second/book.json
cargo run -p castglean-cli -- correct --book-file runs/demo/second/book.json --corrections runs/demo/corrections.json --output runs/demo/corrected
cargo run -p castglean-cli -- analyze --backend glm --book demo --chapter second --source examples/cross-chapter/chapter-2.txt --book-file runs/demo/corrected/book.json --expected-revision 3 --reanalyze-last --output runs/demo/reanalyzed
```

以上各次输出目录须不存在。第二章若成功，修订为 2；以修订 2 的批次修正成功后为 3，再重分析成功为 4。失败不推进修订。首章沿用原单章调用，额外输出 book.json，不改变现有正文、角色表、标注和统计格式。以后 book.json 是整书权威快照，旁边 chapter.* 只是本次章节导出；不能用最新角色表和单个章节导出来替代整书闭集校验。correct 仅发布完整 book.json；inspect 展示身份、章节元数据和片段引用，不展示正文。

人工文件例子（使用 inspect 输出替换正文摘要与正式片段 ID）：

```json
{
  "book_id": "demo",
  "expected_revision": 2,
  "corrections": [
    {
      "kind": "attribution",
      "chapter_id": "second",
      "source_sha256": "替换为实际正文摘要",
      "segment_id": "替换为实际片段ID",
      "expression_kind": "speech",
      "attribution": {
        "status": "unknown",
        "evidence_segment_ids": [],
        "review_status": "unreviewed"
      }
    }
  ]
}
```

修正文件由人明确指定；不会自动发布模型猜测为人工确认。运行中的凭据、全文和输出保存在忽略目录。预期修订不替代多进程锁；从同一旧快照可以创建不同分支，调用者负责单书串行和选择后续快照。普通 analyze/correct 仍是一次性发布；需恢复时使用 BookRun。其锁仅作用于同一运行，跨运行缓存和通用多文件事务仍未实现。


```mermaid
flowchart LR
    S[只读书级快照] --> R[预期修订检查]
    R --> A[追加 / 末章重分析 / 人工修正]
    A --> V[正文、引用、确认与获知边界校验]
    V --> N[完整新状态]
    N --> P[CLI 临时目录写入]
    P --> F[发布到新快照目录]
```

首批离线测试覆盖同名多候选、未来证据与身份、来源/切片变更、修订溢出与冲突、整批回滚，以及 resolved/ambiguous/unknown/非对白的人为确认保护。[有限线上验证](cross-chapter-verification.md)仅检查两章流程，不代表真实长篇质量。

验收：workspace 114 个测试、两个 rustdoc 示例、35 个 Python 测试通过；fmt、Clippy、rustdoc、聚合/修正 Schema 一致性及九个 OpenSpec change 严格校验通过。Windows 页面文件限制下使用串行 cargo 构建，不修改服务或模型预算。
