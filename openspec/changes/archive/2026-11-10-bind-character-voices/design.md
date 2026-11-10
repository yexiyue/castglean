# Design

## Context

角色身份、归属片段、人工保护已由 `chapter_analysis` 域持久化（`characters` 稳定 UUID + status + revision；`analysis_versions` 片段归属含 `narrator` 状态）；音色资产由 TaleChime `VoiceLibrary` 文件系统库（`voices-v2/`）管理，预置音色来自引擎目录（`backend+model+voice` 元组，无独立身份）；AI 专业任务复用 `ai_sessions/ai_runs` + 冻结输入表路由（`analysis_inputs` → 归属分析，否则走助手图）；归属分析是 Rig 工具循环，**一次性结构化调用当前没有可复用封装**（仅连接探测用 `output_schema`）。示例绑定 UI 与反向引用组件是纯前端 fixture/已删除，无宿主命令。数据库 schema 当前 v3，迁移为分步事务。

## Goals / Non-Goals

**Goals:**

- 绑定域自成模块，角色域与音色域不为绑定改动核心语义；绑定核心不依赖 talechime/engine 具体类型。
- 选角建议复用专业任务设施（固定目标、隔离上下文、幂等发布），执行为一次性结构化调用。
- 所有采用类操作走显式命令 + 期望修订 + `command_receipts` 幂等，与角色/归属域同构。

**Non-Goals:**

- 章节音频合成、片段试听采用与导出（下一变更）；情绪/演绎规划。
- 工程默认音色与自动传播；音色包格式变更（`.voice` 容器不含描述必填约束，补填发生在入库确认）。
- 旁白实体化（旁白保持归属状态语义，绑定目标用枚举表达）。

## Decisions

### D1 模块划分与依赖方向

新增 `src-tauri/src/voice_binding/`：`types.rs`（ specta DTO，`VoiceRef::Library{id} | Preset{backend,model,voice}`、`BindingTarget::Narrator | Character{id}` 等应用语义类型）、领域纯逻辑（引用校验、建议结果校验、stale 计算）、`store.rs`（持久化/条件更新/审计）、`usage.rs`（使用计数与反向引用）、`commands.rs`、`suggest/`（建议执行器）。遵循单一职责：角色域只读（复用 `character_usage` 模式扩展旁白计数），音色域只暴露目录与描述维护，绑定域不复制两者逻辑。依赖倒置：绑定域定义目录读取所需的抽象（库资产清单、预置音色清单、资产存在性），由 `voices` 与 `engine` 模块实现；`types.rs` 不泄漏 talechime 类型。开闭：音色引用是开放枚举，未来新音色来源（如远程服务音色）新增形态而不改绑定核心校验框架。

*备选*：把绑定塞进 `chapter_analysis` 或 `voices` —— 前者把选角混入分析职责，后者让文件库模块依赖工程数据，均违反边界；否决。

### D2 旁白目标与数据模型（schema v3→v4）

不为旁白造角色实体。绑定目标为 `(target_kind, character_id?)` 复合表达。新增四张表，全部纯新增、无数据迁移：

- `voice_bindings {id, project_id, target_kind, character_id, revision, content}`：每目标一行，content 为版本化 JSON（音色引用、来源 `manual|suggestion{run_id}`、时间戳）；换绑/解绑为行内条件更新。
- `voice_binding_edits {…, binding_id, before, after, revision, operation}`：审计表，对齐 `analysis_edits` 模式，保历史身份。
- `character_voice_profiles {project_id, target_kind, character_id, revision, content}`：画像建议层，content 含文本与来源标识。
- `casting_inputs {run_id PK, content}` / `casting_suggestions {run_id PK, project_id, content, published_at}`：冻结输入与不可变建议记录，对齐 `analysis_inputs/analysis_candidates` 模式；stale 读取时按角色修订摘要与音色目录摘要计算，不存储。

绑定/画像命令携带期望工程修订（同 `ai_runs`），行级 `revision` 防并发；幂等走 `command_receipts`。`schema.rs` 按既有三处步骤升 v4。

### D3 建议任务路由与选角子 Agent

