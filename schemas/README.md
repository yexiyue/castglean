# 草案 JSON Schema

`characters.schema.json` 和 `annotations.schema.json` 从 Rust DTO 生成，使用 JSON Schema 2020-12，协议仍为草案。字段、枚举和部分局部约束可以检查；正文摘要、覆盖、修订和跨文件引用必须另经应用校验。

从仓库根目录重新生成：

```bash
cargo run -p castglean-core --example export_schema -- schemas
```

测试检查生成值与已提交文件一致，并离线检查公开样例和结构错误。`examples/invalid/gap.annotations.json` 故意展示 Schema 接受、应用拒绝的范围缺口。
