# 工程与离线数据格式草案

## 本地数据库

应用私有目录中的 `castglean.sqlite3` 使用 SQLite `user_version` 标识当前结构。空数据库一次创建所有当前实体和索引，其他版本明确拒绝，不执行升级。工程、来源、分析、助手任务、音色绑定和章节音频均由宿主持久化；队列由 Apalis 独立初始化。原始小说和解码正文保存在受控文件中。

工程和分章诊断主链已改用新数据库与通用 AI 协议。`local_project_*` 支持本地工程创建、列表、查询、小说导入、信息/目录修改和单步撤销，提交成功后自动保存。旧 Recovery、旧 `.castglean` parser/打开保存 IPC 和最近文件列表已移除；没有迁移、双写或工程导出。既有用户文件不会自动扫描或删除；任务完成状态及平台边界以[验证记录](knowledge/lessons/local-storage-windows-validation.md)为准。

新来源位于应用数据目录 `project-sources/<sha256>.raw` 和 `<sha256>.txt`，两套摘要分别校验；路径由宿主推导，不使用数据库中的外部路径选择文件。先以不覆盖已有文件的方式完整发布，再事务提交元数据；失败可留下未引用文件，本轮不自动清理。撤销 JSON 不嵌入正文，通过原来源元数据和摘要读取文件。当前目录、卷、章节、编辑状态与工程 revision 一次提交，修改使用期望 revision 条件更新；来源 id 不得重绑定不同内容。查询列表只读工程元数据，正文解码、摘要验证与文件读写在 IPC 的 blocking 工作中执行。

本地工程新入口现将查询投影放在 `project/query.rs`：列表只返回名称、修订及来源/章节计数，不读取正文；工程快照返回来源摘要、目录和编辑设置，不含全文。`project/edits.rs` 处理信息、规则、边界和人工卷修改，目录、撤销、revision 与命令回执共同提交；相同命令重放原回执。正文分页通过来源所属工程及数据库 hash 选择不可变 UTF-8 文件，拒绝跨工程来源和损坏摘要。

TXT 选择先冻结原始字节，仅在当前宿主内存保存待确认文件（总量至多 128 MiB，单文件至多 32 MiB），预览与确认不重新打开外部路径；尚未确认的选择不承诺跨进程恢复。确认发布原始/UTF-8 文件后，在同一事务写来源、分章、编辑状态和导入回执；失败保留选择供重试，成功释放选择。相同 command id 可在选择释放后重放结果，重复并发确认只提交一次。前端主链已接新入口；宿主返回提交快照后显示自动保存。

通用会话用例已接入 `ai_sessions`、`ai_messages`、`ai_runs`。会话按工程、任务类型及可选章节隔离；消息有稳定 ordinal、版本及 parts，历史按 ordinal 向前分页，恢复结果带同一读事务取得的会话 sequence 与最近 run。发送命令只接收用户输入和显式绑定，不接受客户端 system/工具历史；用户消息与 queued run 同时提交。相同 request_id 只重放相同请求，不同内容返回冲突；重试/继续创建关联旧记录的新 run，并保留累计用量统计。错误只返回已知分类，未知内容退回 unknown。新的分章工具和 Apalis Worker 已接入；前端分章诊断已接通用会话协议，桌面回归仍在进行。

`ai_runs.budget` 使用版本化 Ledger：`version: 1`、`total` 累计用量统计、当前执行的 `turnRequests` 和可空的 `requestInputBytes`；会话只保存累计用量统计。实际 HTTP 请求字节数替换本次预留字节，重复记录同一请求字节不会重复累加；重试继承会话总量，仅重置本次执行的轮数。2026-11-07 起请求、工具尝试和结果字节作为观察统计，不再设置正常会话的单轮/累计配额；未知 Ledger 版本仍拒绝读取/修改，不自动重置。消息通过 id/期望 version 更新，已完成事实不能覆盖；执行写入以宿主实例和 generation 作为事务栅栏。运行中取消仅提交 cancelling 意图，不能由 IPC 提前确认本地工具已退出。

