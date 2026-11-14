---
name: CastGlean 静阅青
description: 面向个人有声书制作的安静、清晰的桌面工作台
colors:
  background: "#f8f9f7"
  foreground: "#182c29"
  surface: "#ffffff"
  primary: "#245b50"
  primary-foreground: "#ffffff"
  muted: "#edf2ee"
  muted-foreground: "#536561"
  dark-background: "#17211f"
  dark-foreground: "#edf2ef"
  dark-surface: "#202d29"
  dark-primary: "#a6d3bf"
  dark-primary-foreground: "#132823"
rounded:
  control: "10px"
  item: "8px"
  surface: "12px"
  overlay: "16px"
---

## Overview

CastGlean 帮助个人将自有小说制作成多角色有声书。界面应安静、克制、可操作，让导入、角色与声音检查、章节生成、试听和导出构成清楚的工作流。正式标志和资产见 [品牌文档](docs/brand.md)；[产品定位](PRODUCT.md) 与 README 描述用户及实际能力。

## Colors

亮色以近白阅读面与深青行动色为主，暗色以墨绿工作面与浅青行动色为主。颜色配对、状态弱底、边界及焦点的唯一运行时来源是 [主题 token](src/index.css)；上方颜色是常用值索引。页面使用语义类而非硬编码颜色，状态同时使用文字或图标，不只靠颜色区分。

## Typography

界面使用 Geist Variable、系统中文字体及 Noto Sans Variable 的字体栈，标题沿用相同字体族。控件使用共享组件的字号与密度；助手 Markdown 和文档使用 `typeset-chat`、`typeset-docs`，工具卡退出排版范围。原文空白、选择和字节坐标不得因排版而改变。

## Layout

导航直接显示名称；共享模型与音色有稳定入口。集合优先可扫描列表，分组使用间距和分隔线。窄窗口保持主要操作、章节目录和辅助面板可达；不将每一项设置包装为卡片。页面在实际路由、亮暗主题、中英文及小窗口中验证。

## Elevation & Depth

工作面、边线和有限的弹层阴影表达层级；不使用装饰渐变、玻璃面板或无意义动效。弹层、侧栏和加载反馈应尊重减少动态效果设置。

## Shapes

输入与按钮、列表项、工作面和弹层分别使用 `rounded-control`、`rounded-item`、`rounded-surface`、`rounded-overlay`。亮暗主题共用几何；头像和媒体轨道可使用圆形，不因分组需要而添加卡片外壳。

## Components

优先使用项目持有的 shadcn/Base UI 组件及其变体。表单使用 Field 组合、RHF/Zod 和适当的局部草稿；标签、说明、错误、焦点与禁用状态必须清晰。搜索、筛选和播放控制使用共享原语并保留各自语义。未知、加载、空值与失败分别呈现；请求未确认时保留原身份并提供明确恢复动作。

## Do's and Don'ts

- 保持原文和人工修正；模型建议需明确审核与采用。
- 展示真实任务、资源和错误状态，不伪造进度、成功或可用操作。
- 减少视觉覆盖；新增布局和必要例外遵循 [工程约定](docs/engineering.md)。
- 不使用营销式大标题、悬浮外壳或大面积装饰效果干扰生产任务。
