# 单章工作流的 assistant-ui 组件调研

2026-11-21。CastGlean 锁定 `@assistant-ui/react 0.15.36` 与 `@assistant-ui/react-ag-ui 0.1.10`。已核对本地导出的 `SuggestionPrimitive`、`useAuiState`、`useAgUiState`、`makeAssistantToolUI` 和 `makeAssistantDataUI`。

| 能力 | 适合的交互 | CastGlean 的接入方式 |
| --- | --- | --- |
| Suggestions 与 `SuggestionPrimitive.Trigger` | 显示会话建议，填入输入框或直接发送提示，例如「为什么这段归属不确定？」 | 可用于自由问答或结果后的解释建议。章节状态栏的主按钮直接打开领域操作或发起已指定章节的用例。[Suggestions](https://www.assistant-ui.com/docs/guides/suggestions) · [Suggestion primitive](https://www.assistant-ui.com/docs/primitives/suggestion) |
| `ThreadPrimitive`、`ComposerPrimitive`、`ActionBarPrimitive`、`useAuiState` | 消息列表、输入、停止及消息操作，订阅会话与消息状态 | 沿用现有对话运行时和消息元素。章节状态栏独立于会话面板，面板关闭时仍可使用。[Primitives](https://www.assistant-ui.com/docs/primitives) · [State hooks](https://www.assistant-ui.com/docs/api-reference/hooks/state) |
| `useAgUiState` | 订阅 AG-UI agent state，让消息区及独立面板使用同一份流式状态 | 后续宿主若发布结构化 workflow state，可将它作为面板的只读视图。现阶段章节和任务信息由 Tauri 快照、生成预检及音频运行查询提供。[Agent state](https://www.assistant-ui.com/docs/runtimes/ag-ui/agent-state) · [Runtime options](https://www.assistant-ui.com/docs/runtimes/ag-ui/runtime-options) |
| Agent Status、Task Tray 与 Recommendation Card | Agent Status 显示运行阶段和耗时。Task Tray 订阅会话内嵌任务并保留已结束的列表。Recommendation Card 适合有候选值、理由和采用动作的建议 | 状态栏组合章节前置条件、宿主阻塞和跨章动作。可借用状态标签样式，候选归属或选角建议更适合 Recommendation Card。[Agent Status](https://www.assistant-ui.com/elements/agent-status) · [Recommendation Card](https://www.assistant-ui.com/elements/recommendation-card) |
| Task Card、Agent Plan、Job Progress 与 Background Runs | 分别展示运行详情、明确的步骤、宿主进度、多个后台任务 | 生成任务卡优先试 props 驱动的 Task Card，由宿主阶段和单元计数填充，复用播放与返回操作。只有持久制作目标提供真实步骤后才展示 Agent Plan。Background Runs 适合以后出现多个并行任务的入口。用宿主任务数组驱动独立用法可保留失败状态和章节跳转。[Task Card](https://www.assistant-ui.com/elements/task-card) · [Agent Plan](https://www.assistant-ui.com/elements/agent-plan) · [Job Progress](https://www.assistant-ui.com/elements/job-progress) · [Background Runs](https://www.assistant-ui.com/elements/background-inbox) |
| `makeAssistantToolUI` 与 `makeAssistantDataUI` | 为已知工具调用绑渲染器，或为宿主发出的命名 data part 绑定最终结果 | 生成工具调用可用 Tool UI 关联运行 ID。若卡片由宿主独立发布，可评估 Data UI，先验证 AG-UI 投影能保留 data part。实时进度仍按运行 ID 订阅。[Tool UI](https://www.assistant-ui.com/docs/tools/tool-ui) |
| Approval Card、Option List 与 Question Flow | 分别采集审批、单组选择、多步问题。官方目录提供独立 props 用法 | 可参考这些组件呈现归属分歧或选角审批。持久回执由宿主处理，卡片完成态根据宿主回执显示。[Approval Card](https://www.assistant-ui.com/elements/approval-card) · [Option List](https://www.assistant-ui.com/elements/option-list) · [Question Flow](https://www.assistant-ui.com/elements/question-flow) |
| Generative UI 与 Interactables | 允许模型从组件目录中选择界面，或让用户与模型协作编辑组件状态 | 可用于开放式结果布局和草稿。单章前置检查由宿主验证，状态栏以确定性规则选择操作。[Generative UI](https://www.assistant-ui.com/docs/tools/generative-ui) · [Interactables](https://www.assistant-ui.com/docs/tools/interactables) |

旧 `assistant-ui/tool-ui` 已归档，其站点改为跳转到官方 Elements。旧注册表依赖 Radix；CastGlean 后续应优先试当前 Elements 的独立用法，并验证 Base UI、窄窗、键盘与本地化。[归档仓库](https://github.com/assistant-ui/tool-ui) · [当前目录](https://www.assistant-ui.com/elements)

本轮保留现有 assistant-ui 依赖，章节状态栏使用工作台已有按钮。后续对话内任务卡可先验证类型化 Tool UI，使用同一个运行 ID 关联章节任务、进度、回到工作台和试听。用户决定继续使用宿主操作回执；组件仅负责展示和发起操作。
