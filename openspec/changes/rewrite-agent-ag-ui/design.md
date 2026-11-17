# Design

## Context

动机与范围见 [proposal](proposal.md)。当前 `src-tauri/src/ai/stream.rs` 从 SQLite 消息变化产生自定义 `Update/ResyncRequired`，`src/lib/ai/stream.ts` 维护 `SessionProjection/ResponseStream`，`transport.ts` 再转换为 AI SDK chunks，`use-ai-session.ts` 使用 `useChat`。宿主 `ai/agent.rs` 封装 Rig，`ai/tasks.rs` 派发分章、归属分析和选角；各领域保留校验、检查点和发布事务。这些是重写的现有接点，不是要在旧协议外再加一层转换。

数据约束以源码为准：`database/schema.rs` 当前 SQLite 版本为 8，支持 7→8 升级，`docs/data-format.md` 开头的“其他版本全部拒绝”已落后于实现。新 agent 数据边界必须在明确的事务升级中建立，不能通过清库或拒绝全部已有工程逃避切换。

本设计有跨前后端、依赖和持久化变化，需要独立设计。类型实测及固定来源见 [调研](../../../docs/research/ag-ui-adoption.md)与 [spike](../../../docs/research/spikes/ag-ui-typify/README.md)；实验不算应用实现。

## Goals / Non-Goals

**Goals:**

- AG-UI 是唯一的新 agent UI 协议，前端和宿主一次替换旧接线。
- 复用已验证的协议类型，把授权、执行和领域一致性留在宿主。
- 子任务真实归因、等待人工与继续、后台恢复的可观测行为一致。
- 允许丢弃旧 agent 实现，保留用户工程数据和已有的防重复/人工保护保证。

**Non-Goals:**

- 不新增 HTTP/Node 服务、A2A 通信或另一套 agent 调度框架。
- 不移植整个第三方 server/client runtime，不引入第二个 Tokio runtime。
- 不转换旧 agent 消息、旧检查点或续跑旧任务；不替换声音引擎和章节音频领域。
- 不在本次规划/实验阶段宣称应用已经迁移或完成原生验收。

## Decisions

### D1：复用 ag-ui 的类型，不自持整套类型定义

精确依赖 `ag-ui = { version = "=0.5.0-alpha.3", default-features = false }`。在 `src-tauri` 单一宿主 crate 内通过私有 `ai/protocol.rs` 门面暴露应用实际需要的协议类型，不新建公共 SDK crate。Rig 和声音引擎类型不跨 IPC。

typify 0.10.1 原样生成在 not-null 约束 panic；结构投影虽能生成并保留此次合法 fixtures 的 schema 有效性，但需要自持 schema 降级与补充验证。已实跑的 `ag-ui` 包有全部 31 种事件及 7 类消息的字段表面，合法 fixtures 往返均有效，优先复用现成类型。放弃原 vendor/补齐整套类型路线；typify 只保留为可复现实验，不进入应用 build。

2026-11-17 用户补充决定：直接使用库类型，不修正 capabilities 命名，不为其接受非法输入增加通用 schema 验证器。宿主生产端按标准构造事件，以具体生命周期、消息/工具配对、子 Agent 归因及序列化回归保证自身输出；应用授权、来源校验、幂等和领域校验仍保留。关闭 crate 的 server/client/http/sse 功能，实验中的 schemars 不成为应用依赖前提。

Rust 的 serde schema 不是 TypeScript 权威。TS 直接使用固定兼容版本的 `@ag-ui/core/client`；Tauri Specta 生成应用命令和传输信封，开放 JSON 仅留在协议载荷边界，由官方 AG-UI client/runtime 消费，不为整个第三方类型树再派生第二套 TS 定义。

### D2：IPC 信封与协议载荷分离

新命令覆盖 start、request-status、history/snapshot、subscribe/unsubscribe、ack 和 explicit cancel。启动命令包含 AG-UI `RunAgentInput` 与应用侧 request 身份、工程身份、期望修订和模型选择；宿主按这些值冻结任务并验证完整请求内容。相同受理身份只重放相同请求回执，身份相同内容不同返回冲突。受理响应丢失走只读状态查询，不生成新身份盲目发送。

事件使用类似 `{ cursor, event }` 的传输信封，其中 event 是原生 AG-UI JSON；确认窗口、订阅身份、缺口控制放在信封/命令层，不在每个协议事件增加旧 session/sequence 字段。协议产物经验证后持久化，事务提交后才发布；背压不能阻塞业务事务。新宿主直接产出 AG-UI，不复用旧 StreamEvent→AI SDK→AG-UI 链。

采用有界交付缓冲与权威消息/运行快照；不另立持久事件日志。读取快照和游标在同一一致性边界完成，每次订阅均以当前快照重建完整边界；跳过的提交或缓冲淘汰时显式重建。应用恢复契约提供消息快照、共享状态、子任务/中断与当前运行事实；运行中重连必须形成客户端可消费的完整恢复边界，不能直接发送缺少 START 的 CONTENT。重建不追加虚假的持久执行事实，不再调用模型。为这条路径先做真实 AG-UI runtime 的集成回归，再替换界面。

### D3：宿主权威与执行设施重写边界

重写 `ai` 的会话编排、流、工具事实及任务接线；确定性领域用例和已验证的事务规则可以复用。Apalis 只投递新执行身份；准入、owner/generation 栅栏、来源哈希/修订校验、取消、配置租约与正式计量仍在宿主。模型和磁盘扫描不占写事务，候选与成功工具/结果引用同事务提交。尚未执行的已受理任务可以恢复派发，已经开始的未知远程请求不自动重试。

