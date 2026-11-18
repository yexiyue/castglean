# Tasks

## 1. 应用级侧栏

- [x] 1.1 `src/components/library-sidebar.tsx`：栏宽收到 56px，三个目的地改为图标按钮（`size="icon"` + `aria-label` + `Tooltip side="right"`），保留 `selected` 强调与 `aria-current`；删除底部「设置」按钮与对应分隔线区块。
- [x] 1.2 侧栏 logo 去掉「CastGlean」字标，退为纯品牌标记（不再链到 `/`）；侧栏宽高与内容居中，窄窗口不出现横向溢出。

## 2. 工程内左栏

- [x] 2.1 `src/components/app-sidebar.tsx`：去掉按钮内的常显文字，改用图标按钮 + 已有 tooltip，保留 `aria-label` 与 `aria-current`。
- [x] 2.2 `src/components/projects/project-workspace.tsx`：`--sidebar-width` 由 `6rem` 收到与应用级栏一致的 56px token；目录列与正文列重新分配宽度。

## 3. 规则与文档

- [x] 3.1 `AGENTS.md` 的「导航直接显示名称」条款改为：导航目的地用图标承载，名称通过悬停提示与无障碍名称提供；模型、音色等共享资源仍保持稳定入口。
- [x] 3.2 同步 `README.md`、`docs/desktop-studio/interaction-design.md`、`docs/desktop-studio/component-interaction-audit.md`、`docs/ui-ux-audit/README.md` 与知识库索引。

## 4. 验收

- [x] 4.1 `pnpm test`、`pnpm build`、`pnpm lint` 与目标 e2e 通过；e2e 中侧栏断言改用 `aria-label` 定位。
- [x] 4.2 真实窗口验收（macOS）：1024×680 与常规宽度、亮暗主题、中英文下确认两处栏形态一致、悬停提示出现、设置只剩顶栏齿轮、logo 不再链接、应用级内容列变宽后表格与分页无溢出。
