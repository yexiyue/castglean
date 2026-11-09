# 桌面上下文栏与任务流程减负

日期：2026-11-07。状态：已实现，真实组件的浏览器预览与合成 IPC 验证通过。用户在统一圆角后进一步授权全应用大改，明确要求移除不合适的页头、减少操作，并兼顾精致、层级、空间与紧凑。此决定替代上一轮的标题＋说明式 PageShell 布局，圆角与搜索规范继续有效。

## 调研与取舍

- [Atlassian Page Header](https://atlassian.design/components/page-header)：将标题、动作与筛选分工，支持组合而非固定叠加所有区域。本应用的集合页已有侧栏定位，因此可视上下文栏直接呈现模型/音色分类，不再重复标题和通用说明；语义 h1 与描述仍保留。
- [Apple Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)：优先常用操作、按作用域分组、保持稳定位置。应用标签栏继续负责工程/全局状态，页面上下文栏负责分类或返回路径，筛选紧邻列表。本次使用现有平面主题，不照搬 Liquid Glass、原生自动溢出或声称 Tauri 已具备 AppKit 行为。
- [Carbon UI shell](https://carbondesignsystem.com/components/UI-shell-header/usage/) 与 [2x Grid](https://carbondesignsystem.com/guidelines/2x-grid/overview/)：导航与内容层次明确，使用一致间距与对齐线。采用约 48px 上下文栏、208px 应用侧栏、20px 内容边距、16px 分组和 12–16px 表单间距；这些数值是本应用决定，不是对 Carbon 数值的逐项复制。
- [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)：语义交互、可见焦点、长内容和真实空态。整行模型入口使用单一 button；键盘打开详情与关闭后的焦点返回验证通过。

以上为官方规范的设计取舍，未进行真实用户可用性研究。紧凑不等于缩小正文或点击目标，也不以装饰性卡片和阴影制造层级。

## 实现

[规格与任务](../../../openspec/specs/desktop-workflow-layout/spec.md)负责行为范围；[PageShell](../../../src/components/page-shell.tsx)统一上下文栏，集合分类取代重复标题；[导航](../../../src/components/library-sidebar.tsx)压缩密度并准确标记新建导入。导航用 sidebar、工作表面用 card、候选用弱辅助底色和分隔线，不新增配色或浮动外壳。

[导入](../../../src/routes/new.tsx)的“选择 TXT 并继续”连续执行创建与文件选择，备注按需展开。宿主已创建但选择取消/失败时保留同一草案，重选不重复创建。选择句柄仍在移除/离页时释放，编码必须显式确认；没有提前提交来源。操作互斥防止重复启动。

模型整行进入详情；音色搜索/模型/视图集中在列表上方；没有传输任务不渲染空容器，导出只在实际选中时出现，全选入口仍可发现。音色创建名称/引擎并排，核心输入与候选分区；就绪时不重复资源目录，未就绪仍在当前页准备，返回后草稿保留。首页、上手、设置、工程同步使用更紧凑的标题/间距。

## 验证

复现：启动 `node tests/helpers/serve-workbench.mjs`，使用安装好的 Playwright 设置 `PLAYWRIGHT_MODULE`，运行 `tests/desktop-workflow-browser.mjs` 与 `tests/desktop-polish-browser.mjs`。

- 连续导入、备注透传、取消/失败后重试仅创建一次、编码提交前无导入命令、选择句柄释放。
- 模型行 Enter 打开、Escape 关闭后焦点归位、无自动准备；上下文栏分类和高度；选择/取消后的导出显隐。
- 创建返回与草稿、就绪/未就绪资源入口；128 组页面/设置分区 × 运行模式 × 中英 × 亮暗的 1024×680 检查，无页面异常、未声明 IPC 或窗口横向溢出。
- 补查 1440px 英文暗色模型及小窗口创建/导入/设置截图，等待图片解码避免将资源未加载误当成最终布局。截图位于 ignored `src-tauri/target/workbench-acceptance/streamline-*`。
- 17 项 AI/分章测试、9 项播放测试、分章工作台/交互/Tiptap 与 Streamdown 三套浏览器回归通过。构建、lint、英文缺失 0 与严格规格校验通过；保留已有包体积/静态中文目录构建提示和 sidebar cookie lint 警告。

本次不修改 Rust、IPC、数据或真实资产。合成选择器验证的是调用顺序和界面状态，不证明原生系统文件选择器/WebView 行为；macOS 原生交互及 Windows/Linux 仍需分别验收。


## 同日补充：分章接入窗口顶栏

用户反馈分章页未沿用新布局，提供 zcode 两侧面板开关截图作为参考。本轮移除分章重复页头，以 [WorkspaceChromeContext](../../../src/components/workspace-chrome.tsx) 提供 DesktopShell DOM 插槽，由工作区 portal 管理按钮生命周期；工程名称只在标签显示，离页自动清理。面板状态由 matchMedia 与工程临时偏好共同推导，替代 CSS 单独隐藏导致的 aria/实际显示不一致；隐藏助手保留挂载，避免丢草稿或重复读取。快捷键忽略输入和组合输入，不与编辑器冲突。此补充替代分章仍保留独立文字工具栏的旧布局描述，详见[规格](../../../openspec/specs/splitting-workspace-chrome/spec.md)。

验证重点是实际 `/new?draft=fixture-project&fixture=desktop` 路由，而不只检查独立工作台：[专用回归](../../../tests/workspace-chrome-browser.mjs)覆盖插槽、正文起点、面板/焦点/快捷键、折叠不重读、离页清理与返回恢复，以及 1024/1440 × 中英 × 亮暗共 8 组布局，无横向溢出或未声明 IPC。实际路由截图已经人工检查；独立工作台、审阅/人工操作、Tiptap/Markdown 和上下文模型回归通过。17 项 AI/分章与 9 项播放测试、128 组全应用浏览器回归通过；构建、lint（仅既有 sidebar cookie 警告）、英文缺失 0 与严格规格校验通过。本轮仅改变前端和合成夹具，不修改宿主数据/协议；浏览器验证不代表原生 WebView、窗口拖动区或 Windows 标题栏验收。
