# 实施记录（2026-11-17）

## 当前结构与数据来源

- `src/lib/ai/task-index.ts` 只读派生任务树：以 invocation ID 归组，以 parentId 嵌套，以父 messageId 放置；同名不合并。结果引用按 kind/id 去重，父工具结果归属于对应任务。
- `AgentWorkspace` 共享工程助手与分章诊断入口；`SessionMessages` 只负责对话与滚动，`MessageRow` 负责安全文本及默认折叠的过程。专业任务区段拥有本轮唯一停止/重试，摘要只定位。
- `AgentQuestionGroup` 在任务内一次提交本轮全部文字答案，使用官方 `useAgUiSubmitInterruptResponses`，以 `DesktopAgent.submit` 等待宿主受理。普通 composer 在等待时收起，回答草稿存于工程 workspace 的 `agentAnswers:<sessionId>`，内部按 interrupt ID 隔离；不写数据库，不承诺跨进程恢复。
- `AgentResult` 读取分章、归属、选角领域的当前状态。分章可报告 pending/adopted/discarded/stale，归属可报告候选状态或初稿已保存。选角领域当前没有整份建议的 adopted 状态，只报告建议保存与有效性，不推导整份建议已采用。
- `AgentPage.runs` 是现有 `ai_run` 记录的只读投影，与历史页消息及最新运行在同一事务读取；不新增表/命令。`contexts` 是冻结上下文，不能用当前阅读章节补齐未知目标。`runs[].retryOf` 保存尝试关系，历史分页合并保持身份。

## 范围

不实现目标/步骤持久化、自动推进、领域决定卡、音频任务或播放卡；这些仍由 `assistant-guided-production` 承担。既有会话和领域数据不转换、不清理。旧逐题表单已删除，现有入口直接切新组件，不提供版本开关。

## 验证

本变更 17/17 项完成；自动化和 macOS 隔离公开工程的真实模型/原生闭环已通过，具体证据、重试记录和未验平台见 [validation](validation.md)。不代表其他在途变更、其他平台或发布包验收完成。

## 可运行夹具

`tests/helpers/analysis-fixture.ts` 只模拟公开数据与 IPC，真实 UI 路由为 `/project/fixture-project?fixture=desktop&analysis=1`。`agentScenario=queued/running/failed/nested/result` 分别覆盖排队、运行、失败、嵌套预审、候选；`agentInterrupt=1` 覆盖挂起，另有 `agentMultiple` / `agentUnsupported`。`tests/fixtures/ag-ui-root-interrupt.json` 是从隔离公开工程捕获的标准宿主完整重放帧，用 `agentNativeRoot=1` 在真实官方 runtime 中回归工具-only 根问题。该帧不包含凭据、私人小说或音频。

审阅前先读领域状态；读取失败只提供重新读取，不执行原模型。归属结果从甲章打开时冻结甲章目标，返回助手恢复先前阅读章、范围及触发器焦点。选角历史引用以原 `runId` 查询建议，不能悄悄打开最新建议。建议的逐目标采用仍由角色中心拥有。


## 读取与受理

运行状态来自宿主 run/invocation；当前本地发送与只读跟随分开，重放不会伪装为模型工作。运行/历史读取失败保留最后内容并标明可能过时，“重新读取”不执行模型。调用成功读到权威页后，runtime 只从完整标准重放导入一次；界面通过同一页和官方消息转换器保持可读内容。根任务独占停止/重试，读取未恢复前禁用重执行；受理之前的停止意图会等到确切身份受理后取消一次。

全书分章/工程选角按冻结 action 显示全局目标，不把请求时的阅读锚点当成任务范围；下次输入上下文仍随阅读章变化。历史/停止的迟到错误不能污染新会话，未消费问题草稿只在权威页确认消费后清理。回答表单沿用局部 React Hook Form、Zod 与 Field，不扩展 schema 表单生成。


## 审查后的维护收敛

2026-11-17：历史合并统一保留已加载事实，并对完全断档的重连窗口重新开放只读补页；中间页按原游标锚点插入，不扰乱已有消息顺序。成功受理与停止失败分离，候选失效只影响 pending，不覆盖人工处理结果。任务索引减少重复全量查找，runtime 恢复与重试控件共用定义。具体问题、两轴复核与验证见 [review](review.md) 和 [validation](validation.md)。
