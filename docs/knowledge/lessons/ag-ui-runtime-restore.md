# AG-UI runtime 的受理与恢复边界

日期：2026-11-17。适用于 `@assistant-ui/react-ag-ui 0.1.10`、`@ag-ui/client/core 1.0.4`、Rust `ag-ui 0.5.0-alpha.3`，macOS arm64 与浏览器夹具。

- `runtime.thread.append` 不等待异步宿主受理。直接 await 它后清空草稿，会在受理失败时丢失输入。`DesktopAgent.submit` 单独等待受理结果；错误带会话归属，迟到失败与请求核对结果不能污染新会话。覆盖见 `ag-ui-agent.test.mjs` 和两项 assistant session-race 浏览器用例。
- 仅用 `MESSAGES_SNAPSHOT` 可以展示内容，但不能保证 runtime 将 interrupt outcome 附到正确的活动回复。实际 producer 同时发标准文本与工具生命周期，再发权威快照；runtime 通过完整重放导入一次历史。早期“先导入历史、用尾消息作 parent”的接线已由下述工具-only 根问题回归替代。切页后的问题必须经 runtime 回答，不能只按数据库 pending 绘制一张无法提交的表单。覆盖见 `ag-ui-interrupt.spec.mjs`，包含新 run、同子任务身份、单次回答与草稿保留。
- 官方 runtime 的 runId 是不透明字符串，本版本使用短 nanoid。宿主不能套用旧请求的 UUID 假设；会话/订阅等应用身份仍按各自契约校验。
- 前端 `rxjs` 精确使用 7.8.1，与 AG-UI client 统一实例；额外安装 7.8.2 会因 Observable 私有成员产生类型不兼容。锁文件和 tsc 验证此边界。

宿主仍负责租约、来源与领域权限；这些接线约束不引入旧协议兼容、通用 schema 验证或库命名修复。验收范围见 [validation](../../../openspec/changes/rewrite-agent-ag-ui/validation.md)。

## 2026-11-17：工具-only 根问题必须重放工具生命周期

适用 `ag-ui = 0.5.0-alpha.3`、`@assistant-ui/react-ag-ui = 0.1.10`。真实模型可能只产生 `request_input` 调用而没有可见文字。只重放 `TEXT_MESSAGE_START/END`、消息快照与 interrupt 终态时，页面可读到持久问题，但官方 runtime 的活动助手回复可能没有工具内容，`submitInterruptResponses` 报无可回答中断。

宿主现在从同一权威页补发 `TOOL_CALL_START/ARGS/END/RESULT`，包括原 parentMessageId 和 subagentRunId；增量只发新增调用/结果，不用临时文字撑开消息，不另写中断 reducer。回答按钮等待官方 `useAgUiInterrupts` 与宿主问题身份一致再启用，输入可先填写。普通快照仍负责最终内容与历史，标准生命周期负责流中的关联。

证据：`src-tauri/src/ai/protocol.rs`、`ai::assistant::tests::context::a_native_request_input_tool_persists_one_gate_and_stops_the_model_loop`；公开隔离宿主的完整帧 `tests/fixtures/ag-ui-root-interrupt.json` 在 `e2e/assistant/agent-workspace.spec.mjs` 走官方 runtime 恢复/回答。多问题的原子消费、跨会话和重复消费由 `ai::protocol::tests::necessary_answers_are_atomic_and_cannot_cross_sessions_or_be_consumed_twice` 验证。最终原生复验与 WebView hidden 限制见[工作区验证](../openspec/changes/archive/2026-11-19-redesign-agent-workspace/validation.md)，捕获帧通过不能代替最终原生点击。


真正卸载/重开工程时，先 `thread.reset(fromAgUiMessages(history))` 再跟随同一运行，会把无正文工具回复预先作为已完成历史导入，重放后可能没有可回答 gate。当前只在成功读到宿主页后清空 runtime，再用 `resumeRun({parentId:null})` 跟随标准重放，由官方 runtime 一次导入历史；展示索引继续用宿主消息和官方转换器，不清掉最后内容或重挂载原文。`following` 仅区分只读跟随与当前发送，不把 SDK 重放的 isRunning 当作模型正在执行。恢复失败保留快照和阅读位置，只给重新读取。

回归必须真正卸载工程再打开，不能只切隐藏面板。`the captured native tool-only replay accepts an official answer` 使用工程首页往返复现，保留回答草稿且只产生初次请求和回答请求；`failed history resync keeps the last task and only reads again` 验证读失败不清空、不重跑。`DesktopAgent.submit` 还必须处理官方回答入口的异步校验拒绝，否则等待受理的 Promise 会悬挂。


## 2026-11-17：窗口滑动与受理后停止失败

审查复现两个客户端边界，适用版本同上：宿主有界历史窗口向前滑动时，最新页之外的消息仍属于已经加载的历史，不能只保留手工前置分页的缓存。`DesktopAgent` 现在按消息/记录/运行/子任务身份累积合并，以新页覆盖可变事实；连续窗口保留最早 `before`，不以新窗口替换用户已加载的解释或结果。完全断档的重连窗口会重新开放补读游标，按该游标对应的消息/记录锚点插入缺页；不能仅传播旧 `before=null`，也不能把中间缺页放到最早历史之前。补读期间若出现更晚断档，先保留较新的游标和锚点，再继续只读补齐。测试先加载 1–40，再接收 22–41 和 23–42，验证历史连续、结果不丢且状态更新不重复。

`agent_start` 的成功受理与随后的 `agent_cancel` 失败也必须分开。停止失败不能拒绝已经成功的发送、清掉受理身份或跳过订阅；当前先完成受理并跟随，再将停止失败报告给原会话。新回归覆盖延迟受理期间停止、cancel 失败、仍可接收最终成功，并断言只调用一次 start/cancel。具体审查与候选采用状态修复见[审查记录](../openspec/changes/archive/2026-11-19-redesign-agent-workspace/review.md)。


## 2026-11-17：续跑、回答恢复与会话导航审查

- 专业任务开始后，输入栏会把停止权交给根任务；根任务流必须同时提供停止入口，否则分章、分析与选角运行时整页没有停止操作。`AgentWorkspace` 统一调用根 run 的 `stop`，取消中禁用，不重复派发。
- 官方回答 API 在宿主受理前清除 runtime 的中断状态。核对原请求确认为未受理后，即使用户放弃恢复，也要只读刷新权威历史并重放问题；不能只保留数据库问题卡而让提交按钮永远等待 runtime。回答草稿继续按会话/问题身份保留。
- 新建的未持久化空会话不计入官方已保存会话数；唯一已保存会话仍须可见，不能只根据列表数量隐藏切换器。
- 同轮同名委派必须按当前 producer 的未认领工具事实关联，排除失败与已关联调用；正常的 `status=accepted` 工具结果仍可启动子任务。串行和并发回归防止全部归到第一个调用。
- 续跑会把 invocation 的 run 归属转到新运行，但旧消息仍引用原运行。历史分页同时按消息携带的 producer 身份读取归因，不能只按该页 run ID 查询。回归在续跑后追加另一运行，再读旧页核对工具与子任务归属。

回归入口：`e2e/assistant/session-recovery-regressions.spec.mjs`、`src-tauri/src/ai/protocol/tests.rs`。这些是合成协议/浏览器与宿主回归，不替代原生窗口或真实模型验收。