AG-UI 要求的消息历史不改变授权规则：新用户输入由宿主并入权威历史，已有 assistant/system/宿主工具事实只读；state/context/forwardedProps 只能表达经宿主核对的上下文，不能改写工程目标、模型配置或人工权限。客户端工具白名单默认不包含领域写操作。凭据不进入前端请求、事件或诊断。

### D4：专业子 Agent 与真正的人工中断

每次实际专业调用分配稳定 `subagentRunId`，另记任务种类/展示名称、父子身份、发起工具和消息；供应商 call id 仍只在该独立执行内有效。快捷任务由宿主直接派发，不增加父 Agent 固定路由/总结回合；自然语言委派保持明确目标及宿主受理边界。

章节归属分析和只读预审各有独立上下文与调用身份。生命周期和内容归因由统一发射入口记录，不把 accepted 显示为完成。共享进度采用 `state.tasks[invocationId]` 命名空间，不把 attributed snapshot 当作子 Agent 私有 state。

需要继续计算的人工中断保存 interrupt id、归属、冻结上下文、所需响应及消费状态；本轮产生子 Agent suspended 和 run interrupt outcome，释放 Worker。继续在同一受理事务校验并消费中断，创建关联原运行的新 run，能关联的子 Agent 复用调用身份。失败、取消与挂起分别表达。仅待采用的完整候选保持领域候选状态，不强行挂起模型。中断回答不等于采用授权，采用仍走领域显式命令与修订检查。

### D5：前端直接消费 AG-UI runtime

使用 `@assistant-ui/react-ag-ui` 的 `useAgUiRuntime`，Tauri `AbstractAgent` 的运行事件来自 Channel，history/只读 connect 来自宿主快照和订阅。前端只维护草稿、选择和可丢弃 UI 状态，不再维护另一套权威 SessionProjection。

将 runtime teardown/本地 abort 和用户停止拆开：前者释放订阅，后者显式调用宿主 cancel。不能只靠库默认 onCancel 回调判断用户意图。恢复和分页沿用 runtime 支持的导入边界，先验证其嵌套子 Agent 和中断展示，再补产品任务卡；不预设需要重写库已有的子 Agent 渲染器。

消息、工具、任务卡和输入栏沿用项目 token、共享 Markdown 与 shadcn/Base UI。与 `migrate-ai-elements-shadcn` 已完成的通用组件重用，替代其 AI SDK 专属接线；`assistant-guided-production` 的领域目标推进在本协议基座之上实施，不在本变更顺便扩展制作能力。

### D6：旧 agent 不兼容，领域数据保留

在现有实体上增加明确 agent 协议版本（旧记录标为 legacy），新消息/运行使用新的版本化 payload 和必要的子任务/中断/事件记录。新查询只接受新协议，新 Worker 在 claim 前核验协议版本并忽略旧 payload。旧记录与旧领域外键保留，不转换消息正文/parts，不让旧队列被新 worker 领取；旧活动行不能阻塞新会话。

从当前 SQLite v8 做事务升级，下一版本号在实施时按届时源码确定，不硬编码“必为 v9”；仅补元数据、表/索引和新版本边界，不改写用户正文与人工修正。旧任务可提示“不支持继续，请新建任务”，新助手使用新会话；不为展示旧记录保留旧 agent 协议执行/投影栈。既有领域候选继续通过其领域查询访问。

## Risks / Trade-offs

- [alpha crate 与 schema 存在差异] → 精确锁版本、保留对照实验、验证生产端实际使用的事件输出，不修正库命名差异，不无约束升级。
- [类型 serde 比规范宽松] → 不添加通用非法输入拦截；标准输出与授权/领域有效性由宿主负责。
- [前端库默认 abort/cancel 与后台任务保证冲突] → 专测卸载、切会话、停止和重连，只有显式停止可影响执行。
- [重连缺前置生命周期或重复子 Agent 分组] → 原子快照/游标恢复，真实 runtime 测试活动流、挂起继续和终态恢复。
- [升级触碰旧运行外键或重复派发] → 非空 v8 数据库与队列 fixture 验证，覆盖候选、人工修改和旧活动行；未知版本拒绝，不清库。
- [一次替换范围大] → 按纵向普通对话、工具、专业任务、中断恢复逐步验证，但正式代码只保留新链路，不提供用户旧协议双栈。

## Migration Plan

1. 固定协议来源和类型依赖，通过宿主输出与生命周期测试核验实际使用的事件；实验结果见 validation.md。
2. 实施数据库版本隔离和旧队列领取栅栏，再重写新会话/运行/事件发布与恢复。
3. 接入 Rig 及全部专业任务，用同一领域事务发布结果与工具事实，完成正式评测摘要更新。
4. 切换前端 AG-UI runtime、任务 UI、专业入口和 fixtures；删除旧协议、投影、无引用 AI SDK 依赖。
5. 自动化通过后执行真实模型与原生桌面矩阵，同步工程规范、数据格式和已实现状态。

回滚是代码与数据库版本协调：数据库升级前使用一致性备份，回滚时恢复对应数据库副本；禁止直接让旧程序写升级后的库。备份不是删除旧工程或转换旧 agent 的授权。升级已在隔离测试库验证；不使用用户工程作为升级试验。
