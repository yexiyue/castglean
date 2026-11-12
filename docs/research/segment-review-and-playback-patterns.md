# 片段审阅与就近播放：主流产品形态调研

日期：2026-11-11。背景：章节音频第一阶段落地后，计划整体调整阅读工作台——
归属审阅改异常驱动、段首常显说话人、段旁就近播放并从该段连播。本调研验证
该形态是否符合各品类的用户习惯与心智模型，结论将作为 OpenSpec 变更的依据。

**实施状态（同日）**：本调研的方案已由变更 `attribution-review-and-playback`
落地（宿主审阅口径、段首标注、就近起播/连播/跟读、生成中渐进可听），自动化
门禁全绿；真实窗口验收未做。第 5 节"跟读高亮纳入第一版"已照做。


## 调研问题

1. "点某段从那里开始连播"是否符合用户习惯？
2. 段首常显说话人标签是否是标准形态？
3. 生成过程中逐段可听（渐进可用）是否有先例？
4. "只审低置信片段、其余默认可信"是否是行业标准？

## 结论速览

| 我们的设计 | 主流参照 | 判定 |
| --- | --- | --- |
| 点段旁 ▸ 从该段连播到已生成末尾 | TTS 阅读器 Read from Cursor 三件套；Descript 点词移播放头；Voice Dream 点句即播 | 标准 |
| 段首说话人 chip 常显、点击改归属 | Otter.ai / Descript speaker labels | 标准 |
| 单元生成完立即可播、可单独重生成 | ElevenLabs Studio 按段生成/试听/重生成 | 品类标准 |
| 只有 unknown/ambiguous/冲突进待检查 | MTPE 行业 review by exception（memoQ AIQE、Locize QE） | 行业标准 |
| 播放时正文高亮当前段（跟读） | Speechify、@Voice、Microsoft Immersive Reader | TTS 标配，纳入第一版 |

整体判定：该形态是三个成熟品类（TTS 阅读器、配音生产工作室、转写编辑器）
标准惯例的组合，没有发明新交互。

## 1. "从那里开始播放"是跨品类共同惯例

### TTS 阅读器传统（桌面/无障碍血统）

"Read All / **Read from Cursor** / Read Selection" 三件套是标准命令组合，
广泛出现在：VS Code Markdown Read Aloud 扩展（Read from Cursor 快捷键）、
Obsidian Narrate 插件、TTSReader（右键 Read from cursor）、Adobe Acrobat
Read Out Loud（Shift+Ctrl+B 从光标读到文末）、Microsoft Word 朗读、
Windows Narrator（Ctrl+Narrator+R）。

共性规则：

- 光标/点击位置 = 播放起点，读到文档末尾（连读，不是只读一句）；
- 有选区时选区优先（读选中部分）；
- 几乎都有键盘快捷键；
- 普遍伴随"读到哪句高亮哪句"的跟读效果。

### 转写编辑器（播客/视频生产）

Descript 是该品类事实标杆：点击转写文本中的词即把播放头移到该词，播放从
那里开始（第三方教程表述为 "Click the sentence, hear the exact words"）。
注意 Descript 的点击本身只移动播放头，真正出声仍需按播放/空格——即主流
产品里"定位"与"出声"也是两步，我们的 hover ▸ 一步出声更直接。

### TTS 听书

Voice Dream Reader（Apple 多次推荐、听书品类标杆）：点击正文句子，播放
游标跳到该句并继续播放，官方文档与用户讨论均确认这个 "tap and listen"
行为。Reddit 上用户以 "select the point to start reading from" 描述该
预期——说明这已是用户主动带来的心智。

**对我们的含义**："从该段连播"符合所有参照品类；连播而非单句是默认预期
（单句试听在配音工作室场景由"点该段再次暂停/停止"自然覆盖）。选区播放
（Read Selection）对我们意义有限——单元粒度固定，不引入。

## 2. 说话人标签常显是转写产品的标准形态

- Otter.ai：每个段落块前缀说话人标签（"Speaker 1"/人名），同说话人连续
  话语自动合并为一个段落块；点击标签弹出指派/改名。
- Descript：自动识别并标注 speaker label，消除人工标注。
- 本质是"剧本对白格式"（说话人：内容）的数字化——文字媒介几千年的惯例。

