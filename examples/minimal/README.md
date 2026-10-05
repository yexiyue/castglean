# 最小数据示例

这是手工构造的设计示例，不是模型输出，也不是已经冻结的 v1 协议。未包含完整分析来源、角色合并和修订字段。

- [chapter.txt](chapter.txt)：`张三说：“走吧。”`，UTF-8 无 BOM，无末尾换行，共 27 字节。
- [characters.json](characters.json)：张三的稳定示例 ID 为 `char-001`；正文没有声线描写，声音画像保持未知。
- [chapter.annotations.json](chapter.annotations.json)：旁白 `[0,12)`，台词 `[12,27)`，归属证据引用旁白片段。

正文摘要为 `693d2f4dc01c19056a2dbf0fddf40a6c5c64f7690d0ba336727eb7c884a7a20f`。两个范围连续、覆盖完整，并位于 UTF-8 字符边界上。

所有坐标针对保存的正文快照。不要用 Unicode 字符数或终端列数解释这里的数字；不要修改正文后继续沿用旧摘要和范围。
