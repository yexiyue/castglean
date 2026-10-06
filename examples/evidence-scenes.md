# 补充的证据场景

三个场景均为本项目原创公开文本与人工标注，在新版提示词运行之前写定，不修改历史样例的答案。

| 目录 | 核查内容 | 人工归属 |
| --- | --- | --- |
| direct | 两人分别有明确说话引导 | 林岚、周衡各一条 resolved |
| bounded | 明确限定为两人，其中一人开口 | 赵宁、孙平 ambiguous |
| offscreen | 在场人物与窗外未知发声者不同 | unknown |

正文均为无末尾换行的 UTF-8，范围与 hash 按字节计算。人工答案限定于这些小场景，不是规模化语料，也不能证明真实小说中的准确率。原 ambiguous 样例缺少说话引导，第二句人工定为 unknown；另一种合理解读是两句均在有限候选内。offscreen 的人工答案选择 unknown，但将原文明示的匿名发声者建为独立身份也可能合理：身份并不必然需要姓名。因此报告保留固定评分，单列这两个场景的争议，不能为了取得提升事后修改金标。

```powershell
python scripts/evaluate-baseline.py --runs runs/attribution-comparison --prefix local-v4-r1- --samples minimal ambiguous quoted direct bounded offscreen
```
