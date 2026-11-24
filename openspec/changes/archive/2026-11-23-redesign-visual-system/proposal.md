# 桌面视觉体系重设计

## Why

对照真实页面截图审查，当前界面"干净但未打磨"：视觉层级只有两档字号、空状态缺失导致半屏空白、浅色主题是 Tailwind 默认蓝缺乏产品个性、选中/悬停状态三套语言并存、无阴影层次，浏览器预览降级页是占位 Alert。用户决定整体重新设计且不兼容旧 UI，浅色方向取中性冷灰 + 靛蓝的科技感、不绑定现有品牌（品牌与 logo 后续将另行重做），主题 token 集中管理以便将来整体换肤。同时移除 `/design-system` 开发预览页：它复制组件样式用于人工对照，与真实页面持续漂移，且是 7 个 preview 组件的唯一消费者。

## What Changes

- **BREAKING**：全站视觉体系替换，不保留旧样式兼容层。浅色主题从默认蓝 + slate 冷灰换为 zinc 中性色阶 + 靛蓝 `#4F46E5` 主行动色；暗色保留暖炭黑 + 琥珀橙个性，仅微调层次与对比度。
- 主题 token 全量集中到 `src/index.css`：`:root` 补齐 success/warning/info 语义色、`*-weak` 弱底变体与 `--destructive-foreground`，暗色同名对齐；全部映射进 `@theme inline`，组件直接使用语义类。
- 建立四档排版阶梯（页面标题 `text-lg` / 区块标题 `text-sm font-medium` / 正文 `text-sm` / 辅助 `text-xs`）；`PageShell` 描述从 `sr-only` 改为可见副标题。
- 统一全站选中/悬停语言：选中 = 强调底色 + `font-medium`，悬停 = 更浅一档；侧栏"新建工程"从饱和主按钮降为普通入口，保证每屏唯一主 CTA。
- 空状态全面重做：`AppState` 支持对齐变体消除各处 className 覆盖；首页、音色中心、模型中心提供图形 + 说明 + 单一行动的空状态。
- 浏览器预览降级从裸 Alert 换为共享 `BrowserPreviewGuide` 组件（说明 + 示例工程入口 + 桌面端指引）。
- 删除 `/design-system` 路由及其专用 preview 组件与文档引用。
- 追加（评审迭代）：模型/音色中心卡片/表格双视图；模型详情居中弹窗与列表内紧凑传输指示；各后端模型 logo；全局滚动条样式。
- 本变更只动表现层：不改 IPC 命令、传输、持久化与业务逻辑；`components/projects/` 仅重构类名与布局。

## Capabilities

### New Capabilities

- `desktop-visual-system`：主题 token、排版阶梯、状态语言、空状态与浏览器引导的统一视觉规范。

### Modified Capabilities

无。现有规格（voice-library-transfer-ui、native-model-preparation、voice-asset-transfer）约束行为与数据边界，本次不改变其验收要求；`refactor-local-ai-task-runtime` 的前端任务落地时基于本变更后的视觉体系实现。

## Impact

- 代码：`src/index.css`、`src/components/ui/*`、外壳组件（page-shell、library-sidebar、desktop-shell、app-state、route-states）、全部路由页面与 `components/projects/`、`components/voices/`、`components/models/` 的表现层；删除 `src/routes/design-system.tsx` 与 7 个 preview 组件。
- 文档：`docs/brand.md` 主题段（浅色 accent 标注为过渡方案）、`docs/engineering.md` 与 `docs/desktop-studio/interaction-design.md` 中 design-system 引用、README 路线图。
- 协作：在独立 worktree（分支 `redesign-visual-system`）开发，与主工作区正在进行的 `refactor-local-ai-task-runtime` 互不干扰；本分支先行合入后，其前端 §5 基于新体系实现，`components/projects/` 合并冲突届时人工处理。
- 风险：全站换 token 可能遗漏个别硬编码颜色；以全页面 × 亮暗 × 中英截图验收兜底。
