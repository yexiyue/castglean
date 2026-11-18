# Proposal

## Why

上一轮修完「我的音色」空状态后复查了应用里的其他空状态页面，发现同一类问题在多处重复出现：

1. **集合页的状态漂在页面中部**。`Empty` 基座带 `flex-1 + justify-center`，在列表页的 flex 列里会撑满剩余高度并垂直居中，于是预置音色「没有匹配的音色」、模型中心「没有匹配的模型」「正在读取模型目录…」都掉到页面中间，离上方的搜索框、模型筛选很远；模型盘点需要 15–40 秒，这期间页面几乎全白，只剩中间一个转圈，看不出页面在做什么。
2. **同类状态形态不一致**。模型中心的「没有匹配的模型」有放大镜图标，预置音色的「没有匹配的音色」用了 `compact` 变体所以没有图标，两处是同一种「搜索无结果」，用户却看到两种样子。
3. **路由级状态没有应用外壳**。`PageShell` 才渲染应用级导航栏，而 `route-states.tsx` 自己渲染 `<main>`，所以未知地址、路由加载失败这两页整条左栏消失，和其他页面不像同一个应用。
4. **创建音色的候选面板没有空态**。右侧「音色候选」在没有候选时只有一行说明文字浮在面板顶部，下面是整片空白，分不清是「还没生成」还是「没加载出来」。

这些都不是功能缺陷，而是界面契约没有规定「状态出现在哪里、是什么形态」，导致同类状态在不同页面各写各的。

## What Changes

- 集合页（模型中心、预置音色、我的音色、音色设计引擎列表）的空态、搜索无结果态与加载态统一锚定在所属工具栏/列表区顶部，不再脱离上下文漂在页面中部；同类状态使用同一形态（图标 + 标题 + 动作）。
- 路由级状态（页面未找到、路由加载中、路由加载失败）保留应用外壳与应用级导航栏，形态与其他页面一致。
- 创建音色的「音色候选」面板在没有候选时给出明确空态：图标、标题、说明与下一步，去掉悬在空面板顶部的那一行文字。
- 明确不做：整页 404 的居中形态（那是整页状态，仍应居中）；不改任何业务逻辑、数据格式与宿主命令；不改浏览器预览行为；不新增通用空状态组件。

## Capabilities

### Modified Capabilities

- `desktop-interface-consistency`: 「全页面可读与可操作」补充集合页状态锚定与路由级状态保留应用外壳的要求。
- `desktop-workflow-layout`: 「创建任务优先」补充候选面板空态的要求。

## Impact

- 受影响代码：`src/components/app-state.tsx`（新增锚定形态）、`src/components/voices/voice-library.tsx`、`src/components/models/model-center.tsx`、`src/components/voices/my-voice-library.tsx`、`src/components/voices/design-resources.tsx`、`src/components/route-states.tsx`、`src/components/voices/voice-studio-page.tsx`。
- 受影响文案：预置音色的搜索无结果态与创建音色的候选面板说明（需重新 extract Lingui 目录）。
- 文档：`README.md`、`docs/desktop-studio/interaction-design.md`、`docs/ui-ux-audit/README.md`、知识库索引与决策记录。
- 不改变路由、数据格式、宿主命令与工程数据。
- 验证：`pnpm test`、`pnpm build`、`pnpm lint`、目标 e2e 与 macOS 真实窗口（集合页三种状态、404、创建音色空面板）。