**对我们的含义**：段首角色名 chip（含旁白）与 Otter/Descript 同构；Otter
不给任何段落留空标签，支持"旁白也标"（不要求读者推断缺省角色）。点击
chip 打开 inspector 修改归属，与 Otter 点击标签改名的交互同构。

## 3. 逐段生成、生成完即可播是配音生产工具的工作流标准

ElevenLabs Studio / Projects 官方文档与社区确认：

- 音频按段落逐段生成，每段可单独播放、单独重新生成，甚至选中段内若干
  词只重生成那些词（官方帮助中心明示）；
- "一次生成一段"是 intended behavior，目的就是可以只重做局部而不动整体
  （官方 Reddit 回复确认）；
- 从业者工作流（配音自动化实践文章）：按段拆分 → 逐段生成 → 回听 →
  只重生成不满意的段。

**对我们的含义**："单元落盘即获得可播身份、失败后保留已生成单元、续跑只
补缺"的实现与行业头部产品的段落工作流完全一致；生成中试听不是冒险创新。
我们比 ElevenLabs 多的差异点（本地引擎、边生成边听不用手动逐段触发）是
增强，不是偏离。

## 4. 审阅"只看异常"是机器翻译后编辑（MTPE）的行业标准

机器翻译行业面对同样的问题：机器产出大量片段，人工全量确认不可扩展。

- 行业方案是 **review by exception / quality estimation (QE) 分流**：
  每段打置信分，高置信段自动通过，低置信段才路由给人工；
- memoQ AIQE 的产品表述即 "people only review the segments that need
  reviewing"；Locize 对每段给置信估计并在编辑器中浮出低置信段；
- ISO 18587（译后编辑标准）同样按轻量/全量后编辑分档，不要求全量同权处理。

**对我们的含义**：归属审阅从"全部片段待确认"改为"unknown / ambiguous /
与人工修改冲突才算待检查"，与行业 review-by-exception 同构。我们的
attribution 三态（resolved/unknown/ambiguous）就是现成的置信分层，不需要
引入 LLM 置信分数（QE 分数依赖专门模型，LLM 自报置信不可靠）。

## 5. 跟读高亮（读到哪句亮哪句）

TTS 品类的事实标配：Microsoft Immersive Reader（Edge/Word/OneNote 内置）、
Speechify、@Voice Reader、乃至 Windows 自讲述读工具均伴随句子级高亮跟随。
对我们：连播时高亮阅读区当前播放段落、底部条显示当前段与进度，成本
极低（unitTimeline 已能换算单元时间轴），应纳入第一版而非后续增强。

## 对设计方案的修正与保留

1. **新增**：播放跟读高亮进第一版（品类标配，缺失会显著降低"听书感"）。
2. **保留**：hover ▸ 显式播放，正文点击保持"检查归属"语义。理由：审阅
   阶段点正文的主任务是查看/修改归属；主流产品（Descript）中定位与出声
   也是分离的两步；显式按钮不会误触。
3. **保留**：旁白段也标 chip（Otter 无空标签先例）。
4. **不采纳**：选区朗读（Read Selection）——单元粒度固定，无对应需求；
   LLM 置信分数——三态 attribution 已够用且更可靠。
5. **后续可选**：播放起点的键盘操作（TTS 阅读器普遍有快捷键）等听书
   模式成型后再统一设计。

## 来源

- VS Code Markdown Read Aloud / Obsidian Narrate / TTSReader / Acrobat Read Out Loud / Windows Narrator 的 Read from Cursor 惯例（搜索聚合）
- Descript：点击转写词定位播放（stratilyze.com 使用指南；descriptmastery.com 编辑器地图）
- Voice Dream Reader 点击句子起播（voicedream.com；AppleVis 论坛）
- Otter.ai speaker 标签与段落合并（help.otter.ai：Speaker Identification Overview、Tagging Speaker Names）
- ElevenLabs Studio 段落级生成/试听/重生成（elevenlabs.io/docs 帮助中心；官方 Reddit 回复；adamcowley.co.uk 实践文）
- MTPE review by exception：memoQ AIQE（blog.memoq.com）、Locize QE（locize.com/blog）
- 跟读高亮：Microsoft Immersive Reader、Speechify、@Voice（产品页）
