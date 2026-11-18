# Proposal

## Why

工程首页目前以「一工程占一整行」的分隔线列表呈现：每行只有标题、「N 章 / 已自动保存」与一个箭头，信息密度过低，读起来像设置列表而不是工程启动面；底部「示例工程」区块与真实工程使用同构的标题+说明+动作结构，层级不分且占据常驻注意力。用户确认的方向：工程卡片改用网格卡片（带首字标识块），桌面端示例工程入口全部移除（浏览器预览示例是 `novel-chapter-import` 规格要求，保留），把首次引导做进首页本身——新建入口常驻网格，空态给出流程提示。

## What Changes

- 工程首页改为卡片网格：每张卡片为整卡链接（沿用模型中心卡片的圆角、hover 边框与 focus-visible 习惯），左侧为书名首字标识块（accent 底 + accent-foreground 字），右侧标题与章数；未完成导入的草案并入网格，卡片带「继续导入」提示，不再单列分隔线区块。
- 新建入口常驻网格第一格（虚线边框卡 + Plus 图标），页头「新建工程」按钮移除（顶栏加号保留）；搜索框只在已完成工程多于 4 个时出现，位置与模型中心一致（内容列顶部）。
- 桌面端移除示例工程入口：首页「示例工程」区块与快速上手页第一步的「打开示例」按钮删除；`/project/sample` 路由与浏览器预览模式的示例工程不受影响。
- 卡片元信息不再显示「已自动保存」（本地工程必然落盘，属零信息重复）；`LocalProjectStatus` 组件随之删除。
- 不做（明确出范围）：工程排序/固定、卡片缩略图或真实封面、最近打开时间（`LocalProjectListItem` 无时间字段，需宿主扩展，另行立项）、快速上手页其余结构调整。

## Capabilities

### Modified Capabilities

- `desktop-workflow-layout`: 新增「工程首页启动面」要求——卡片网格、常驻新建入口、未完成导入并入网格、桌面端无示例工程入口。

## Impact

- 受影响代码：`src/routes/index.tsx`（主体重构）、`src/components/onboarding/start-guide.tsx`（删「打开示例」）、`src/components/projects/local-project-status.tsx`（删除）、`src/index.css`（新增 `project-card-columns` utility）。
- 测试：`tests/helpers/desktop-fixture.tsx` 增加多工程合成数据；`e2e/workspace/desktop-polish.spec.mjs`、`e2e/workspace/navigation-links.spec.mjs` 断言适配。
- 不影响宿主（src-tauri）与数据格式；浏览器预览示例（`novel-chapter-import` 规格要求）保持不变。
- 验证：vitest 全量、目标 e2e、真实窗口亮暗主题与小窗口截图核对。
