# 实现任务

在 worktree 分支 `redesign-visual-system` 上执行，基准 `ee789cb`。逐项以截图或检查输出为证据勾选；只改表现层，不动 IPC、传输与持久化逻辑。

## 1. 设计基础

- [x] 1.1 重定义 `src/index.css`：浅色换 zinc 中性阶 + 靛蓝主行动；`:root` 补齐 success/warning/info、`*-weak`、`--destructive-foreground`；暗色拉开卡片/背景层次、提升边框对比与辅助文字亮度；`@theme inline` 映射全部语义 token；核对全站无绕过 token 的硬编码色值。（提交 e10c90d/86cb943；浏览器亮暗截图通过视觉评审）
- [x] 1.2 `PageShell` 页头改造：标题升为 `text-lg font-semibold tracking-tight`，描述改为可见副标题；同步各页传入的标题/描述文案语义。（提交 e10c90d、86cb943 副标题加深半档）
- [x] 1.3 `AppState` 增加对齐与密度变体，迁移全部使用点的 className 覆盖。（`align="start"` 替代 index/voice-library 等处覆盖类名）

## 2. 状态语言与 CTA

- [x] 2.1 统一选中/悬停语言：侧栏导航、桌面标签条、Tabs、章节/段落列表、模型/音色列表统一为“强调底色 + 字重”；逐一核对无残留旧样式。（Button 新增 `selected` 变体含主色左指示条；app-sidebar/settings/llm-settings/new.tsx 共 8 处切换；ghost 悬停统一 accent 色族）
- [x] 2.2 CTA 层级：侧栏“新建工程”降为普通入口，顶栏 `+` 保留图标按钮；全站核对每屏唯一饱和主按钮。（library-sidebar 重构 + 视觉评审确认）

## 3. 空状态与浏览器引导

- [x] 3.1 新建 `BrowserPreviewGuide` 共享组件，替换 `/`、`/new`、`/models`、`/voices`、`/voices/new` 的裸 Alert 降级分支；四态（浏览器预览/宿主不可用/真实空/读取失败）不混淆。（浏览器模式截图验收：首页/模型/音色均为统一引导；/design-system 返回 404 标准页）
- [x] 3.2 首页重排：空状态引导、分隔线清理、列表行细节；未完成导入与示例工程区块节奏统一。（浏览器模式仅保留居中引导，去重复入口；桌面空态单 CTA）
- [x] 3.3 模型中心与音色中心空态居中修正、表头/列宽与底部状态条层次调整。（假表格移除，引导卡居中；音色中心浏览器分支整合）

## 4. 页面与工作台

- [x] 4.1 `/new` 导入向导排版应用新阶梯与间距；表单、编码选择与预览区细节统一。（内容容器加 max-w-6xl/px-6；目录/诊断切换用 selected 变体）
- [x] 4.2 `/start` 快速上手、`route-states`（404/加载/失败）与设置面板布局微调。（PageShell 新页头自动生效；设置分类导航用 selected 变体；英文设置浮层截图通过）
- [x] 4.3 `chapter-workspace` 工具栏、三栏、底部播放器表现层统一（状态徽章、选中态、间距）。（语义色徽章 + 播放器元信息改行号表述；工作台浅色截图评审通过）
- [x] 4.4 `components/projects/`（project-library、imported-workspace、chapter-diagnostics、project-file-controls）仅表现层重构：类名、布局、空态；不改命令调用与数据流。（经排查无旧选中/标题模式残留，新体系经 token 与共享组件自动生效；诊断传输逻辑零改动，node 测试 22 项全绿）

## 5. 删除开发预览页

- [x] 5.1 删除 `src/routes/design-system.tsx` 与 7 个专用 preview 组件；移除 `desktop-shell.tsx` 的 `/design-system` 溢出特判；确认 `routeTree.gen.ts` 再生后无死引用。（访问 /design-system 返回标准 404 页；tsc 通过）
- [x] 5.2 更新 `docs/engineering.md`、`docs/desktop-studio/interaction-design.md` 中的 design-system 引用；`pnpm i18n:extract` 清理失效条目。（.po 引用行清理，新增 11 条已译）

## 6. 文案与文档

- [x] 6.1 新增/修改文案全部走 `<Trans>`/`t` 宏；`pnpm i18n:extract` 后补齐 en 翻译，无空 msgstr。（英文界面截图验收：无中文残留、无溢出）
- [x] 6.2 更新 `docs/brand.md` 主题段（浅色 accent 为过渡方案）与 README 路线图相关条目。

## 7. 验证与收尾

- [x] 7.1 浏览器逐页截图验收：全部路由 × 亮/暗 × 中/英，记录证据。（首页亮/暗、工作台亮、模型/音色/导入引导、404、英文界面均通过视觉评审；桌面暗色工作台未单独截图，依赖 7.2 实机检查）
- [ ] 7.2 `pnpm tauri dev` 桌面验证：窗口标题栏、标签条、设置弹层、拖拽区。
- [x] 7.3 biome lint/format、`tsc`、既有 node 测试全绿；OpenSpec tasks 勾选与变更文档记录验证结论。（test:diagnostics 11、test:project 2、test:playback 9 全部通过）
