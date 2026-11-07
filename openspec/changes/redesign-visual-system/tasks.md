# 实现任务

在 worktree 分支 `redesign-visual-system` 上执行，基准 `ee789cb`。逐项以截图或检查输出为证据勾选；只改表现层，不动 IPC、传输与持久化逻辑。

## 1. 设计基础

- [ ] 1.1 重定义 `src/index.css`：浅色换 zinc 中性阶 + 靛蓝主行动；`:root` 补齐 success/warning/info、`*-weak`、`--destructive-foreground`；暗色拉开卡片/背景层次、提升边框对比与辅助文字亮度；`@theme inline` 映射全部语义 token；核对全站无绕过 token 的硬编码色值。
- [ ] 1.2 `PageShell` 页头改造：标题升为 `text-lg font-semibold tracking-tight`，描述改为可见副标题；同步各页传入的标题/描述文案语义。
- [ ] 1.3 `AppState` 增加对齐与密度变体，迁移全部使用点的 className 覆盖。

## 2. 状态语言与 CTA

- [ ] 2.1 统一选中/悬停语言：侧栏导航、桌面标签条、Tabs、章节/段落列表、模型/音色列表统一为"强调底色 + 字重"；逐一核对无残留旧样式。
- [ ] 2.2 CTA 层级：侧栏"新建工程"降为普通入口，顶栏 `+` 保留图标按钮；全站核对每屏唯一饱和主按钮。

## 3. 空状态与浏览器引导

- [ ] 3.1 新建 `BrowserPreviewGuide` 共享组件，替换 `/`、`/new`、`/models`、`/voices`、`/voices/new` 的裸 Alert 降级分支；四态（浏览器预览/宿主不可用/真实空/读取失败）不混淆。
- [ ] 3.2 首页重排：空状态引导、分隔线清理、列表行细节；未完成导入与示例工程区块节奏统一。
- [ ] 3.3 模型中心与音色中心空态居中修正、表头/列宽与底部状态条层次调整。

## 4. 页面与工作台

- [ ] 4.1 `/new` 导入向导排版应用新阶梯与间距；表单、编码选择与预览区细节统一。
- [ ] 4.2 `/start` 快速上手、`route-states`（404/加载/失败）与设置面板布局微调。
- [ ] 4.3 `chapter-workspace` 工具栏、三栏、底部播放器表现层统一（状态徽章、选中态、间距）。
- [ ] 4.4 `components/projects/`（project-library、imported-workspace、chapter-diagnostics、project-file-controls）仅表现层重构：类名、布局、空态；不改命令调用与数据流。

## 5. 删除开发预览页

- [ ] 5.1 删除 `src/routes/design-system.tsx` 与 7 个专用 preview 组件；移除 `desktop-shell.tsx` 的 `/design-system` 溢出特判；确认 `routeTree.gen.ts` 再生后无死引用。
- [ ] 5.2 更新 `docs/engineering.md`、`docs/desktop-studio/interaction-design.md` 中的 design-system 引用；`pnpm i18n:extract` 清理失效条目。

## 6. 文案与文档

- [ ] 6.1 新增/修改文案全部走 `<Trans>`/`t` 宏；`pnpm i18n:extract` 后补齐 en 翻译，无空 msgstr。
- [ ] 6.2 更新 `docs/brand.md` 主题段（浅色 accent 为过渡方案）与 README 路线图相关条目。

## 7. 验证与收尾

- [ ] 7.1 浏览器逐页截图验收：全部路由 × 亮/暗 × 中/英，记录证据。
- [ ] 7.2 `pnpm tauri dev` 桌面验证：窗口标题栏、标签条、设置弹层、拖拽区。
- [ ] 7.3 biome lint/format、`tsc`、既有 node 测试全绿；OpenSpec tasks 勾选与变更文档记录验证结论。
