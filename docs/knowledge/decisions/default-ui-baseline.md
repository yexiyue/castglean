# 官方视觉基线

2026-11-18，使用项目锁定的 shadcn CLI 4.23.0 在单独的 Vite 项目中生成 **Base Nova + Neutral**。assistant-ui 源码来自样式感知的 `base-nova` registry，运行时沿用 `@assistant-ui/react` 0.15.36。旧视觉规范由本基线取代。重置前工作区快照为 `4484c40`（`codex/pre-default-ui-reset`）。[shadcn CLI](https://ui.shadcn.com/docs/cli) · [assistant-ui 安装](https://www.assistant-ui.com/docs/manual-installation)

直接使用官方通用控件。包含桌面交互的控件保留平台逻辑，使用 registry 的基础类与语义配色。会话工具卡保留 WKWebView 滚动稳定修复，视口保留独立输入区所需的最小高度约束。Number Field 和项目专用工具保留现有实现并使用新语义变量。

工程工作区与应用各页面共用外层内容卡片样式，右侧和底部各留 4 px，右下角使用较大的主题圆角，亮色主题以轻阴影区分层次，暗色主题以侧栏和卡片的背景色差区分层次。助手输入区贴近消息视口，视口仅在相应方向还有内容时显示局部渐隐和模糊。沿用 assistant-ui 的滚动与锚点逻辑。全局可见滚动条使用主题颜色和 8 px 轨道。Chromium 与 WKWebView 中，会话的原生轨道在输入工具栏上缘结束，滑块在两端渐隐。强制颜色模式保留系统滚动条。[shadcn Scroll Fade](https://ui.shadcn.com/docs/changelog/2026-06-chat-components)

验证覆盖前端构建、lint、85 项单测、浏览器路由回归及 128 组页面、主题、语言与运行环境组合。macOS 窗口确认了官方主题和工作台布局。滚动条调整通过 11 项 Chromium 回归并验证了原生滑块拖动，使用独立 macOS WKWebView 加载夹具核对了底部渐隐和工具栏对齐。

2026-11-18 更新：窗口顶栏的短分隔线随目录和助手分栏移动。原文信息、定位和结构操作集中在章节标题下拉。检查分章、分析和生成音频是 AI 助手空会话的快捷建议，已有会话可从章节任务菜单调用。目录修改与撤销的 Agent 工具卡片列为后续设计，当前分章与合并继续使用确认弹窗。

2026-11-18 弹窗动效修正：Animate UI 浮层统一由 Motion 驱动。检查主题重置后的组件样式时，Chromium 同一帧检测到 shadcn 的 CSS 入场关键帧和 Motion 缩放并行运行。移除共享浮层的 CSS 入退场规则后，浏览器回归验证了正常动效、减少动态效果、快速反复开关及 Escape 焦点恢复。CLI 的静态审查仅识别了 Sheet 的两处 CSS 过渡，运行时检查同时覆盖对话框、菜单及其他浮层。

2026-11-18，目录和助手使用 Animate UI 的 220ms 开合节奏。外层按开合进度裁切，保留侧栏内容的固定宽度，标题栏分隔线跟随分栏。拖动宽度直接生效，系统启用减少动态效果时立即开合。Chromium 逐帧验证了双侧收起和减少动态效果，并通过面板焦点、拖动和草稿回归。
