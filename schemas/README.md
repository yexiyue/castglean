# 草案 JSON Schema

`characters.schema.json` 和 `annotations.schema.json` 从 Rust DTO 生成，使用 JSON Schema 2020-12，协议仍为草案。字段、枚举和部分局部约束可以检查；正文摘要、覆盖、修订和跨文件引用必须另经应用校验。

从仓库根目录重新生成：

```bash
cargo run -p castglean-core --example export_schema -- schemas
```

测试检查生成值与已提交文件一致，并离线检查公开样例和结构错误。`examples/invalid/gap.annotations.json` 故意展示 Schema 接受、应用拒绝的范围缺口。

`book.schema.json` 和 `corrections.schema.json` 分别描述新的聚合快照及人工批次，仍为草案。书级正文、知识边界、修订、人工标记及批次原子性须由 BookState 校验，不能只依据 Schema。

`run-plan.schema.json` 描述显式冻结运行计划，示例为 `examples/run-recovery/glm-plan.json`。Schema 不验证源摘要、计划指纹、重复章节、基础修订及提交链；这些由 BookRun 检查。用法见 [章节级恢复](../docs/run-recovery.md)。

`analysis-failure.schema.json` 描述版本 1 安全失败诊断，只读报告不作为提交或恢复状态。

`accepted-prefix.schema.json` 描述版本 1 增量分析批次，公开样例为 `examples/incremental-delivery/first-batch.json`。它包含角色、归属和证据，属于私有分析产物；不能当成脱敏失败报告。Schema 只验证形状，不能把任意 JSON 转成受信任前缀，也不表示正式提交或持久化恢复位置。见 [增量章节交接](../docs/incremental-delivery.md)。