应用初始化时使用独立 `ai-runtime.lock` 保证只有一个活跃 AI 宿主所有者，然后把旧宿主的 running/cancelling 执行转为 interrupted，保留预算及已完成工具。未完成消息和工具标为中断，queued 意图保持原样；随后装配持久 Worker 并协调 queued 派发；已经开始的旧 run 不自动模型续跑。模型历史投影只重建完整调用/结果配对，失败结果带错误标记，截断工具和未完成助手正文不作为已完成历史发送；UI 历史仍完整保留。

分章候选使用 `split_proposals` 的版本 1 内容：章节、卷、规则、人工修正、异常和增删行摘要；不包含正文。候选与工具成功 part、结果引用及结果字节计数在同一事务提交。查询时按当前工程 revision/来源摘要计算 stale；采用、放弃通过独立 IPC，聊天文字不具有采用权限。已完成工具事实不随候选采用/撤销而改写，界面应通过候选引用查询当前状态。

通用订阅已使用独立于历史查询的有序 Channel：每个提交包带协议 version、sessionId、runId 和 sequence，包含当前会话/执行摘要，以及消息替换或文本追加。追加文本使用 fromVersion/version 和 offsetUtf16，方便 WebView 按 JS 字符串长度校验；这不改变原文标注的 UTF-8 字节范围。历史按页读取，流不传整个工程或全量历史。

回放只在内存保留：至多 32 个会话缓冲，每会话至多 8 个提交包且最多 1 MiB；每个订阅最多 8 个未确认包，客户端消费后 acknowledge。缺口、宿主重启或慢消费者收到 resync_required 后重新读取历史，不发启动命令；关闭订阅和读取取消不会取消后台 run。数据库提交成功后的通知失败不改变已提交结果，订阅注册与发布互斥，订阅期间每秒核对持久 cursor，以发现丢失的通知。

每个 run 使用一条稳定助手消息，模型工具循环按顺序追加文本和工具 parts，只有完成本次回复才标记 complete。此前按模型轮次拆分助手的实施方式已被此方式替代；没有迁移或合并既有消息。消息可空 `usage` 保存服务商报告的最新模型请求 `inputTokens` / `outputTokens` / `cachedInputTokens`（各项可空），不是多轮累计值；新的请求先清除旧值，缺失不等于零，消息版本变化经同一游标发布。模型请求计数仍独立累计，重试新建 run 和助手身份，旧失败消息及完成工具保留。发送接受响应丢失通过 ai_request_status 只读查询确认，不用重连重发启动。

采用在同一事务内更新目录、编辑状态、撤销、revision、候选状态及 `command_receipts`；撤销恢复原目录并推进新 revision，不回退历史或已完成消息。回执结果为 `{version:1, projectId, revision, resultId}`，只保留已提交结果身份；相同命令重放原回执，不重新读取正文或重复推进修订。不同操作/内容复用 command id 返回冲突；回执失败则业务修改全部回滚。旧诊断入口已移除；桌面流程是否验收完成以专项记录为准。


## 专业任务执行（2026-11-09）

工程助手、显式分章和章节归属分析共用宿主任务派发与独立子Agent执行设施，没有新增数据库/IPC格式。分章模型上下文按同session和trigger_message_id选择尝试，仅投影完整工具事实；原会话历史不删除。章节归属分析仍用格式6阶段检查点，共享`ai/agent`源码纳入实现摘要；旧实现完成阶段不能冒充新实现继续，不恢复在途工具循环。可观测与正式评测边界见[专业任务决定](knowledge/decisions/professional-ai-tasks.md)。

## 章节归属分析（2026-11-08）

正式章节归属分析冻结输入只接受 `formatVersion:2, protocol:2`，`promptVersion` 必须匹配当前核心协议。旧输入、旧JSON窗口和历史journal不再支持专用查询或恢复，不自动迁移或删除原记录；用户可显式创建新的分析任务。正式分析版本仍为v1、保存绝对字节范围。

`chapter_analysis_run_diagnostics` 与 `chapter_analysis_ai_review` 只投影章节归属分析进度、脱敏trace和只读预审建议；不把建议自动写入标注。评测见[正式评测契约](desktop-studio/ai-evaluation-contract.md)。

