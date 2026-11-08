# 桌面漫画阅读生态调研：开源为何稀少，需求是否成立

> **状态：外部调研快照，2026-11-07 检索。** 起因：有声漫画的伴读式形态（见 [有声漫画调研](audio-comics.md)）需要一个桌面漫画查看器，而直观印象是"桌面端开源漫画软件很少、mihon 桌面移植热度很低"。本文核实这个印象、解释成因，并给出对本项目的含义。GitHub stars 为检索当日数值，外部项目状态会变化。

## 结论概览

1. **"开源桌面漫画阅读器少"属实，但需求不是零而是利基且分裂**：桌面漫画消费分成互不相通的三股——本地档案派（YACReader/CDisplayEx/HoneyView，看自己的 CBZ/CBR）、自建服务器派（Komga/Kavita/Suwayomi，极客管线）、官方平台桌面/Web 客户端（哔哩哔哩漫画官方桌面版、各平台网页版）。没有一款"现代原生桌面阅读器"在崛起，最常被推荐的反而是 2000 年代的老软件。
2. **"mihon 桌面移植热度低"要拆开看**：Mihon 官方从未做桌面版（社区在 [#167](https://github.com/mihonapp/mihon/issues/167)/[#90](https://github.com/mihonapp/mihon/issues/90) 反复请求，官方共识是"桌面用 Suwayomi"）；事实上的桌面版 [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server) 有 8k stars（约为 Mihon 本体 25k 的三分之一），并不算死——但形态是"服务器 + Web UI"而非原生应用。热度受限主因是工程形态：Mihon 扩展是 Android 包，跑在桌面 JVM 上天然脆弱；且很多 Suwayomi 用户桌面端只当下载器，终端阅读仍在手机/平板的 Mihon 上。
3. **结构性原因决定桌面是小盘**：① 漫画/条漫的消费姿势是躺卧与通勤，条漫竖屏滚动为手机设计；② 桌面留存人群是扫描档收藏者、自建极客与学生 PC 场景（国内 B 站漫画为此维护官方 Windows/Mac/Linux 桌面版）；③ 官方平台出于 DRM 没有动力做桌面离线阅读，抓源类工具游走灰色地带，开源作者普遍避嫌。
4. **对本项目的含义：伴读播放器不进入"漫画阅读器"赛道**。不做库管理、不做抓源扩展、不做格式全家桶——那是 YACReader/Komga 的领域且已停滞。需要的只是从属于听书闭环的最小查看器：单话连续竖滚（条漫）+ 单页模式（页漫）+ 气泡高亮跟随音频 + 自动滚动，Tauri webview 自绘即可，无外部依赖。桌面 OSS 稀缺既不是机会信号也不是阻断信号——CastGlean 的差异化在"听"，"看"只是伴随。

## 桌面生态数据快照（2026-11-07）

| 项目 | 形态 | 平台 | Stars | 状态 |
| --- | --- | --- | --- | --- |
| [mihon](https://github.com/mihonapp/mihon) | 扩展制抓源阅读器 | 仅 Android | 25,076 | 活跃，官方明确不做桌面 |
| [Kavita](https://github.com/Kareadita/Kavita) | 自建阅读服务器（漫画+电子书） | Server + WebUI | 12,073 | 活跃，内置 webtoon 阅读器 |
| [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) | Tachiyomi 桌面重写（跑 Mihon 扩展） | Server + WebUI | 8,017 | 活跃，扩展兼容性是主要痛点 |
| [Komga](https://github.com/gotson/komga) | 自建漫画库服务器 | Server + WebUI/OPDS | 6,827 | 活跃，提供 Mihon 扩展串联手机端 |
| [Mangayomi](https://github.com/kodjodevf/mangayomi) | Flutter 扩展制阅读器（漫画+小说+动画） | 全平台含桌面 | 4,398 | 活跃，说明跨平台需求存在 |
| [YACReader](https://github.com/YACReader/YACReader) | 本地档案原生阅读器 + 库管理 | Win/Mac/Linux | 1,429 | 维护中，Qt 老牌，社区口碑担当 |
| CDisplayEx / HoneyView | 本地档案阅读器 | Windows | — | 免费软件，2000 年代老将，仍是 Reddit 高频推荐 |

另：哔哩哔哩漫画提供[官方桌面版](https://manga.bilibili.com)（Microsoft Store + Mac/Linux）与网页版，是中文场景里官方投入桌面端的少数案例。

## 需求证据

- **桌面阅读讨论存在但选择十年未变**：r/comicrackusers 的[《Decades later, is CDisplayEx still the best Comic Reader?》](https://www.reddit.com/r/comicrackusers/comments/1qh27rl/decades_later_is_cdisplayex_still_the_best_comic)、r/graphicnovels 的[可信阅读器盘点](https://www.reddit.com/r/graphicnovels/comments/1nsai71/what_are_the_most_trusted_digital_comics_readers)、r/mangapiracy 的[Windows 阅读器求助](https://www.reddit.com/r/mangapiracy/comments/1rgf2e9/windows_app_for_manga_reading)，答案高度集中在 CDisplayEx 与 YACReader——工具停滞但讨论仍活跃，说明需求稳定、规模有限、无人有利可图。
- **自建党的标准管线**：r/selfhosted 的[漫画收藏方案](https://www.reddit.com/r/selfhosted/comments/1j8t080/my_take_on_selfhosted_manga_collection)普遍是 Suwayomi 抓取 + Komga/Kavita 管库，阅读终端仍是手机/平板上的 Mihon/客户端——桌面是"仓库"而非"阅览室"。
- **中文官方桌面端的存续**：B 站漫画桌面版覆盖 Windows/Mac/Linux，指向学生与 PC 场景的真实使用（网页版对条漫竖向滚动体验尚可）。

## 为什么开源桌面阅读器稀少

1. **设备与姿势**：漫画主力消费在手机（条漫为竖屏滚动而生），桌面阅读是少数派姿势。
2. **生态绑定 Android**：抓源扩展生态（Tachiyomi/Mihon 系）以 Android 包为载体，桌面重实现（Suwayomi）永远追着兼容性跑；Mangayomi 用 Flutter 摊薄成本才做到全平台。
3. **商业与法律**：正版平台 DRM 优先，不做桌面离线；抓源工具灰色，开源维护者避嫌；纯本地档案阅读器市场小到无人投入，于是老软件长期"够用"。

## 对本项目的含义

> 承载方式已拍板（2026-11-07）：有声漫画留在 CastGlean 内实现，不另起项目、不做 Mihon 插件，见[有声漫画承载方式决策](../knowledge/decisions/audio-comics-hosting.md)。

1. **最小查看器，不是阅读器**：伴读播放器的验收标准是"跟着音频看画不累"，不是"管理我的漫画库"。列表：单话打开、连续竖滚/单页切换、气泡高亮、自动滚动、进度续看（挂到现有续听状态上）。
2. **不做抓源**：扩展生态的灰色属性与维护成本都不属于本项目；导入自有的 CBZ/文件夹/图片即可。
3. **对定位的再确认**：桌面漫画 OSS 稀缺是"桌面看漫画是小盘"的结果，不应把它当蓝海信号；伴读式的价值主张仍然是"耳朵代读文字"，与现有听书闭环一致。
4. **实现成本可控**：图片渲染与滚动在 webview 内是成熟能力，气泡高亮复用有声漫画管线产出的气泡坐标标注——查看器本身不构成技术风险项。
