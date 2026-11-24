# 设计说明

日期：2026-11-07。基准提交：`ee789cb`。本变更为纯前端表现层重设计，在 worktree 分支 `redesign-visual-system` 上开发。

## 1. 设计方向

浅色主题取"科技感工具"：zinc 中性色阶（`#FAFAFA` 承托 / `#FFFFFF` 卡片 / `#18181B` 文字）+ 靛蓝 `#4F46E5` 主行动色，摆脱 Tailwind 默认蓝。暗色保留既有暖炭黑 + 琥珀橙个性，仅按截图审查结论微调：卡片与背景明度差拉开一档、边框对比度提升、`--muted-foreground` 提亮约 10%。两套主题的 accent 均为过渡方案：品牌与 logo 将另行重做，届时仅替换 token 值，不动组件。

选择 zinc + indigo 而非暖纸品牌色：用户明确当前品牌不一定保留、浅色要有暗色那类科技感；中性冷灰 + 靛蓝是开发者工具的成熟语言，且不与将来的品牌色预绑定。

## 2. Token 架构

所有主题 token 集中在 `src/index.css` 的 `:root` 与 `.dark`，通过 `@theme inline` 映射为 Tailwind 语义类。命名对齐现有 shadcn 约定（`--success`、`--warning`、`--info`、各 `*-weak`、`--destructive-foreground`），浅色补齐后两套主题 token 完全同名同数，组件不再感知主题。语义色用途：

- `success/warning/info`：文字与图标的状态着色（如资源就绪、降级提示）。
- `*-weak`：状态行、徽章的弱底色块，替代随手 `bg-muted`。
- 组件禁止绕过 token 硬编码十六进制色值（品牌图片资源除外）。

阴影使用 Tailwind 既有 `shadow-xs`/`shadow-sm` 刻度表达层次（背景 < 卡片 < 弹出层），不自造阴影值。

## 3. 排版阶梯

四档，全站一致：

| 档位 | 类 | 用途 |
| --- | --- | --- |
| 页面标题 | `text-lg font-semibold tracking-tight` | PageShell h1 |
| 区块标题 | `text-sm font-medium` | 分区、面板标题 |
| 正文 | `text-sm` | 表单、列表、对话 |
| 辅助 | `text-xs text-muted-foreground` | 说明、计数、元信息 |

`PageShell` 的 `description` 从 `sr-only` 改为可见副标题，与标题构成两级页头。不做更大的展示型字号（该应用是 Operate 型工具界面，Uncodixfy 约束营销式大标题）。

## 4. 状态语言

统一为一条规则：**选中 = 强调底色（accent 系）+ `font-medium`；悬停 = 更浅一档；进行中 = 主色徽章；警告/失败 = 语义色**。适用面：侧栏导航、桌面标签条、Tabs、章节/段落列表、模型与音色列表。消除"下划线 / 底色 / 蓝底徽章"三套并存。CTA 层级：每屏唯一饱和主按钮；侧栏"新建工程"降为普通入口样式，顶栏 `+` 图标按钮保留新建入口。

## 5. 空状态与浏览器引导

`AppState` 增加对齐变体（默认居中、可切换起始对齐），消除使用点大段 className 覆盖；空状态构成 = 图标 + 一句标题 + 一句说明 + 至多一个行动。浏览器预览分支统一用共享 `BrowserPreviewGuide`：解释当前是浏览器示例预览、给出示例工程入口与桌面端指引，替换各页裸 Alert。区分原则不变（AGENTS.md）：浏览器预览、宿主不可用、真实空目录、读取失败四态不得混淆。

## 6. 与并行变更的关系

`refactor-local-ai-task-runtime` 正在主工作区执行，其前端 §5（工程列表改写、`components/ai/` 新建）尚未开始且声明"沿用当前视觉体系"。本分支先合入后，其前端任务基于新 token 与组件实现；`components/projects/` 的合并冲突在合入时人工处理，本变更对该目录只改类名/布局/空态，不动命令调用与数据流，降低冲突面。本分支不触碰 `src-tauri/`。

## 7. 验证策略

浏览器（vite dev）逐页截图：全部路由 × 亮/暗 × 中/英；桌面（worktree 为干净提交状态，`pnpm tauri dev` 可安全运行）验证窗口标题栏、标签条、设置弹层与拖拽区。静态检查：biome、tsc、既有 4 个 node 测试（不涉 UI，应全绿）。i18n：`pnpm i18n:extract` 后补齐 en 翻译，不留下空 msgstr。