`analysis_inputs` 与通用 run 意图同时提交，明确区分 analyze/discuss；正常聊天不执行整章分析。正式 章节归属分析 窗口格式为 **6**：完整计划在首个请求前持久化，记录 typed plan、可空 checkpoint 与按尝试ID索引的 traces；checkpoint 保存实现/角色/配置身份、校验完成的 analysis 和独立只读 review；全部窗口和整章通过后沿用原事务发布。只复用相同来源、协议、提示词、角色与配置的完成阶段，不恢复在途工具循环。旧格式窗口明确拒绝，不与章节归属分析混用。源片为整数索引，宿主转换为绝对UTF-8范围，分析/候选/审阅结果不修改正文；重叠只读上下文从权威来源重新构造，不写入检查点。定位证据明确标记为宿主来源定位，不能冒充模型语义论证。每个独立Agent最多32工具/3次失败校验，40轮防空转；不设累计token或整章墙钟配额。HTTP后台单请求仍有600秒传输保护，显式输出上限保持配置值，未知容量不虚构8k默认。

每次尝试以独立trace键保存脱敏的阶段、开始/最近观测时间、模型请求前规范输入摘要、真实提供的工具Schema摘要/数量、完成/未知用量及耗时。工具消息仅存参数/结果摘要、大小、主机错误码和耗时，不重复存read_source正文。进行中耗时随查询增长；中断/失败保留已观察下界，不完整用量不记零。计数是Agent模型调用和工具尝试，传输字节由既有wire台账记录，不把主机耗时解释为纯模型推理时间。AI预审建议只供人工核对，界面按原目标章定位，不自动采用。详见[正式章节归属分析接入](knowledge/decisions/chapter-agent-production.md)。

消息协议新增 `type: result` 和受控 `ResultReference {kind,id,summary}`，分析引用 kind 为 `chapter_analysis`。它映射成 AI SDK `data-result`，不会伪造一对工具调用和结果，模型历史投影忽略该展示引用；原 text/tool 消息保持原语义。目录查询只返回摘要，标注/证据按范围读取；待审阅列表按游标读取现有版本，不触发模型。

验证覆盖宿主契约、Unicode、范围与引用、人工修正及重分析冲突、采用与撤回，以及事务失败不发布成功。实际路由的合成 IPC 浏览器闭环和真实模型公开短章抽样通过；macOS 原生导入、修正、重分析采用与撤回及重开已通过，其他平台未验收。覆盖边界见[验证记录](desktop-studio/chapter-analysis-validation.md)和 OpenSpec 任务。

## 本地工程与来源

当前工程通过本地 id 访问，没有工程文件打开、保存或最近文件协议；旧 `.castglean` 和 `chapter-imports` 目录不扫描、不迁移、不删除。新库由 `database/schema.rs` 检查结构版本，不兼容的版本明确停止初始化。

来源保留稳定 id、文件名、编码、原始字节摘要与 UTF-8 摘要。原始字节和解码文本分别发布到 `project-sources/` 下的摘要路径，发布完成后才提交数据库引用；原始文件移动不影响读取。正文不 trim、不改变 BOM、CRLF/CR/LF 或 Unicode，每个来源只保留一份不可变正文。列表与快照只返回元数据，正文按有界行页读取并校验所属工程、摘要与 UTF-8 范围。

章节保存稳定 id、title、sourceId、半开 UTF-8 字节范围 start/end、零基标题行 heading、volumeId 和 predecessorIds。每来源完整分区，范围不遗漏、不重叠且位于字符边界。卷只分组；人工修正包含 sourceId、line、include 和可空 title/volumeId，排除标题不删除正文。目录编辑、撤销和修订一起提交，单步撤销仅引用来源摘要，不复制全文。相关纯校验位于 `project/document.rs`，其中内存聚合类型不构成可移植文件解析器，也不导出到 IPC。

输入文件上限 32 MiB，解码来源 64 MiB，累计 UTF-8 128 MiB，最多 128 来源和 10,000 章。目录/范围校验失败时不发布成功状态；先发布文件后事务失败时可留下无引用不可变文件，不扫描或删除用户旧数据。容量与桌面验收边界见[分章验证记录](desktop-studio/chapter-splitting-validation.md)。

## 工程级 AI 助手上下文（2026-11-08）

新会话使用 `taskKind=project_assistant`、`chapterId=null`。每次 `StartRun.workspaceContext` 保存 `action=auto|split|analyze` 与可空 `chapterId`，参与请求幂等哈希；运行的来源摘要和工程修订仍由宿主冻结。显式分析在接收事务冻结 `analysis_inputs`，自然语言通过 `analyze_chapter` 工具在当前运行中冻结后交给相同 Worker 执行，重复/跨工程目标拒绝。显式重试复用旧目标及已验证输入，普通后续对话使用本次上下文，不能带回上一任务的 graph 检查点。

