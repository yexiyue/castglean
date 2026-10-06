# 离线人工样例

所有正文均为本项目自编短场景，随仓库按 MIT 提供，不是模型输出。草案格式尚未冻结。

| 场景 | 重点 |
| --- | --- |
| `minimal/` | 明确说话人、归属证据和未知声音画像 |
| `ambiguous/` | 同名与同别名、两个候选、未知发言、空白完整覆盖 |
| `quoted/` | 第一人称旁白、非对话引号、心理活动、emoji 与末尾换行 |

每个场景包含 characters.json、chapter.annotations.json 和规范化 chapter.txt。运行库示例或 CLI 可校验它们；不要修改正文后沿用旧摘要和坐标。

从仓库根目录运行：

```bash
cargo run -- validate --characters examples/ambiguous/characters.json --annotations examples/ambiguous/chapter.annotations.json --source examples/ambiguous/chapter.txt
cargo run -p castglean-core --example validate_sample
```

## 无效样例

`invalid/unknown-field.annotations.json` 在 source 中把 offset_unit 拼错，JSON 结构解析和 Schema 都应拒绝。

`invalid/gap.annotations.json` 引用 minimal 的正文和角色表，但片段在旁白与台词之间遗漏三个字节。其 JSON 结构有效，Schema 接受，应用覆盖校验必须拒绝。无效样例不附另一本正文，显式使用 minimal 中的文件。

完整字段与规则见 [格式草案](../docs/data-format.md)，Schema 见 [schemas](../schemas/README.md)。
