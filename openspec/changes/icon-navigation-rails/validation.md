# 验证记录：图标导航栏

日期：2026-11-15。对应任务 4.1（自动化）与 4.2（macOS 真实窗口）。

## 自动化

- `pnpm test`：22 个测试文件、87 个用例全部通过。
- `pnpm build`：通过（无新增错误；仍有两处既有的动态导入提示）。
- `pnpm lint`：496 条警告（基线 499 条，未新增类别）。
- `pnpm exec playwright test`：106 条全部通过（9.6 分钟）。其中新增 `e2e/workspace/icon-navigation.spec.mjs`，并同步修正 `e2e/workspace/project-navigation.spec.mjs` 与 `e2e/settings/resource-layout.spec.mjs` 的侧栏断言（改用 `aria-label` 定位，导航项几何为 36px / 左内边距 0px / 圆角 10px）。
- `openspec validate icon-navigation-rails --strict`：通过。

## macOS 真实窗口

实例：`pnpm desktop:dev --no-watch`，`tauri-mcp` 桥 `connected: true`、应用标识 `com.yexiyue.castglean`、桥与 CLI 均为 0.13.2。窗口逻辑宽度 1360×859 与 1024×680 各验一轮，主题浅色与深色、界面语言中文与英文各验一轮。

- 应用级侧栏：栏宽 56px，顶部为纯品牌标记（不可点击、不再链到 `/`），其下是三个 36×36 图标项，`aria-label` 分别为「工程 / 音色中心 / 模型中心」（英文为 Project home / Voice center / Model center），选中项保留强调底与 `aria-current="page"`；侧栏内已无「设置」按钮，设置只由顶栏齿轮进入。
- 悬停提示：悬停「音色中心」约 1–2 秒后右侧出现提示气泡（`[data-slot="tooltip-content"]`，位于栏右侧 x=56），英文会话下显示 “Voice center”。
- 工程内左栏：同样 56px，三个分区为纯图标（`aria-label`「章节制作 / 工程角色 / 制作结果」），悬停「章节制作」在栏右侧出现同名提示。
- 音色中心：应用级内容列变宽后，预置音色表格与分页（139 项、每页 20）在 1360×859 与 1024×680 下均无横向溢出，表格仍在容器内滚动，粘附表头未遮挡首行。
- 亮暗与中英：深色主题与英文界面下两处图标栏对比度、强调色与提示气泡正常，图标与顶栏齿轮不依赖颜色单独表意。

## 未覆盖

- 读屏器（VoiceOver）实机朗读未测，只验证了无障碍名称、焦点顺序与 `aria-current`。
- Windows 高分屏下提示气泡的位置与遮挡未实测。
- 主题与界面语言是会话内状态，宿主未持久化；重启应用后回到浅色中文（既有行为，与本次导航改动无关）。
