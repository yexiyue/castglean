# Proposal

## Why

桌面 agent 已接入 AG-UI，但界面仍以消息、通用工具轨迹和结果跳转为主；用户难以快速分清当前查看的章节与实际运行目标、计算完成与候选待采用、读取重试与重新执行。需要用已有 AG-UI 运行、子任务、中断和结果事实重新组织工作台交互，使用户能够判断任务进展、处理必要问题并回到原文继续制作。

## What Changes

- **BREAKING**：直接替换现有 agent 的消息/工具展示、运行提示、中断表单与恢复交互，不保留旧交互分支、双版开关或兼容渲染器；保留新 AG-UI 会话、领域结果和人工修正。
- 原文保持主工作面，助手由会话导航、当前任务摘要、对话/任务流及输入区组成；当前浏览目标和已冻结运行目标分别表达。小窗口使用同一助手与属性检查器之间的显式切换，保留返回位置。
- 专业调用按稳定身份显示任务区段，默认呈现目标、状态、结果和主要动作，子任务、工具、reasoning 与用量按需展开；同名调用不合并，普通对话不强行包装成任务。
- 以同一状态/动作契约覆盖排队、运行、停止中、等待回答、成功、失败、中断、取消、读取失败和受理未确认；候选当前状态单独查询，不能由旧工具成功推断已经采用。
- 必要问题进入所属任务区段，回答草稿按会话/中断隔离；支持已实现的文字回答，提交失败保留输入，继续运行保留分组及历史。恢复、查看、切页均不启动或取消模型。
- 继续复用官方 AG-UI runtime、现有主题、Markdown、shadcn/Base UI 和宿主领域命令；仅按需要补只读展示信息，不重写协议、引擎或领域执行器。

## Capabilities

### New Capabilities

- `agent-workspace`：工程助手任务区段、状态动作、中断回答、输入上下文与恢复交互的统一展示契约。

### Modified Capabilities

- `project-assistant`：单一工作台中助手与原文/属性的协作、结果审阅往返和真实状态的可达操作。

## Impact

- 前端：`src/components/ai-elements/`、`src/components/projects/imported-workspace.tsx`、`chapter-diagnostics.tsx`、`src/hooks/use-ai-session.ts`、`src/lib/ai/agent.ts` 及工作区临时状态。将任务展示拆出大型工作台组件，复用 runtime 的消息/子任务能力，不新造流 reducer。
- 宿主：复用 `AgentPage`、invocations、interrupts、records 和结果查询；如展示必需信息不足，只增加由权威记录派生的只读 DTO/查询并重新导出 bindings，不建立前端业务状态源。
- 与 `rewrite-agent-ag-ui`：后者拥有协议、执行、持久化和旧 agent 数据隔离；本变更消费其成果，不掩盖其尚未完成的原生停止按钮验收。
- 与 `assistant-guided-production`：本变更拥有**现有能力的交互呈现**；后者继续拥有目标/步骤持久化、跨步骤推进、说话人/选声/采用专用决定、助手音频任务/产物/播放卡和相应新工具。通用任务区段和文字中断可被其复用，不算其领域能力已经完成。
- `migrate-ai-elements-shadcn` 已交付的通用组件继续复用；`redesign-production-experience` 的整应用制作体验不由本变更整体交付。实施需验证中英文、亮暗、1024×680/宽窗口、键盘/IME、恢复竞争及 macOS 原生；其他平台证据单列。
- 实施状态（2026-11-17）：现有入口已直接替换；本变更 17/17 项完成，来源及验收边界见 [implementation](implementation.md) 与 [validation](validation.md)。用户日常工程数据未转换或清理。
