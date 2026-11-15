# Tasks

## 1. 首页卡片网格

- [x] 1.1 `src/index.css` 新增 `project-card-columns` utility（与 `resource-card-columns` 同区）；重构 `src/routes/index.tsx`：工程卡片（首字标识块 + 标题 + 章数，整卡链接，模型中心 hover/focus 习惯）、未完成导入并入网格（「继续导入」卡片）、新建卡常驻第一格、页头「新建工程」按钮移除、搜索仅在已完成工程 > 4 时显示于内容列顶部、空态欢迎引导加流程提示、删除示例工程区块与 `LocalProjectStatus` 引用；`pnpm build` 通过。
- [x] 1.2 `start-guide.tsx` 删除第一步「打开示例」按钮；确认 `/project/sample` 与浏览器预览引导不受影响。
- [x] 1.3 空列表时新建入口与欢迎引导同屏：网格在桌面端常驻（新建卡在第一格），搜索同时覆盖草案与已完成工程，空列表说明不再重复给出同一个新建动作。

## 2. 文案与测试

- [x] 2.1 `pnpm i18n:extract`，补 `src/locales/en/messages.po` 新增条目翻译，清理废弃 msgid。
- [x] 2.2 `tests/helpers/desktop-fixture.tsx` 支持多工程合成数据；更新 `e2e/workspace/desktop-polish.spec.mjs` 与 `e2e/workspace/navigation-links.spec.mjs`（首页卡片、搜索阈值、无示例断言、未完成导入键盘语义），`pnpm test` 与目标 e2e 通过。

## 3. 验收

- [x] 3.1 真实窗口验收：亮暗主题、中文文案、小窗口（约 700px 宽）核对网格换行、新建卡常驻、无示例区块、hover 与 focus-visible 态；空工程形态如具备条件一并核对。