`ai_sessions(project_assistant)` 只分页返回当前工程的工程助手会话。分章和章节分析专业任务使用独立类型与查询，不混入工程助手会话列表。运行上下文按页返回并随流式更新合并；结果目标由宿主查询。

## LLM 配置

模型可选 `advertisedReasoning` 保存 OpenAI 兼容网关明确声明的可编码档位，记录协议、规范化端点、实际模型 ID 和档位数组；缺省表示无网关声明，旧配置可读。协议、端点或模型不匹配时宿主拒绝，档位变化参与请求修订与运行租约快照。`ultra` 当前不写入或映射。

模型列表查询可使用未保存的协议、地址和临时凭据；沿用已有密钥时从凭据库读取，查询不写配置。服务返回的上下文或输入容量作为新选模型的可编辑窗口值；返回的输出能力上限仅供列表展示，不自动设置请求的 `maxOutputTokens`。无数据时保持未知。

`llm-connections.json` v1 属于应用配置，不进入工程；保存多连接、多模型、默认引用、修订与分项探测结果。密钥仅存系统凭据库，JSON 使用不透明引用和待清理引用日志。换密钥先登记新引用，再写凭据、原子发布配置，最后清理旧引用；失败保留旧配置。活动任务固定配置，不因默认模型改变而切换服务。浏览器仅保留示例预览，不读取或导出真实工程，不实现正文校验或模型执行。

## 引擎设置 engine.json v1

`src-tauri/src/engine/config.rs` 实现的引擎设置文件保存在应用配置目录（`engine.json`），UTF-8 JSON、snake_case 字段：

```json
{
  "version": 1,
  "settings": {
    "cache_dir": null,
    "data_dir": null,
    "app_cache_dir": null,
    "download_endpoint": null,
    "download_token": null
  }
}
```

`settings` 的五个字段均可空。`cache_dir` 为共享 Hugging Face Hub 缓存，`data_dir` 为应用持久数据根，`app_cache_dir` 为应用可再生缓存根；空值使用各自默认路径，非空值必须为绝对路径，三个根目录不得重叠。`download_endpoint` 为空使用官方端点，非空必须是无内嵌凭据的 http(s) URL；`download_token` 仅保存在本机应用配置目录。设置通过同目录临时文件原子替换；版本、字段或值无效时按默认值处理。

Hub 目录与下载源在没有模型任务时保存生效；应用数据和应用缓存目录在重启后整体切换，当前进程继续使用启动时的目录。切换不迁移或删除旧数据。数据库、工程来源、音色库和章节音频属于应用数据；引擎校准和试听临时文件属于应用缓存。设置可清理设备校准记录及失去租约的旧试听临时文件，不删除共享 Hub 资源或持久音色；本次不提供共享模型文件删除。旧 Hub 缓存下的 `castglean/` 原样保留，不自动迁移或读取。

## 音色资产与多音色包 v2

音色资产由 TaleChime 的无模型 `VoiceLibrary` 管理，CastGlean 显式传入应用数据目录 `voices-v2/`，与工程文件及可切换的模型缓存目录分离。音色身份不绑定某个后端；模型专用参考编码是可再生缓存，不进入包。

当前只支持记录 `talechime/voice/2` 与包 `talechime/voice-bundle/2`。不读旧格式、不转换或删除历史目录；旧包报版本错误，输入保持原样。记录目录内包含原始 `reference.wav` 与 `voice.json`。记录的私有 DTO 包含格式标识、资产信息、本机导入时间和本地导入来源键；调用方经只读资产访问器消费，不依赖这个磁盘布局。

`.voice` 是自包含 ZIP：`manifest.json` 的 `assets` 数组列出音色；`voices/<id>/reference.wav` 存放精确录音。资产包含稳定 ID、名称、准确转写、可选描述、来源、原始创建时间、声音内容摘要、完整资产摘要、录音大小与时长。包不包含本机导入时间、本机路径、凭据、模型权重、模型专用缓存、任务或角色绑定。摘要证明一致性，不证明发布者身份。

