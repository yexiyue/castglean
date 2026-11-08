# 决策：有声漫画留在 CastGlean 内实现，不另起项目、不做 Mihon 插件

> **日期与状态**：2026-11-07 拍板（用户确认）。承载方式已定，方向本身未排期：B 系列排期不变，先做一次性 spike 回答两个假设后再决定是否立项。**适用范围**：产品与架构定位，无平台差异。

## 问题

有声漫画（漫画 → 多角色配音收听）要不要以**新项目**或 **Mihon（Android 漫画阅读器）插件**的形式承载，还是留在 CastGlean 内作为一个候选功能块。

## 备选与取舍

| 备选 | 结论 | 关键依据 |
| --- | --- | --- |
| Mihon 插件 | 否决，技术不可行 | Mihon 扩展体系只有"源扩展"（DEX/APK 格式的目录解析器，[Keiyoushi 扩展仓库](https://github.com/keiyoushi/extensions)全为此类），没有能添加 TTS/朗读的功能插件 API，社区明确此类功能只能 fork 整个 app。fork 路线 = 长期维护 Kotlin/Android 大型分叉，且 TaleChime（Rust candle）需整套交叉编译上 Android；现有桌面资产（引擎、casting、合成、LLM 层、m4b 导出）没有一样能装进该生态 |
| 新开项目 | 否决，重复建设 | 管线约七成复用，而 casting/音色映射/合成/导出/LLM 连接层正是 B 系列在建内容，新项目等于全部重写。引擎本身已是独立 crate（TaleChime），将来若漫画方向长大可再拆分——有先例可循，先拆属过早抽象 |
| **CastGlean 内实现** | **采纳** | 伴读播放器从属于听书闭环，不做阅读器赛道；手机收听由 m4b 导出 + 现成有声书播放生态覆盖（无需 Mihon）；将来接漫画库走**导入适配器**（Suwayomi GraphQL / Kavita / Komga / 本地 CBZ），只读 API，不做抓源、不做插件 |

## 验证证据

- Mihon 扩展能力边界与 fork 生态现状：2026-11-07 检索确认（源扩展 only；最接近的 fork 是 joyeli 的端上 AI 翻译，无 TTS 先例）。见[桌面漫画阅读生态调研](../../research/desktop-comic-readers.md)。
- 管线成熟度与复用度估算：[有声漫画调研](../../research/audio-comics.md)。
- 桌面漫画生态与伴读播放器边界：[桌面漫画阅读生态调研](../../research/desktop-comic-readers.md)。

## 未验证边界

- 广播剧式纯音频可听性、说话人归属校正成本——由 spike 回答（1–2 话真实漫画 + 视觉 LLM + 现有合成链）。spike 未做且未通过前，本决策只锁定"承载位置"，不构成立项。
- 伴读式将来若要上手机（移动端 app），超出本决策范围，届时重评。
- "做成给别人用的平台级产品"（Toonsutra 路线）与本决策的"个人收听工具"是两种产品，未混入本次取舍。

## 相关链接

- [有声漫画调研](../../research/audio-comics.md) · [桌面漫画阅读生态调研](../../research/desktop-comic-readers.md)
- [章节制作后续规划](../plans/chapter-production.md)（B 系列节奏，不受本决策影响）
