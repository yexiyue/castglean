---
name: CastGlean
description: 有声书制作工作台的官方组件基线
---

## 视觉基线

2026-11-18 恢复 **shadcn Base Nova + Neutral** 和 **assistant-ui Base UI** 默认样式。颜色、圆角与字体以 [主题入口](src/index.css) 的官方配置为准。项目新增的视觉规范由后续迭代逐项制定。

工作台继续使用紧凑导航、独立滚动区和可调整的分栏。品牌标识与正式图像沿用 [品牌资产](docs/brand.md)。错误、状态和交互须有可读文本或无障碍名称。原文选择与字节坐标遵循 [工程约定](docs/engineering.md)。

## 带来源信息的操作菜单

- 使用 shadcn 的菜单分组和分隔线。先显示来源，再放定位、编辑和追加文件等操作。每组按任务排列。
- 来源标签和状态用 12 px 次要文字，文件名和操作用 14 px 正文。文件名可截断，悬停时可查看全名。元信息各行间距为 4 px。
- 菜单外沿留 8 px。操作行至少 32 px 高，左右内距和图标到文字的距离各为 8 px。分隔线上下各留 8 px，同组操作共享一条文字起始线。
- 表面、分隔线和次要文字使用 `popover`、`border` 和 `muted-foreground` 主题变量。章节标题菜单是这套规则的实现。[shadcn Dropdown Menu](https://ui.shadcn.com/docs/components/base/dropdown-menu)

## 工作区属性面板

- 面板内容共用 16 px 内边距。不同任务区块之间使用分隔线，两侧各留 16 px。标题用 14 px 半粗体，来源、保存状态和辅助信息用 12 px 次要文字。
- 同组字段间距为 12 px，标签与控件间距为 8 px。窄面板中的字段纵向排列，控件与区块标题共用左侧对齐线。
- 优先显示当前对象及可直接编辑的值。单组次要详情使用无边框的文字折叠入口，左侧箭头在收起时向右、展开时向下。展开内容与入口相隔 12 px。[shadcn Field](https://ui.shadcn.com/docs/components/base/field) · [shadcn Collapsible](https://ui.shadcn.com/docs/components/base/collapsible) · [Apple Disclosure Controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)
- 音色通过可搜索的下拉框选择，分组标题展示模型名称和图标，声音绑定的当前状态独立展示。[shadcn Combobox](https://ui.shadcn.com/docs/components/base/combobox#with-groups-and-collection)
- 音色下拉框的搜索框、选项高亮区和组间分隔线共用 8 px 外沿。分组图标占 24 px，与标题相隔 8 px。音色文字距选项行左缘 20 px，选项行至少高 32 px。标题用 12 px 次要文字，选项用 14 px 正文。标题与选项相隔 4 px，组间分隔线上下各留 8 px。
- 片段属性从已保存的归属确定配音对象。声音区显示工程级绑定，缺声时就地选色，已绑定时提供更换入口。绑定由用户确认。[ElevenLabs Audiobooks](https://elevenlabs.io/docs/eleven-creative/products/audiobooks#character-casting)
- 试听用小任务卡片，标题显示音色和模型，右上角显示任务阶段，正文预览生成所用的原文。操作行用图标切换播放和暂停，绑定用文字按钮，关闭结果用右侧图标。图标控件提供提示和可访问名称。资源下载使用宿主进度，合成使用不定进度指示。按工程和角色显示本次应用会话的试听任务。[shadcn Card](https://ui.shadcn.com/docs/components/base/card) · [Carbon Progress](https://www.carbondesignsystem.com/building-blocks/core/components/progress-bar/guidelines)