一次最多 32 个包、合计 256 个资产，单清单最多 4 MiB、清单合计 16 MiB，单 WAV 最多 64 MiB，输入文件和解压音频分别最多 1 GiB。检查在归档目录分配前限制物理条目数与目录大小，并拒绝重复路径、非法身份、未声明文件、未知字段、版本错误、摘要不符和损坏 WAV。压缩输入与录音均冻结为受限暂存；预览不写正式音色记录。

导入先解决本地与批内冲突，再逐项暂存、同步与原子发布。完全重复返回已有本地 ID；同 ID 不同声音仅允许跳过或以新 ID 导入，默认不覆盖元数据。内部来源键保证作为新音色导入后重试不连续复制。取消保留已完成项，报告列出每一选择项的真实结果；应用重启重新读取资产，不自动恢复内存任务。

导出先冻结所有选中资产，再在目标同目录生成完整包，完成后才原子发布；替换已有目标需要明确确认，禁止把导出目标放在音色库内部。失败或取消不发布部分包，不破坏原目标。当前格式的暂存目录用租约避免清理活动写入；旧的当前格式 scratch 文件仅在超过五分钟且没有活动租约时回收，不扫描历史音色数据。

## 资源准备任务记录 v1

应用配置目录 `resource-preparations.json` 保存 version 1 和 tasks 数组。每条包含
`cache_dir`、类型化 `target` 与应用资源状态；target 为
`{ "kind": "synthesis", "backend": "moss", "model": "nano-candle" }` 或
`{ "kind": "design", "engine": "qwen-voicedesign" }`。

## 章节音频

数据库以当前实体一次创建章节音频任务及单元表。任务记录冻结模型资源 revision 和文本算法身份，续跑只复用身份及单元计划一致的音频。实现见 `src-tauri/src/chapter_audio/`。

- `chapter_audio_runs` 每次生成一行：工程与章节、冻结的 `analysis_version_id` 与 `source_sha256`、实际 `backend` / `model` / `device`、`status`（`queued` / `running` / `cancelling` / `cancelled` / `failed` / `interrupted` / `succeeded`）、`stage`（`queued` / `loading` / `generating` / `concatenating` / `finished`）、`unit_count` 与 `completed_units`、可空的 `failed_index`、`error`、`final_media_id`、`final_duration_ms` 及起止时间。`error` 是宿主的稳定失败码（如 `unit_synthesis_failed`）；`error_detail` 保存引擎/IO 原始信息截断（500 字符），仅用于诊断，不进入界面。部分唯一索引 `chapter_audio_single_active` 保证全局至多一个 `queued` / `running` / `cancelling` 任务。
- `chapter_audio_units` 每个合成单元一行，`(run_id, index)` 唯一：所属分析片段 `segment_id`、源文件内的绝对 UTF-8 字节范围 `range_start` / `range_end`、起点行号 `line`、目标 `target_kind`（`narrator` / `character`）与 `character_id`（旁白为空串）、计划时解析出的预置音色 `voice`、`status`（`pending` / `done` / `failed` / `empty`）、可空的 `media_id`、`duration_ms`、`error` 与 `error_detail`（同上，仅诊断）。同一任务的单元范围首尾相接并恰好覆盖章节；不保存正文，文本始终按范围从不可变来源读取。`empty` 表示该范围只有空白，不合成但保留覆盖。
- 产物位于应用数据目录 `chapter-audio/<run_id>/`：单元 `unit-<四位序号>.wav`，全部必要单元成功后拼接的 `chapter.wav`。均为 16-bit PCM WAV，采样率与声道取自模型输出（Kokoro 为 24 kHz 单声道）。文件先写入 `.wav.tmp`，同步后改名发布；记录只在文件发布后更新。
- 媒体身份是宿主签发的 32 位十六进制串，随单元或任务持久保存。`chapter-audio` 协议只解析已签发且文件仍存在的身份；映射在启动时从数据库重建，文件缺失时查询结果不返回该身份。
- 启动时把上次进程遗留的活动任务标为 `interrupted`，单元状态保持原样，不自动重新生成，也不恢复在途推理。再次生成时若与最近一次终态任务的冻结输入完全一致（分析版本、来源哈希、后端/模型、模型资源 revision 与文本算法版本、逐单元范围/音色/目标/空白标记），复用该任务断点续跑：已完成单元音频保留，只重跑失败与未开始单元；任何输入不一致或旧任务语义未知则建立新任务，旧任务记录与文件保留。目前没有清理或磁盘预算规则。

