# 验证记录：页面状态锚定

日期：2026-11-15。对应任务 5.1（自动化）与 5.2（macOS 真实窗口）。

## 自动化

- `pnpm test`：22 个测试文件、87 个用例全部通过。
- `pnpm build`：通过（仍有两处既有的动态导入提示）。
- `pnpm lint`：497 条警告，与基线 495–499 条一致，未新增类别。
- `pnpm exec playwright test`：新增 `e2e/workspace/page-state-anchoring.spec.mjs`，断言集合页状态与工具栏的间距小于 160px、状态高度小于 240px、搜索无结果态带放大镜图标、404 保留应用级导航栏且整页居中、候选面板空态带图标。整轮 107 条中 106 条通过，`e2e/voices/binding-route-recovery.spec.mjs` 在整轮负载下等待 fixture 句柄超时失败一次，单独重跑通过，判定为与本次改动无关的既有偶发（该用例不在本次改动路径上）。
- `openspec validate page-state-anchoring --strict`：通过。

## macOS 真实窗口

实例：`pnpm desktop:dev --no-watch`，`tauri-mcp` 桥 `connected: true`、应用标识 `com.yexiyue.castglean`。

- 预置音色搜索无匹配、模型中心搜索无匹配：状态紧跟在搜索框下方，图标 + 标题 + 清除动作，不再漂在页面中部。
- 未知地址：左栏应用级导航栏保留，状态仍整页居中，可从导航栏回到任一目的地。
- 创建音色：右侧「音色候选」面板在无候选时显示图标、标题、说明与下一步，不再是悬在面板顶部的一行文字。
- 1024×680 浅色中文下同样确认过上述三处形态。

## 未覆盖

- 本轮真实窗口检查时，宿主窗口被系统遮挡，网页视图的 `document.visibilityState` 为 `hidden`，因此 CSS 退场动画被冻结，深色主题与英文界面下的三处形态没有重新截图确认；这两项由 `e2e/workspace/desktop-polish.spec.mjs` 在 1024×680 下对全部页面、语言、主题组合的遍历覆盖（无横向溢出、无页面错误）。
- 读屏器实机朗读未测。
