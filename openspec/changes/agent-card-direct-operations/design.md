# Design: 助手结果卡就地领域操作

## Context

- 三个专业任务共用 `DelegatedToolCard`（折叠行 + 子代理嵌套消息 + `AgentResult` 状态卡）；`AgentResult` 对三种结果引用统一渲染「摘要 + 状态 + 跳转按钮」，跳转目标分别为检查器（chapter_analysis）、分章审阅弹窗（chapter_split_proposal）、角色中心（casting_suggestion）。
- 各域命令面已齐备且幂等：选角采用（`voiceBindingAdoptBinding/AdoptProfile`）、分章整套采用（`structure` 操作族）、归属候选操作（`candidate-operations.ts` 注册表，`selected: string[] | null` 支持 null=全部有效片段）。
- `cast-review-in-agent-card`（0/12）已设计选角卡内审阅切片，本 change 吸收其范围后该 change 移除。
- 布局稳定分流原则：编辑型→就地替换，参考型→Popover，异步出现→滚动流内追加。卡片操作遵循此分流。

## Goals / Non-Goals

**Goals**
- 卡片框架统一：三段式（展示行/进度/结果面）替代现状的临时拼装。
- 三个专业任务的结果卡承载就地领域操作，全部走既有命令。
- 结果面与专职界面读同一权威数据，卡内操作后两处一致。

**Non-Goals**
- 不新增宿主协议或写路径；持久化交互请求（说话人分歧、异步任务卡）仍归 `assistant-guided-production`。
- 不迁移段级归属修正（检查器职责）、章节边界细调（审阅弹窗职责）、设计入库确认（角色中心职责）。
- 不改变中断审批（CastingApproval）机制。

## Decisions

### D1 卡片注册表：toolName → 三段式卡片
`DelegatedToolCard` 泛化为按 `delegatedToolNames` 注册的统一卡片：展示行保留现有状态图标与耗时；进度段由 `DelegatedToolContext.castingProgress` 推广为按引用类型取进度（当前仅选角有跨条目进度，其余域为空则不渲染）；结果段由新的结果面分发器渲染。备选（每工具独立卡片组件）被否：三张卡的展示行/折叠逻辑已重复三份，注册表一次收敛。

### D2 结果面按引用类型分发
`AgentResult` 拆为「状态行（通用，兜底未知类型）+ 结果面（按 `ResultReference.kind` 注册）」：
- `casting_suggestion` → 逐目标手风琴行 + 就地 `CastingSuggestionPanel`（数据接线同 cast-review 设计 D4：`voiceBindingSuggestion/Bindings/Profiles` + `useModelResources` + `useVoiceStudio` 就地实例化）。
- `chapter_split_proposal` → 差异摘要 + 整套采用/放弃（走 `structure` 操作族注册表；细调入口打开既有审阅弹窗）。
- `chapter_analysis` → 候选状态 + 采用（全部有效片段，走 `candidate-operations` 注册表）/放弃/重分析入口 + 「逐片段修正」跳检查器。
- 渲染锚点：toolkit 注册为 standalone 的调用（`analyze_chapter`、`check_splitting`）由卡片在折叠态外自带结果面；`cast_voices` 经消息级结果区渲染（其调用不进 toolkit——实测 toolkit 注册会连带正文阅读器回归，机制未明，取消息级等价锚点）。进度条同样锚定在消息级结果区、工具行之下。

### D3 上下文经 `DelegatedToolContext` 注入
`DelegatedToolContextValue` 扩展：`castingProgress`、`projectRevision`、`analysisRevision`、`structureOperations`、`candidateOperations`、`onStructureChange`、`onAnalysisSaved`、`onDesignInCenter`、`targetName`。全部由 `agent-workspace` 组装 provider 时注入（工作台经 `domain` prop 传入），结果面组件不直接读工作台全局状态。跳检查器/审阅弹窗/角色中心的入口复用既有 `onReview` 路径，不另设回调。

### D4 就地操作 = 既有命令的就地调用
各域操作直接调用现有命令，期望修订与幂等语义由命令自带；卡内冲突处理统一为「显示冲突 + 重新读取」模式，与 `agent-result.tsx` 现有失败重试一致。归属候选采用走 `candidate-operations.ts` 注册表（保留 write/read 相位与 beforeunload 守卫），不为卡内另开请求通道。

### D5 卡内显示状态与专职界面同源
结果面状态查询复用各域现有读取命令（`voiceBindingSuggestion`、`splitProposal`、`chapterAnalysisCandidate`），沿用 `AgentResult` 现有 `version` 触发复读机制；卡内采用后由操作回调触发同通道刷新，两处天然一致。

### D6 吸收并移除 cast-review-in-agent-card
其 proposal/specs（会话内选角建议审阅，原文移入本 change）、design D3-D5、tasks 的选角部分并入本 change；该 change 目录删除（0/12 未实施，无归档价值），知识库索引行改指本 change。

## Risks / Trade-offs

- [结果卡纵向变长，对话流被压缩] → 结果面默认摘要态 + 「展开审阅」就地替换（编辑型分流），窄窗口纵向堆叠已验证；卡内不做弹窗叠弹窗。
- [归属「采用全部」误用] → 采用前卡内显示片段计数与来源摘要；段级差异必须经检查器确认保护，卡内采用语义与检查器「全部采用」一致，无新语义。
- [三个域操作面板复用组件的 props 依赖不同] → D3 注入统一上下文，域内差异收敛在各结果面组件内，不外溢。
- [与 assistant-guided-production 未来任务卡的关系] → 本 change 的三段式卡片是它的展示层基座；其宿主侧交互请求落地时按引用类型注册新结果面，不需要重构本框架。

## Migration Plan

实现顺序：框架（D1-D3）→ 选角结果面（吸收 cast-review 任务）→ 分章结果面 → 归属结果面 → 删除 cast-review change 与索引更新 → 回归与验收。前端提交可整体回滚，无持久化迁移。

## Open Questions

（无阻塞项。归属「重分析入口」复用现有快捷任务通道还是结果卡独立按钮，实现时按输入工具栏现状定。）