## 声音绑定与选角建议

- `voice_bindings` 每目标一行（`project_id` + `target_kind`(`narrator`/`character`) + `character_id`，旁白用空 character_id 保证 SQLite 唯一性）；`content` 为版本化 JSON：音色引用（`{"kind":"library","id"}` 或 `{"kind":"preset","backend","model","voice"}`）、来源（manual/建议 run）、时间戳，`voice: null` 表示保留历史的解绑状态。行内 `revision` 递增；`voice_binding_edits` 记录 before/after 与操作（bind/rebind/unbind），命令走 `command_receipts`（操作名 `voice_binding`、`voice_binding_profile`），携带期望工程修订与期望行修订，冲突即拒绝。
- `character_voice_profiles.content`：画像建议层（文本、来源 human/suggestion、时间戳）；人工编辑不被建议直接改写，画像不属于角色身份数据。
- `casting_inputs` 以 run_id 为主键存冻结输入（已确认角色及别名、`evidenceSources`（按角色保存原分析版本来源摘要与 UTF-8 字节范围）、当前绑定/画像快照、音色目录快照、角色摘要）；重试复用原冻结内容；证据文本在执行时从冻结坐标对应的不可变正文校验读取，不重新采样当前归属。旧中断输入缺少必要字段时明确失败，不迁移或删除记录。`casting_suggestions` 以 run_id 为主键存不可变建议记录（逐目标画像建议/候选音色排序/设计草稿、宿主剔除清单、角色与目录摘要），读取时按当前目录与角色摘要计算 stale，不存储失效状态。发布事务含 run 结果引用与 `casting_publish` 回执。
- 音色入库要求非空描述：设计路径自动带出，导入路径逐项补填（决定携带 `description`，发布后经 `describe` 写入）；`VoiceLibrary::describe` 修改描述会重算资产摘要、不改身份。删除被工程引用的库音色在宿主侧被拒绝并返回引用清单（`voice_bindings` 全表按引用键过滤）。

统一日志（`host-logging-and-diagnostics`，2026-11-11）：宿主以 tracing 为唯一门面，
日志写入平台日志目录（macOS `~/Library/Logs/<bundleId>/castglean.log.<日期>`），
按天滚动、非阻塞写线程，启动时清理超过 7 天或总量 32 MiB 的旧文件；`log` 门面
依赖经 LogTracer 汇入，TaleChime 性能事件走 `talechime_perf` target（DEBUG 档，
`--verbose` 打开）。级别与字段规范见变更 design.md D2；隐私红线：只记 id 与度量，
小说正文、LLM 请求/响应与凭据永不落盘。panic 记录到同一管道与 `last_panic.txt`。
"导出诊断信息"打包最近日志与 manifest 摘要（版本/平台/schema 版本/引擎盘点），
导出前向用户展示清单。日志不属于工程文件。

网络任务保存 Downloading 的文件和字节进度。重启将未完成下载转为 Paused，等待用户手动继续；新任务不执行本地转换。为读取已有记录仍保留 Preparing、Interrupted 及其阶段字段，历史 Preparing 重启后显示为 Interrupted，不自动执行。

任务身份与事件序号只在本次进程内分配，快照重连恢复当前事实；旧任务的迟到更新不能覆盖暂停、取消或重试。取消下载先等待任务退出和断点保存；令牌、端点、签名 URL 和私有音频不写入日志。

不读取、迁移或改写旧 `resource-downloads.json` 和 `model-downloads.json`。
新日志损坏时拒绝覆盖。底层网络断点仍归 TaleChime/HF 缓存管理；日志版本变化不删除
或移动模型文件。准备失败与就绪资源盘点分别表达，不从历史日志推断模型可推理。

### LLM 请求身份与凭据发布结果

连接及模型的显示名不参与请求修订，模型列表重排不改变身份；协议、端点、模型身份/实际 ID 集合或密钥改变才推进连接请求修订。活动引用持有原快照；这些请求字段在占用期间禁止更改，显示名与全局默认可修改。

