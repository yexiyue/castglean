# Design: 选角审阅收进 AI 会话工具卡片

## Context

- 现状：`DelegatedToolCard` 对 `casting_suggestion` 引用在 `ToolFallbackContent` 内渲染 `AgentResult`（仅状态 + 「查看结果与审阅状态」按钮），折叠态不可见；试听生成进度由宿主 `AgentPage.castingProgress` 提供、渲染在线程尾部 `ThreadTrailing`（`agent-workspace.tsx`），与 `cast_voices` 工具调用无视觉关联。
- 逐目标审阅的完整实现已存在：`CastingSuggestionPanel`（候选列表/理由/试听/采用绑定/采用画像/设计草稿入口/失效标注），角色中心经 `voiceBindingBindings` + `voiceBindingProfiles` + `voiceBindingSuggestion` + `listModels`（`useModelResources`）+ `useVoiceStudio` 提供其数据。
- 采用命令（`voiceBindingAdoptBinding` / `voiceBindingAdoptProfile`）带期望工程修订与绑定修订，冲突拒绝语义已在规格与实现中验证。
- `add-casting-preview-approval` 已实现未归档；本 change 的规格差量与其无重叠，归档须在其后。

## Goals / Non-Goals

**Goals**
- 会话内就地完成候选试听与采用，复用而非复制角色中心的审阅逻辑。
- 进度与结果锚定在 `cast_voices` 结果处，折叠态可见。
- 卡内采用后两处状态一致（同一权威数据源，读时一致）。

**Non-Goals**
- 不把设计入库确认流程搬进会话卡片（保持角色中心）。
- 不改宿主协议、数据格式或采用命令语义。
- 不改动选角审批中断/恢复链路（`add-casting-preview-approval` 已覆盖）。

## Decisions

### D1 复用 `CastingSuggestionPanel`，不写精简列表
卡内审阅容器按目标渲染该面板。理由：采用校验、目录失效标注、预览复用、设计草稿分流均已在该组件验证；另写精简列表会产生第二套采用逻辑，违背「模型建议须过应用校验」与单一事实源。备选（精简行内列表）被否：看似轻，实则复制判断。
适配代价即接线工作：容器负责取数并逐目标传入 props。面板现有 props（`disabled`、`onAdopted`、`onDesign`）全部可用，无需改组件签名。

### D2 结果区外提到工具卡片折叠态之外
`DelegatedToolCard` 中 `casting_suggestion` 引用与 `chapter_split_proposal` 同样渲染在 `ToolFallbackRoot` 外层（分章卡已有先例），子代理嵌套消息仍留在折叠区。理由：用户批准后最关心的就是结果与进度，不应藏在需要展开的区域；这也是截图反馈的直接根因。

### D3 进度经 `DelegatedToolContext` 注入，`ThreadTrailing` 移除该块
`DelegatedToolContextValue` 增加 `castingProgress?: CastingProgress | null`，由 `agent-workspace` 组装 provider 时从 `ai.snapshot` 带入；卡内在 `reference.kind === "casting_suggestion"` 且 progress 非空时渲染进度（复用现有 `Progress` 展示与「正在整理选角建议」文案），生成结束（progress 变空）自动过渡到审阅面板。线程尾部独立进度条删除。数据源不变，仍只在活跃 run 期间由宿主计算。
备选（AgentResult 直接读 `useWorkspace`）被否：`AgentResult` 是三种结果共用的通用组件，注入领域数据会破坏其边界；context 是现有投影通道（`projectId`/`version`/`onReview` 已走此路）。

### D4 卡内容器自己取数，与角色中心同一命令面
新容器组件（`assistant-ui/tools` 下）展开时拉取 `voiceBindingSuggestion` + `voiceBindingBindings` + `voiceBindingProfiles`，模型经 `useModelResources`，`studio` 经 `useVoiceStudio()` 就地实例化。两处同时打开时各持订阅快照、共享宿主作业队列，采用走同一事务命令，读时一致。
`projectRevision` 经 `DelegatedToolProvider` 注入（与角色中心同源），`onAdopted` 在容器内重新拉取建议与绑定并靠既有 `version` 通道触发结果状态复读。

### D5 设计草稿经外部预填通道跳角色中心
`DelegatedToolContextValue` 增加 `onDesignInCenter(target, draft)`：实现位于 `imported-workspace`，复用现有 `reviewResult` 的 casting 分支定位（切 characters 面板 + inspector），并新增向 `CharacterCenter` 预填 design 状态的通道（与 `castReviewRequest` 同模式：先挂起、数据就绪后选中目标并打开设计）。设计入库确认保持角色中心内完成。

### D6 「在角色中心打开」保留为次级入口
审阅面板旁保留跳转按钮（现有 `onReview` 路径），服务于身份操作、画像编辑与设计发起等卡片外操作。与导航栏「同一目的地一个入口」不冲突：这是上下文动作，非导航目的地。

## Risks / Trade-offs

- [窄窗口下完整面板过宽] → 会话列按现有断点处理：窄宽度下面板纵向堆叠（面板自身 flex 布局已支持），e2e 窄窗口用例覆盖卡内审阅。
- [双 `useVoiceStudio` 实例] → 实例仅是订阅与队列客户端，宿主侧串行执行；播放与设计任务互不冲突。验证时确认两处作业列表各自如实。
- [卡内与角色中心并发采用] → 期望修订校验拒绝后者并如实报错，无半套变更；作为验收场景而非防御代码。
- [历史会话回看无进度] → `castingProgress` 仅活跃 run 提供，回看直接呈现审阅面板或「建议未发布」真实状态，符合现有语义。
- [截图反馈的「run 结束无最终答复」可能另有恢复链路问题] → 本 change 修复结果区不可见的一半；是否仍存在真实失败路径，在实现前用原会话复现定性，结论记入验收。

## Migration Plan

无数据迁移。实现顺序：容器与接线（D3/D4）→ 结果区外提（D2）→ 进度迁移与尾部移除（D3）→ 设计跳转通道（D5）→ 回归与验收。回滚即还原前端提交，无持久化影响。

## Open Questions

（无阻塞项；D5 通道的具体 props 命名在实现时定即可。）