不新增 task kind：走 `project_assistant` + `WorkspaceAction` 扩展 `cast`（`auto|split|analyze` 增为含 `cast`）。`ai_start` 冻结选角输入写 `casting_inputs`；`tasks.rs` 执行路由在 `analysis_inputs` 之后增加 `casting_inputs` 分支。执行与分章/归属同构：共享子 Agent 设施（`Subagent` + 新增 `Casting` 角色，有界回合），选角草稿为纯内存状态机，工具面只有原子提交工具 `finish_casting`——typed 参数、宿主校验、失败事实计数与有界修复反馈，提交成功即发布；解码失败与编造目标走拒绝反馈（有界次），引用不存在的音色按规格剔除并如实记录于建议的 rejected 列表。发布为单事务（建议记录 + run 结果引用 + 幂等回执），重复派发/迟到执行者沿用现有 CAS 语义。输入有界：已确认角色 + 每角色有界证据样本 + 目录（名称/描述/预置清单）；首版为单请求范围，输入超过固定上限（400 KiB）时诚实失败并提示拆分工程或精简目录，分批合并发布作为后续增量、不静默截断。

*备选*：一次性结构化调用（单请求 + 输出 Schema）——绕开统一的专业任务执行设施，失去工具协议的拒绝计数、修复反馈与可观测口径，用户已否决；独立后台任务（voice job 模式）——失去会话/用量/恢复基础设施；均否决。

### D4 目录抽象与失效计算

`VoiceCatalog` 读取接口（库资产、预置音色、存在性）由 `voices`/`engine` 实现。绑定与建议条目的有效性在读取时惰性计算（库 id 存在性、预置元组能否在当前引擎盘点解析），失效不写库、不删记录，与 `split_proposals` stale 同模式。删除库音色前查全库 `voice_bindings` 引用，命中则拒绝并返回工程/目标清单（扩展现有 busy 检查）。

### D5 描述维护与设计路径回填

描述修改命令宿主侧新增；若 TaleChime `VoiceLibrary` 缺少更新描述 API，在同仓库（path 依赖）补最小 API，描述变化重算资产摘要、身份不变（与改名同规则）。设计路径完全复用现有 `start_voice_job`（design/audition）与 `save_voice_candidate`：建议采用「设计草稿」仅产出草稿文本与预填参数，设计候选生命周期沿用音色工作台现状（重启即丢，不承诺恢复）；入库后用户以普通绑定命令引用新资产 ID，不新建回填专用通道。导入路径描述补填在逐项确认 UI 落实，未补填项不发布。

### D6 前端落点：角色中心页面

工程角色入口从过渡弹窗改为工程内页面视图：`CharacterManager` 弹窗退役，角色身份操作（确认/重命名/别名/复用）迁入页面，与绑定区（当前绑定/无效原因/试听）、旁白绑定、声音画像、建议审阅（画像 diff、候选排序+试听、设计草稿编辑）和设计发起（AI 草稿与手动撰写两种入口，手动可预填画像文本）同页承载。页面状态与未提交输入为界面会话状态，切页保留；后台任务走宿主，离开页面不取消。设计任务复用 `start_voice_job` 与全局候选存储，角色中心只展示自己发起的任务与候选，`/voices/new` 音色工作台保持独立的全局创建入口，二者共用设计引擎与入库流程。音色详情重建反向引用组件（真实数据，替代已删除的示例组件）；移除 `sample-voice-bindings` fixture 与示例绑定状态。试听一律走现有指定模型试听命令。

*备选*：继续用弹窗承载绑定（原过渡形态）——信息密度与建议审阅/设计的多步流程超出弹窗承载力，且与「工程角色」入口的语义不匹配；否决。

## Risks / Trade-offs

- [LLM 匹配质量受目录描述薄限制] → 描述入库必填 + 修改能力 + 设计路径兜底；建议剔除非法条目如实呈现，不虚构命中率。
- [TaleChime 可能缺描述更新 API] → 实现首个任务先确认；缺口在同仓库补最小 API，不阻塞本变更契约。
- [全书角色量大导致单请求超限] → 按角色分批合并发布；证据样本有界；批失败呈现部分结果而非静默截断。
- [预置音色目录随模型安装状态波动] → 失效读取时计算 + 原因可见；建议记录 stale 标注，不伪装有效。
- [一次性结构化调用封装为新代码] → 薄封装 + 单元/合成测试；如后续任务需要循环再演进，不在本变更预建。

## Migration Plan

schema v3→v4 仅新增表，无存量数据迁移；未知版本按既有策略停止写入。回滚不需要——新表无旧读者，应用回退后残留空表不参与 v3 读取。前端移除示例 fixture 无用户数据影响。

## Open Questions

- 分批大小与每角色证据样本上限的具体数值（实现时以真实目录与请求容量定，不影响契约）。
- 选角建议是否纳入正式 AI 评测集（跟随项目评测惯例，作为任务清单的验证项在实现时决定深度）。
