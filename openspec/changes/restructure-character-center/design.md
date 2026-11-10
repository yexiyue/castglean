# Design: restructure-character-center

## Context

角色中心首版（bind-character-voices）把身份操作、绑定、画像、建议审阅、设计候选纵向堆在一列，表单渲染脱离触发上下文；AI 选角只有页面按钮入口，会话结果卡无审阅动作。本变更重构页面结构与选角入口，不触碰绑定域命令、receipts、schema 与 TaleChime。

## Decision 1（D1）：主从结构与选中模型

- 左列（固定宽约 300px）：页头说明 + 搜索框置顶；旁白行置顶；已确认角色行（显示名 + 绑定摘要：音色名或"未绑定"，失效标注；有待审建议的行加标记）；候选角色分组列尾部。
- 右列（剩余宽度，独立滚动）：所选目标详情，分节为「身份」（角色：状态/别名/出现记录/重命名/候选确认与复用）、「声音」（绑定/解绑/使用统计展开）、「画像」、「选角建议」（按目标对照）、「设计」（入口 + 该目标的候选）。
- 选中状态为组件内 UI 态，不持久化；候选角色与绑定目标共用一套选中模型（目标键或候选角色 ID）。
- 窄屏（<1100px）时详情叠放在列表下方，保持单列可达。
- 依据：AGENTS.md「集合优先使用可扫描的列表」「用间距和分隔线表达分组」；建议对照需要与当前绑定同视野。

## Decision 2（D2）：选角指令随消息冻结

- `StoredCastingInput` 增 `instructions: String` 字段，无 serde 默认——升级前中断的旧运行行恢复时反序列化失败，按诚实失败处理（本仓库明确不考虑兼容层）。
- `freeze()` 增 `instructions: &str` 参数：新冻结时存入裁剪后的要求；resume 分支原样复制旧行内容，忽略该参数（要求已冻结）。
- `ai/service.rs` Cast 分支：从 `request.trigger`（`Message`/`Continue` 的 message）提取文本，按字符截断至 4000，传入 freeze；`Retry`（恢复路径）传空串。
- `execute()`：构造 preamble 时若 `input.instructions` 非空，追加「用户对本次选角的要求」原文段落；指令进入子 Agent 上下文但不参与 400 KiB 输入上限的字节计算之外的特殊处理（随 content 一并计入）。
- 指令不暴露到前端读取面（无新 IPC 命令）；建议记录不回显指令。

## Decision 3（D3）：会话入口与结果卡导航

- 入口为**助手自然语言受理**：`cast_voices` 受理工具（requirements ≤2048、一运行一专业任务守卫、`CatalogProvider` 惰性读取目录快照、运行上下文改写 Cast）；assistant 回合结束后路由进选角执行器。输入栏「选角」快捷按钮与前端 cast 通道已移除（宿主 `action:"cast"` 显式通道保留为 IPC 语义）。
- `session-messages.tsx` 结果卡已知 kind 增加 `casting_suggestion`（按钮「审阅选角建议」）；`reviewResult` 增分支：切到 characters 面板并递增本地 `castReviewRequest` 信号。
- 角色中心对 `reviewRequest` 递增做一次性响应：选中首个有待审建议条目的目标（旁白优先）。信号为本地 state，不入 workspace-mode。

## Decision 4（D4）：设计候选的目标关联

- 组件态 `designTarget: BindingTarget | null`：DesignDialog 提交时记录发起目标；候选卡渲染在该目标详情的「设计」区，绑定按钮预选该目标，旁附 NativeSelect 可改选其他目标。
- 无 `designTarget`（理论仅在异常顺序下）时候选渲染在列表列底部作为兜底。
- 关联不持久化：规格本就不承诺候选跨重启保留。

## Decision 5（D5）：组件拆分与复用

- `character-center.tsx`（编排：数据装载、选中、信号、对话框挂载）；
- `character-target-list.tsx`（列表列：旁白/已确认/候选分组、绑定摘要、待审标记、搜索）；
- `character-target-detail.tsx`（详情列：身份/声音/画像分区，聚合建议与设计子面板）；
- `casting-suggestion-panel.tsx`（按目标建议对照，替代并删除 `casting-review.tsx` 全局区；剔除条目集中在其底部折叠区）；
- `design-candidates.tsx`（候选卡 + 预选绑定）；
- 试听逻辑（库参考音频/预置试听/就绪判断）收敛到 `voice-audition.ts` 单实现，供选择器、建议面板、设计候选共用。
- `VoicePickerDialog`/`DesignDialog` 保留现实现，随拆分移入 `character-center/` 目录。

## Decision 6（D6）：明确不动项

宿主命令面（bindings/profiles/suggestion/adopt/usage/references）不变；schema 与 receipts 不变；TaleChime 不变；`bindings.ts` 无新增类型（instructions 不出宿主）。删除旧 `CastingReview` 全局区与页面级游离表单后，无兼容层。

## 审查补充（2026-11-10）

本轮审查修正首版宿主缺陷并调整内部边界，取代 D6 中“不触碰绑定域”的范围限制；现有 IPC 命令及人工采用语义保持。目录装配和反向查询独立于 IPC；选角发布与查询分离。绑定存在性校验及最终删除共用进程内锁，删除确认后复核引用。角色别名和证据来源坐标随任务受理冻结，执行只校验读取不可变正文；不在 SQLite 写事务中读小说文件。工具注册、受理后立即交接和三个专业任务的互斥必须由真实协议与事务测试覆盖。细节见 [审查决定](../../../docs/knowledge/decisions/voice-binding-review.md)。
