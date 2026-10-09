# 增量交付人工示例

正文为允许公开分发的原创三句。`first-batch.json` 是 `consume_incremental` 使用离线替身生成的首个批次，只有第一个范围，不是完整章节、正式提交或真实模型结果。

运行 `cargo run -p castglean-core --example consume_incremental` 可看到连续三批的确认及最终成功。可显式提供一个不存在的文件路径保存首批 JSON：`cargo run -p castglean-core --example consume_incremental -- <path>`；已有文件不覆盖。示例采用容量 1 的通道和宿主原子接受后的确认，未生成音频。

完整契约见 [增量交接](../../docs/incremental-delivery.md)，包括回调未确认的副作用、运行隔离及失败不能 seal。
