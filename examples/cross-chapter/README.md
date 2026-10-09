# 原创两章例子

chapter-1.txt 和 chapter-2.txt 为本项目原创公开文本。两章都明确说话人张三，第二章应复用第一章身份，不创建同名副本。它们是流程样例，不是冻结准确率基线。

运行 `cargo run -p castglean-core --example book_offline`，离线替身分析两章后把第二章台词人工改成 unknown，输出完整 book JSON。第二章故意改为 unknown 用于演示用户确认的优先级，不作为金标答案。

正文与人工确认在后续末章重分析中保留。库与 CLI 说明见 [跨章文档](../../docs/cross-chapter.md)。
