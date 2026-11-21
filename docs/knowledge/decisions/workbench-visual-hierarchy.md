# 工作台视觉层级与信息密度

2026-11-19。适用于章节制作、检查器、音色和模型等桌面工具界面。以下规则是 CastGlean 对 Adam Wathan 与 Steve Schoger《Refactoring UI》的应用，沿用 Base Nova + Neutral 组件和语义变量。[原书与目录](https://refactoringui.com/) · [中文阅读入口](https://shallowhawk.github.io/refactoring-ui-zh/)

| 场景 | 项目规则 |
| --- | --- |
| 设计起点 | 从一个真实任务走完整流程，先确定用户当前操作和所需信息，再定布局。草稿包含空态、处理中和失败，视觉调整以已有组件和尺寸档位为起点。[从零开始](https://shallowhawk.github.io/refactoring-ui-zh/starting-from-scratch/) |
| 主次与去重 | 每个区域突出当前最重要的动作，同排次要动作降低视觉权重。能从上下文认出的值可直接显示。重复身份只显示区分所需的部分。字段名、键盘焦点和屏幕阅读器名称仍按可访问性要求提供。[层级就是一切](https://shallowhawk.github.io/refactoring-ui-zh/hierarchy-is-everything/) · [作者节选](https://refactoringui.com/previews/labels-are-a-last-resort) |
| 布局与留白 | 同组紧凑，组间留出明显间隔。优先用位置、对齐和留白表达关系。工具栏按控件所需大小布局，正文和列表承担剩余空间。窄窗优先截断辅助标识，保留时间、主要操作和阅读区域。[布局与间距](https://shallowhawk.github.io/refactoring-ui-zh/layout-and-spacing/) |
| 排版与数值 | 使用现有字号与字重建立层级。正文行宽与行高配合检查，长段落左对齐。混合字号的文字按基线对齐。时间使用等宽数字特性并保持可读，表格中的可比较数值右对齐。[文字设计](https://shallowhawk.github.io/refactoring-ui-zh/designing-text/) · [作者节选](https://refactoringui.com/previews/line-height-is-proportional) |
| 色彩与状态 | 从现有前景、弱化前景和破坏性语义变量选色。播放、选中和失败同时用形状、图标或文字传达，验证明暗主题对比度和焦点。[色彩的运用](https://shallowhawk.github.io/refactoring-ui-zh/working-with-color/) |
| 表面与素材 | 常驻区域用平面与简洁分隔。菜单和浮层需要与底层区分时才表达高度。使用原生尺寸的矢量图标，素材按容器裁切，正文使用稳定可读的背景。[营造层次感](https://shallowhawk.github.io/refactoring-ui-zh/creating-depth/) · [图片的运用](https://shallowhawk.github.io/refactoring-ui-zh/working-with-images/) |
| 操作与反馈 | 熟悉的次要动作可用图标，配悬停提示、键盘焦点和可访问名称。空态把下一步放在发生任务的区域。短暂成功由触发控件就地确认并播报；失败、需确认保存和待恢复等状态持续可见并提供下一步。[收尾打磨](https://shallowhawk.github.io/refactoring-ui-zh/finishing-touches/) |
| 迭代方法 | 比较参考界面时记录它解决的具体任务、显示条件和状态变化。用实际内容、双语、亮暗主题和小窗口验证本项目的取舍。[持续进阶](https://shallowhawk.github.io/refactoring-ui-zh/leveling-up/) |

## 章节工作台的落点

- 模型选择和准备入口放在助手或发起角色分析的位置。阅读区上方省去常驻配置说明。
- 检查器未分析时直接显示可编辑的声音配置；分析后尚未选中片段时用一句短提示。
- 同工程的跨章播放显示章名和时间，跨工程补充工程名。时间优先占位，长标题可以截断，完整身份可查看。
- 进度环和计数同排，停止后在原处提供继续，失败时提供重试和片段定位。固定高度的轨道只显示时间刻度、胶囊及停顿边界。定位与片段播放直接通过胶囊触发，撤销放在停顿编辑器内。导出成功在导出按钮就地确认并向辅助技术播报。导出失败仍显示可处理的错误。
- 2026-11-20，片段轨道服务于定位和试听。短章自动适配，长章保留可点击的胶囊宽度并横向滚动。生成期间固定槽位，非等比轨道只在已知边界标真实时间。适配整条时间线的交互参考 [Final Cut Pro](https://support.apple.com/en-mt/guide/final-cut-pro/ver4e2edcc/mac) 和 [Audacity](https://manual.audacityteam.org/man/zooming.html)，宽度限幅与边界标记由本项目采用。
- 2026-11-21，底栏通过尺寸和字重突出播放、当前时间与生成进度，章节名等上下文收敛为辅助信息。空态入口已经打开音频设置时，省去同目的地的图标。生成计划为每段预留 128 px，当前执行段可同时显示图标和状态文字，进度更新不改宽度。较窄的完成片段优先露出真实波形，角色名仍可悬停或由辅助技术读取。
- 2026-11-21，音频底栏归入章节工作区，横跨目录与正文并止于右侧分栏。助手输入框与内容面板使用整列高度，轨道的收放只减少章节工作区的垂直空间。
