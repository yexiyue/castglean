# Tasks

## 1. 数据库基础与模块边界

- [x] 1.1 按 design 的实际职责建立私有 database/ai/jobs 模块入口，锁定 SeaORM 2.x、Apalis 与 SQLite/SQLx 兼容依赖；以 `cargo check`、feature tree 和无重复 SQLite native link 验证，不增加 workspace crate、旧版适配或通用 repository 框架。
- [x] 1.2 定义工程、来源、卷、章节、编辑状态、三张 AI 核心表、分章候选和命令回执 Entity，补齐唯一键、外键及 JSON 校验类型；使用真实临时 SQLite 验证跨工程引用、消息顺序、重复请求及同会话活动执行约束。
- [x] 1.3 实现实体优先新库初始化、结构版本检查、WAL/外键/有限等待配置，隔离 Apalis schema；测试首次启动、同结构重启、初始化失败与未知版本不删库且不启动 Worker。
- [x] 1.4 在 `docs/engineering.md` 记录 Entity/用例/IPC、事务所有者与具名模块边界，并在 `docs/data-format.md` 说明新库结构；核对无已实现迁移或旧格式兼容声明。

## 2. 本地工程与文件来源

实施记录（2026-11-07，Windows，完成）：26 项实施与验收任务已完成。主链已切换到本地工程、冻结来源及通用会话；旧 Recovery、`.castglean` parser/打开保存 IPC、分章专用 Diagnostic DTO/transport 与旧契约测试已移除。最终完整回归：宿主库 184 项、集成 2 项通过，6 项外部条件测试按原配置忽略；AI Node 12 项、播放 Node 9 项通过；fmt、严格 Clippy、rustdoc、TypeScript、构建、Lingui（英文缺失 0）、lint 和规格严格校验通过。真实 Windows 桌面已验证自动保存、失败回滚、方案采用/过期、正常重启、明确重试、长历史、双会话和最小窗口中英文亮暗主题；初始化失败保留数据并安全拒绝迟到 IPC。模型使用本机协议夹具，其他平台、真实模型质量和发布包性能未验证；详见[验证记录](../../../docs/knowledge/lessons/local-storage-windows-validation.md)。

- [x] 2.1 将 project 查询和修改改为数据库自动保存，事务写入目录、卷、编辑状态、撤销及 revision；测试提交回滚、人工修正保留、重启查询与稳定章节身份。
- [x] 2.2 导入时保留原始字节和不可变 UTF-8 正文，先发布文件后提交引用，正文分页按来源 hash 读取；测试中文/emoji/BOM/混合换行、原文件移动、摘要损坏与发布后事务失败。
- [x] 2.3 移除旧 Recovery JSON 读写、旧 `.castglean` parser/打开保存 IPC 和文件最近列表，项目入口改为本地 id；验证存在旧目录时不扫描、不导入、不删除，全文范围校验测试仍通过，不保留兼容 facade。
- [x] 2.4 更新本地工程列表、分章完成导航与自动保存反馈，移除另存为及旧 fileState 关闭条件；验证导入后直接进入工作台、提交失败不伪造成功，现有音色包入口保持可用，并同步 README 对应状态。

## 3. 通用会话与业务事务

- [x] 3.1 实现按任务隔离的会话、分页消息、start/retry/continue 用例，单事务保存用户消息与 queued run；测试同 request_id 重放、不同内容复用 request_id 冲突、同会话并发发送和 retry_of 保留旧记录。
- [x] 3.2 实现共享 parts、合法模型历史投影、模型配置绑定与预算计数，文本/工具事实只保存一次；测试伪造工具历史拒绝、截断工具不作为成功、配置变化确认、重试不重置预算。
- [x] 3.3 将分章工具改接共享会话记录，候选与工具成功结果在同一事务提交，领域校验留在分章模块；测试候选插入失败回滚、过期结果拒绝和人工覆盖保护。
- [x] 3.4 将采用/放弃/撤销改为数据库事务并写幂等回执；测试采用响应丢失重试不重复推进 revision、过期候选拒绝、聊天“同意”不采用；同步数据格式与分章验证文档。

