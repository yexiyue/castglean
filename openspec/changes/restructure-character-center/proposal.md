# Proposal: restructure-character-center

## Why

角色中心落地后的实际使用暴露出结构性 UX 问题：身份操作、绑定、画像、建议审阅与设计候选四类异质工作纵向堆叠在一列，建议审阅与它作用的目标分离，重命名/使用统计等表单渲染在触发点之外（"点了没反应"类症状的根源），设计候选对全部已确认角色渲染绑定按钮墙。同时 AI 选角是唯一"运行在对话里发生、结果却在别处出现"的专业任务：会话里没有入口（只有页面按钮注入固定文案），结果卡没有审阅动作，用户无法携带要求（如"只配主角"）发起选角。

## What Changes

- 角色中心重构为 master-detail：左列目标列表（旁白置顶、已确认角色含绑定状态摘要与待审建议标记、候选角色分组），右列所选目标详情（身份操作、绑定、画像、建议对照、设计入口与设计候选）。
- 建议审阅从页面顶部独立区块改为按目标在详情内对照呈现（当前绑定 vs 建议并排）；会话结果卡「审阅选角建议」直达角色中心并定位首个待审目标。
- AI 选角融合进工程助手对话：助手以 cast_voices 受理工具委派选角专业任务（requirements 原文保留用户要求，目录快照随受理冻结）；**BREAKING**：移除角色中心页头按钮与会话输入栏选角快捷键，自然语言请求成为唯一入口，结果卡「审阅选角建议」直达首个待审目标。
- 设计候选只呈现在发起设计的目标详情中，绑定操作预选发起目标（可改选），删除全目标按钮墙。
- 目标级表单（重命名、别名、使用统计）在详情内就近渲染，不再落到页面底部。

## Capabilities

- **New Capabilities**: 无
- **Modified Capabilities**:
  - `character-voice-binding`：修改「角色中心页面」（master-detail 结构、建议按目标对照、设计候选预选、表单就近）；修改「选角建议任务执行」（冻结输入包含触发消息中的用户要求）。
  - `project-assistant`：修改「一个助手调用领域能力」（助手自然语言受理选角、结果卡审阅动作）；修改「专业任务与独立子Agent」中的选角入口表述（仅会话入口）。

## Impact

- **宿主**：`voice_binding`（`StoredCastingInput.instructions`、`freeze` 指令参数、`execute` preamble 注入、`CatalogProvider` 读取器）、`ai/assistant`（`cast_voices` 受理工具：requirements ≤2048、一运行一专业任务守卫、目录快照冻结、运行上下文改写为 Cast）、`ai/tasks.rs`（assistant 回合后的选角执行路由）、`ai/assistant.rs`（能力说明纳入选角）。无新 IPC 命令、无 schema 迁移、无 TaleChime 变更。
- **前端**：`components/projects/character-center.tsx` 拆分重构（目标列表/目标详情/建议对照/设计候选）、`casting-review.tsx` 重构为按目标对照面板、`imported-workspace.tsx`（会话工具栏选角动作、结果卡导航信号）、`ai-elements/session-messages.tsx`（`casting_suggestion` 结果卡）。
- **i18n**：中英文目录同步新增文案。
