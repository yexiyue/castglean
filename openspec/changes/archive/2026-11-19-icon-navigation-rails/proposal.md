# Proposal

## Why

应用有两处左侧导航栏，形态与职责都不统一：应用级侧栏（`src/components/library-sidebar.tsx`）宽 208px，放 logo 字标 + 三个「图标+文字」目的地 + 底部「设置」；工程内左栏（`src/components/app-sidebar.tsx`）宽 96px，放 logo + 三个「图标 + 竖排文字」分区。两个问题同时存在：

1. **设置入口重复**：应用级侧栏底部有「设置」按钮，顶栏齿轮也是设置入口，同一目的地两个入口、同名按钮，读屏里会出现两个「设置」。
2. **导航栏占宽不匹配职责**：应用级侧栏 208px 固定占位，在 1024×680 的小窗口里相当于内容列的两成，而它只承载三个目的地；工程内左栏 96px，图标下面又常显文字，实际只需要图标 + 悬停提示。Codex 这类生产级桌面工具都用纯图标栏：默认窄栏，名称在悬停或聚焦时出现。

用户决定采用纯图标栏（方案 A）：两个导航栏统一为约 56px 的图标栏，名称通过悬停提示与无障碍名称提供；设置入口只保留顶栏齿轮；侧栏 logo 退为纯品牌标记，回工程首页由顶栏 home 图标承担。

## What Changes

- 应用级侧栏（`library-sidebar.tsx`）：收窄为 56px 图标栏，三个目的地改为图标 + 悬停提示，删除底部「设置」按钮，logo 去掉字标并退为品牌标记（不再链接到 `/`）。
- 工程内左栏（`app-sidebar.tsx`）：去掉图标下方的常显文字，改为纯图标 + 悬停提示，栏宽由 96px 收到 56px。
- 无障碍：每个图标项都带 `aria-label` 与 tooltip；选中项保留 `aria-current="page"`；键盘 Tab 顺序与可见焦点不变。
- 文档与规格：导航形态属于界面契约，落到 `desktop-workflow-layout` 与 `desktop-interface-consistency` 的规格增量。
- 不做（明确出范围）：悬停展开飞出面板（方案 C）、折叠/展开状态持久化、应用级导航的第二列（Codex 的「图标栏 + 文字列表」双列结构）、浏览器预览行为、任何业务数据与流程改动。

## Capabilities

### Modified Capabilities

- `desktop-workflow-layout`: 新增「图标导航栏」要求（纯图标栏、悬停提示、设置入口唯一、品牌标记与首页入口分工）。
- `desktop-interface-consistency`: 在「全页面可读与可操作」下补充图标栏的无障碍与最小窗口场景。

## Impact

- 受影响代码：`src/components/library-sidebar.tsx`、`src/components/app-sidebar.tsx`、`src/components/projects/project-workspace.tsx`（栏宽变量）。
- 受影响断言：侧栏文字链接的 e2e 定位改为 `aria-label`（`e2e/workspace/navigation-links.spec.mjs`、`e2e/workspace/desktop-polish.spec.mjs`）。
- 文档：`README.md`、`docs/desktop-studio/interaction-design.md`、`docs/desktop-studio/component-interaction-audit.md`、`docs/ui-ux-audit/README.md`、知识库索引。
- 不改变路由、数据格式、宿主命令与工程数据。
- 验证：`pnpm test`、`pnpm build`、`pnpm lint`、目标 e2e 与 macOS 真实窗口（1024×680 与常规宽度、亮暗主题、中英文）。
