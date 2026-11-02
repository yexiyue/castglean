# 网上小说补充评测组

`evaluations/literary-v1` 是独立的六例补充组，来自鲁迅三部作品各两个连续片段。它不混入四十例原创语料，也不称为模型未见过的留出集。经典作品可能已在模型训练中出现；结果仅适用于这些已冻结片段。

| 样例 | 作品与固定来源 | 观察点 |
| --- | --- | --- |
| kong-01 / kong-02 | [《孔乙己》，revision 2605389](https://zh.wikisource.org/w/index.php?title=%E5%AD%94%E4%B9%99%E5%B7%B1&oldid=2605389) | 可靠代词、心理活动、持续发言 |
| mad-01 / mad-02 | [《狂人日记》，revision 2605391](https://zh.wikisource.org/w/index.php?title=%E7%8B%82%E4%BA%BA%E6%97%A5%E8%A8%98&oldid=2605391) | 匿名身份、仅提及人物、第一人称、身份称呼 |
| home-01 / home-02 | [《故乡》，revision 2570945](https://zh.wikisource.org/w/index.php?title=%E6%95%85%E9%84%89&oldid=2570945) | 后置提示语、转述与直接对白、指代 |

来源页面标记作品为公有领域（PD-old-80-1996）。作者署名及原页面链接保留；网站编校内容的署名与共享要求见 [维基文库使用条款](https://zh.wikisource.org/wiki/Wikisource:版权信息) 与 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。本组原文遵循来源许可，仓库 MIT 许可证不代替第三方作品许可。

## 获取与冻结

从页面 HTML 的正文段落提取文字，保留原字形与标点；去掉排版用 U+200B，段落边缘去空白，再以两个 LF 连接段落。基于这个明确的文本快照截取连续范围。没有翻译、转写、删改台词或拼接不同叙事位置。初始抓取的 HTML 与完整段落快照仅保存在忽略目录 `runs/quotation-evidence/sources`，公开仓库只保存六个短片段。

每例包含正文、角色表、章节标注、评测元数据和 `provenance.json`。出处记录固定页面版本、抓取时间、提取规则、完整提取快照摘要、片段摘要及其在快照中的 UTF-8 范围。`freeze.json` 包含出处、正文、金标、允许称呼、身份提及及政策的摘要；模型调用前完成冻结，不按模型结果修订答案。

构建入口 `scripts/build-literary-suite.py` 使用已检查的来源快照，拒绝覆盖已生成套件。离线验证核对出处的链接/版本和片段摘要；完整快照与公共来源是否一致在获取时复核，不声称离线程序能凭一个摘要证明远端真实性。

## 标注边界

金标由本次实现按 [现有政策](annotation-policy.md) 独立标注和复核，未使用被测后端的输出生成答案，尚未经用户独立复核；`review_status` 保持 `unreviewed`，不冒充正式人工确认。叙述者使用原文“我”，而非把作者鲁迅当角色；别人的台词中“我”不当叙述者身份证据。未提供可区分个体的儿童群体、亲戚本家和台词中的集合“我们”不拆成虚构人物；不将狂人的主观判断变成客观新增身份。`kong-01` 的“我想”后内容为心理活动，`home-01` 的“我说……母亲也说好”为叙述转述。

原文字节覆盖、所有身份提及、证据引用和允许称呼均通过 Schema、Rust 应用及 Python 套件校验。评分沿用章内一对一身份匹配和原文字节重叠，不按单句重新挑身份；构造重新编号的正确输出以及全判未知的错误输出验证评分行为。

```bash
python scripts/evaluate-attribution.py verify --suite evaluations/literary-v1 --binary target/debug/castglean
python scripts/compare-attribution.py --binary target/debug/castglean --backend minimax --label literary-quotes --suite evaluations/literary-v1 --repeats 1 --evidence-mode verified-quotes
```

本组所有例子标为 `supplemental`，运行时使用默认 `--split all`。预算与 v2 原创对照相同；失败仍计入全部计划的表达分母，未知用量保留 `null`。按后端及模式分别报告，不将经典小说的小样本结果概括成现代网文能力。
