# 增量章节标注交接

新增 `analyze_chapter_incremental` 与 `BookState::analyze_incremental`，通过宿主实现的 `AnalysisConsumer` 交付稳定连续前缀。它们与整章入口共享模型请求、有限修复、完整覆盖校验、角色 ID 分配及人工确认保护；普通入口不调用 consumer，CLI/BookRun 仍只持久化完整章节。

## 宿主先提供的上下文

分析前导入整章 `SourceSnapshot`，阅读/朗读与分析使用同一规范化正文。consumer 必须同时拥有这个完整快照，以及分析输入的已校验书籍上下文；批次证据可以引用前批或前章，不另发私人正文副本。

每次尝试提供一个新的非空 `execution_key`，其作用域包括宿主实际模型/配置与本次执行。库将它和 book/chapter/source 元数据、完整输入注册表/标注、分析选项绑定为 `AnalysisRunId`。库不能从 `AnalysisModel` 自动查询厂商配置，宿主负责键的新鲜性及模型范围。重试、修正或替换执行使用新键；在自己的执行边界检查运行 ID，不接收旧执行的迟到范围。

## 接受批次

`AcceptedPrefixBatch` 是只读拥有所有权的类型，只能由库校验流程生成；可序列化但不能反序列化为受信任类型。包含格式版本 1、运行摘要、从 1 开始的连续序号、book/chapter/source 身份、输入 `base_revision`、新增片段及已接受前缀所需的角色定义。`accepted_prefix_schema()` 只描述 JSON 形状，不能替代运行身份、覆盖和原文检查。

每批范围从前一批终点继续，片段非空、UTF-8 字节边界合法且连续。角色定义随批提供，允许同名不同 ID；重复提供同一身份的定义不会改变已发布归属。unknown/ambiguous、第一人称旁白和引用文本保持原有语义，具体音色仍由宿主显式策略决定。基础修订与运行内序号独立，最终整书结果可能有新的正式修订。

应用先校验完整窗口，修复成功后才 apply，再恢复人工确认，最后考虑交付。非法候选、模型原始响应和内部修复过程不会外发。若待交付前缀的归属证据、角色证据或画像证据指向尚未接受的本章片段，则暂缓整个待交付前缀；直到证据闭合才发出。前章证据从已提供上下文解析。因而不承诺每窗立即发布，有时可能等到整章。后文分析只能添加新的范围和身份，不能改写已发布归属。

## 背压、取消与确认

`AnalysisConsumer::accept(&mut self, batch)` 返回 `Send` future，宿主原子接受后返回 `Ok(())`；关闭/拒绝返回 `DeliveryError::Closed/Rejected`，立即停止后续模型请求。库不创建内部队列、后台任务或 runtime。宿主可使用有界通道和确认消息，生产与消费须并行推进。

消费等待响应取消和同一个章节截止，不绕过请求预算；成功和失败耗时包含等待时间。`DeliveryProgress` 分别报告：

| 字段 | 含义 |
| --- | --- |
| run_id | 已建立的运行身份，准备阶段早期失败时可能为空 |
| confirmed_batches / confirmed_end | 回调成功返回的批数与字节终点，是宿主可能已接收范围的下界 |
| offered_end | 回调已启动但未确认的终点；正常成功后为空 |

future 被取消不代表其先前副作用被撤回。回调可能先入队/执行，再等待确认；取消、超时或拒绝时 `offered_end` 可超过确认终点。宿主应显式停止/使旧执行失效，不能只凭 confirmed_end 断言后续从未播放。听书恢复仍以实际播放进度为准，生成或分析交付进度不等同于播放进度。

## 完整成功与失败

只有调用返回 `Ok(IncrementalResult)` 才说明最终完整校验及书级操作成功，宿主此时才可 seal 自己的声音计划；批次通道暂时无消息或关闭不表示成功。空章不发空范围批次，最终校验成功后正常返回。

失败返回 `IncrementalFailure`，保留原类型化错误、`diagnostics()`、`stats()` 和 `delivery()`。消费错误通过新增 `AnalysisError::Delivery` 表达；它不会出现在普通整章调用中。已经交付全文也可能最终校验失败，不能据此 seal；宿主需走失败输入/停止通路，整章暂存模式不得播放部分产物。原书状态与章节正式提交边界保持不变。

已有安全失败报告 Schema 保持原状：`accepted_windows` 仍指私有接受数；增量确认信息从单独的 delivery 取得，不混成持久化或播放凭证。consumer 错误只保留两个安全类别，不记录任意宿主错误字符串。批次本身包含私有角色、归属与证据，宿主按私有分析产物保存，不能当成脱敏失败报告。

## 示例与验收

```bash
cargo run -p castglean-core --example consume_incremental
cargo test -p castglean-core --test delivery --locked
```

示例用离线替身和容量 1 的确认通道演示 A/B/A、源摘要/序号/连续性检查和最终成功；没有模型调用或 TTS。公开 [首批 JSON](../examples/incremental-delivery/first-batch.json) 是该替身生成的人工样例。

回归覆盖完整与增量结果一致、Unicode/空白/空章、同名稳定 ID、后文证据延迟、未知/歧义和第一人称旁白、原文引文、修复不外发、消费拒绝、慢消费取消/截止、迟到响应、确认后取消、最终校验失败、书级冲突与人工保护。

首版没有前缀落盘、跨崩溃恢复消费游标或自动重新提交旧 ExecutionId。需要可靠持久化的宿主继续在完整章节提交后交付，或自行设计并验证发布游标；不宣称外部请求或宿主副作用恰好一次。实际 TaleChime/TRNovel 联调、听感和性能未验收，阶段 D 发布冻结仍未完成。

2026-10-09 本地 Windows 验收：新增 14 项增量测试及 1 项公开批次 Schema/正文绑定测试，workspace 共 159 项 Rust 测试、46 项 Python 测试与 2 项 doctest 通过；fmt、Clippy `-D warnings`、rustdoc `-D warnings`、Schema 同步及 14 项 OpenSpec 严格校验通过。有界确认示例已实际运行，按 A/B/A 交付三个连续批次后才报告完整成功。本轮没有线上模型调用或音频生成。
