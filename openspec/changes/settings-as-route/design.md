# Design

## 结构

设置状态本来就是地址栏参数（`?settings=<section>`，desktop-session 单一真相），路由化只是把"参数标记浮层"升级为"参数承载页面"：

- `openSettings(section)` 语义不变（唯一入口入口函数，10+ 处失败路径调用），实现改为 `navigate({ to: "/settings", search: { section } })`；已在该页时以 `replace` 改写分区（后退一次离开设置，不逐分区回退——与浮层时代的 replace 语义一致）。
- `settingsOpen` / `settingsSection` / `closeSettings` 唯一消费者是 `SettingsDialog`，随浮层一起删除。
- `SettingsPanel` 双栏布局本体不动（左侧分类搜索导航 `w-52` + 右侧 `max-w-2xl` 内容），作为 `/settings` 路由的分区组件；其根 `bg-background`、导航列 `bg-sidebar`、内容区 `bg-card` 在新外壳下自然呈现"导航列融入窗口底、内容区白色面板"。

## 页面骨架

`routes/settings.tsx`：`LibrarySidebar`（无选中目的地，设置不是集合目的地）+ 圆角内容面板（`mt-2 mr-2 mb-2 rounded-surface bg-card`，与 PageShell 主区同构）内嵌 `SettingsPanel`。不使用 PageShell：设置没有页头栏，分区标题由 SettingsPanel 内容区自带头部（Codex 式整页）。

## 顶栏返回

`desktop-shell.tsx` 顶栏左侧（工程首页链接之前）在 `pathname === "/settings"` 时渲染返回图标按钮：`router.history.canGoBack()` 为真则 `history.back()`，否则 `navigate({ to: "/" })`。aria-label「返回」。非设置页不渲染，不占空间。

## 迁移与清理

- 删除 `settings-dialog.tsx` 与 DesktopShell 中的挂载；不为旧浮层保留兼容层。
- `e2e/settings/` 8 个 spec：`?fixture=desktop&settings=models` → `/settings?fixture=desktop&section=models`；`getByRole("dialog", { name: "设置" })` → 页面容器定位；「关闭」按钮断言改为顶栏返回按钮行为。fixture 参数（`fixture`/`llmFixture`/`locale`/`theme`）是 URL 直读，跨路由保留，无需改 fixture。
- 浮层时代的 Escape 关闭行为随 Dialog 消失；分区搜索 Escape 清词语义不变（SearchInput 自带）。

## 取舍

- **不保留 `?settings=` 参数兼容**：地址是内部导航产物，无外部深链承诺；e2e 同步更新。
- **设置不进侧栏目的地**：AGENTS.md 约束"设置只由顶栏齿轮进入"，齿轮行为从打开浮层改为导航，入口唯一性不变。
- **未识别分区回落**：沿用 SettingsPanel 既有 `?? categories[0]` 行为，深链打错不留空白。
