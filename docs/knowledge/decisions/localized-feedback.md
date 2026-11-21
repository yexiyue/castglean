# 桌面反馈贴近操作

2026-11-21。CastGlean 工作台依赖目录、原文、检查器和底部播放器同时可用。常驻横条会重复章名并压缩三个窗格，尤其影响小窗口的阅读和编辑。

## 调研

- Apple 建议在信息所描述的对象附近呈现状态，让反馈的显著程度匹配其影响。工具栏可提供被动状态，严重风险使用打断式提示。[Apple HIG Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)
- Fluent 将 InfoBar 用于需要确认或处理的应用级变化。局部且无需持续显示的信息可使用就地浮层。[Microsoft InfoBar](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/infobar)
- IBM Carbon 将持续反馈放在相关区域，简短回执可以短暂显示。需要处理的错误应说明下一步，恢复动作应可再次找到。[Carbon Notification](https://www.carbondesignsystem.com/building-blocks/core/components/notification/guidelines)

## 应用内核对

| 区域 | 本次调整 |
| --- | --- |
| 章节工作台、工程角色 | 删除窗口级状态挂载位。底部播放栏直接提供归属、缺失音色和跨章任务等动作，复用它原有的生成、播放和进度。需要重试或核对的通知限于相关工作区。 |
| 示例工程 | 章节顶栏在现有标题旁标示只读，角色和制作结果页面依其能力展示各自的状态。 |
| 模型中心 | 目录读取失败占用目录内容位置，操作错误归入对应模型详情或准备对话框，仍可从原处重试或访问存储设置。 |
| 音色中心 | 已删除项目从列表移除，焦点回到搜索。读屏继续收到完成回执。 |
| 首页、导入、设置与助手 | 核对空态、表单错误、恢复和任务卡。现有局部反馈继续由相应控件承载。阻断启动及跨区域的真实任务和恢复状态保留独立反馈。 |