## 4. Apalis 调度与生命周期

- [x] 4.1 在宿主 runtime 装配持久队列、薄 handler 与 Data 依赖注入，payload 仅带 run_id；实现基于 queued run 的可恢复派发，测试保存后未入队崩溃、投递响应丢失和重复入队最终不丢任务。
- [x] 4.2 实现领取 CAS、owner_instance/generation 条件写与终态回读；用真实 SQLite Worker 测试双重领取、旧执行者回写及业务提交后 ack 丢失，断言模型和候选不重复执行。
- [x] 4.3 加入全局与连接并发限制，避免受限连接耗尽所有执行名额；以两个独立会话的可控模型夹具验证实际重叠、同会话串行、等待输入释放名额及单任务失败隔离。
- [x] 4.4 实现持久取消、内存 token 通知与本地工具退出等待，禁止对取消/预算/配置错误自动重试；覆盖排队取消、运行取消、blocking 扫描迟到和停止后终态不被覆盖。
- [x] 4.5 将 graph-flow 存储改接新库检查点，与工具/候选事务边界对齐；测试 review 等待时 Worker 已释放、继续创建新 run、图版本不符停止及已完成业务步骤不重放。
- [x] 4.6 启动时先处理旧宿主在途 run，再启动 Worker，queued 意图恢复派发，running/cancelling 转 interrupted；测试 orphan 重新交付不自动请求模型、用户明确继续可用且预算保留，更新窗口真实任务统计和运行时边界文档。

## 5. 通用流与前端接入

- [x] 5.1 定义通用 AI 命令/恢复 DTO/有序增量 Channel，建立有界回放和 resync_required；测试历史到订阅竞态、重复序号、持久化后通知失败、缓冲缺口、慢消费者和无订阅者执行完成。
- [x] 5.2 用 `src/lib/ai/transport.ts`、stream 投影及 `use-ai-session` 替换分章专用 transport，统一适配 useChat；扩展现有 Node 契约测试验证 StrictMode、卸载只 unsubscribe、重连不 start、已存在助手消息不重复及显式停止调用后台取消。
- [x] 5.3 抽取共享消息/工具摘要/输入组件，分章方案通过类型引用单独查询；验证未知结果 kind 安全回退、人工修改后方案过期同步、错误不暴露原始响应，不新增视觉重设计或前端权威历史副本。
- [x] 5.4 重新导出 Specta bindings 并移除旧 DiagnosticSnapshot 命令、DTO、stream 和仅覆盖旧契约的代码；运行 TypeScript 构建、相关 Node 契约测试、Lingui 提取和 lint，确认无 Rig/SeaORM/Apalis 内部类型泄露。
- [x] 5.5 更新技术选型、工程约定与知识库相关条目，记录官方 SeaORM Entity、Apalis handler 和 AI SDK Transport 实践如何落实到本仓库；核对目录清单与最终代码对应，文档不保留旧兼容/双写或另存为前置要求。

## 6. 集成验收

- [x] 6.1 执行真实桌面闭环：小说导入、本地分章、启动诊断、切页期间继续、恢复历史并订阅、候选审阅采用、退出重启、明确重试；记录真实模型/可控协议夹具证据和未验证平台，不将浏览器预览当宿主验收。
- [x] 6.2 验证长历史分页与两个会话并发时的读写、UI 响应和文件引用完整性，覆盖亮暗主题及中英文必要流程；只测实际改动，不扩展为页面视觉重设计。
- [x] 6.3 运行 `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`、`cargo doc --no-deps`、`pnpm build`、相关 Node 测试及 `git diff --check`；检查依赖方向、无通用冗余层、无旧格式读写路径、任务勾选与 README 状态一致，保留原有用户文件。

## Workflow follow-up

- 实施与验收完成后，按用户要求另行验证/归档；与 `add-assisted-chapter-splitting` 的主规格同步需用本提案替代旧存储及另存为描述，不修改其历史记录，也不放松人工采用和来源约束。