凭据替换先登记待清理引用，写入系统凭据后再发布当前连接引用。最终 JSON 发布失败不改变旧连接及其密钥；重开仍识别孤立引用，用户可显式重试清理。移除连接但凭据删除失败时，快照的 `cleanupRequired` 保留为 true，界面报告尚未完成密钥清理。缺失/锁定凭据均不等同于用户选择无密钥。

新任务入口的队列 payload 只有 run_id，max_attempts 为 1。派发器按 queued 意图恢复，30 秒后可重投未领取任务，领取 CAS 阻止重复模型执行；开始前按连接准入，每连接至多一项、全局至多两项，不让同连接等待耗尽两个 Worker。模型配置在领取后重新取得租约并核对修订；取消先持久化，再通知内存 token，收尾等待本地工具退出。分章工具的候选和成功引用在同一事务发布；工具回调身份取自 SDK 调度钩子，模型参数不能提供调用身份。graph-flow 检查点以独立版本封装当前节点、乐观锁版本和最后完成工具身份，不复制工具输出；候选与工具位置原子提交，恢复到 validate 不重跑已完成诊断，review 等待结束 Worker，显式继续创建新 run。窗口关闭统计从数据库计算 queued/running/cancelling，模型配置租约仍阻止修改，但不重复计入同一后台任务；等待输入、失败和中断不占执行名额。本机桌面验收证据与其他平台边界见[验证记录](knowledge/lessons/local-storage-windows-validation.md)。


### 可选模型上下文与输出参数（2026-11-07）

LLM 模型条目增加可空、缺省可读的 `contextWindow` 与 `maxOutputTokens`，正整数或 null。前者用于正常会话窗口显示，并供章节分析保守规划分窗，不作为一般聊天的本地准入阈值；后者仅在显式配置时附加到正常模型请求，改变它会推进连接请求修订。默认窗口未知、输出参数不设置，服务商实际限制和必要协议默认仍适用。正常会话不再按 2000 字、8KiB、8/64 请求或累计工具配额阻止继续；16MiB 消息文档与 64MiB 模型历史/传输为结构资源边界，不代表模型容量。详见[决定与验证](knowledge/decisions/ai-conversation-controls.md)。


LLM模型增加缺省可读的 `reasoning`（缺省 `lowest`）：宿主根据精确供应商/模型能力目录解析最低支持档位，前端显示宿主允许项并可选择 `provider_default`；未知模型不发送思考参数，不能按名称猜测任意网关能力。仅调整思考强度可在执行期间保存并推进配置修订，在途租约保留旧选项，后续任务采用新值；端点、凭据和模型替换仍遵循忙碌保护。`reasoningCatalog` 是宿主只读能力投影，不是前端可写供应商参数。目录与供应商真实执行需要分别核验。

## 后端类型边界

窗口JSON由SeaORM `FromJsonQueryResult`映射为 `WindowRecord`，拒绝未知结构；只通过保存分析、保存预审、追加trace更新，所有写入仍在租约/依赖校验事务内完成，不接受任意字段patch。生成配置为宿主模型DTO与Rig GenerationOptions；失败和未知用量不补零。预审恢复时重新校验来源与身份，不能仅因JSON解析成功就跳过校验。旧格式不继续、不迁移、不删除已有工程或来源。

工具参数通过Serde类型解码，Schemars与Rig `args_schema`生成工具Schema。动态身份枚举和候选跨字段条件在生成后追加。章节归属分析 typed Tool适配器保留原始JSON的缺失/null/空数组区别；类型错误进入同一计数、审计和修复反馈路径，不绕过32工具/3次失败校验限制。原始正文和模型解释不写入拒绝audit。

## 分章工具调用边界

分章Agent工具参数从Rust DTO解码并生成Schema，真实工具输入保留原始JSON，解码或作用域拒绝仍保存Failed事实与真实尝试。错误返回安全宿主码，不暴露供应商正文或Serde中的非法输入。目录、上下文、检索及受理/提交结果由固定DTO序列化，既有字段命名不变。明确允许null的边界标题/分卷字段保持含义；可省略但非nullable的目标chapter_id拒绝显式null。

分章范围只有六个分章工具，工程助手范围可额外读取/请求归属；宿主在执行时再次核对范围。同run工程助手候选与分章会话候选共用原发布事务，不能因创建候选自动采用。graph-flow checkpoint与候选格式仍为既有v1，未迁移或删除记录。
