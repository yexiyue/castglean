# 工程与离线数据格式草案

## 本地数据库重构实施状态（2026-11-07）

本次实现采用 [本地 AI 任务运行时](../openspec/changes/archive/2026-11-08-refactor-local-ai-task-runtime/proposal.md)。新库为应用私有目录下 `castglean.sqlite3`，Entity 定义在 `src-tauri/src/database/entity/`；包含工程、来源、卷、章节、编辑状态、AI 会话/消息/执行、分章候选与命令回执。结构版本使用 SQLite `user_version`；未知版本停止写入，不自动清空，启动时显示保留数据、检查权限与应用版本的原生提示，不回落到空工程列表。队列由 Apalis 独立初始化。原始小说字节与解码后正文继续放受控文件，音色库与模型缓存保持现有归属。

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

> 2026-11-02 重启备注：本文为重启前实现的格式草案，作为新应用数据格式设计的参考保留；文中实现与 Schema 位于 `legacy-main` 分支。

## 章节归属分析（2026-11-08）

正式C7新冻结输入采用 `formatVersion:2, protocol:2`，`promptVersion` 指向C7核心协议。历史 `protocol:1` 的紧凑JSON流水线仅在显式隔离评测中执行，历史 `formatVersion:1, protocol:0` 保持可读；C7早期记录只能在自身窗口身份一致时恢复，不能将其他协议静默迁移为新任务。正式分析版本仍为v1、保存绝对字节范围。

历史紧凑流水线的步骤journal和C7窗口都使用过 `formatVersion:5`，但结构不同：前者有fingerprint/stage/spans和负序号元数据；后者有C7窗口计划/implementationHash/analysis/review。新读取按输入协议和记录身份分流，统计窗口排除负序号，不能只凭数字5将两种结构互读。`chapter_analysis_run_diagnostics` 与 `chapter_analysis_ai_review` 同时支持当前C7与历史journal的只读投影；前端现有阶段/用量/预审显示使用C7进度投影，AI建议不自动采用。评测JSON/trace仍遵循独立的[v1实验契约](desktop-studio/ai-evaluation-contract.md)。

当前 SQLite schema 为 **3**。v2 增加归属分析表；v3 增加 `ai_runs.workspace_context` 可空 JSON，旧运行读取为无上下文，保留全部旧消息与执行。`database/schema.rs` 在单一事务中从 1 升级，增加 `analysis_inputs/windows/versions/states/candidates/edits`、`characters`、`character_aliases`；DDL、索引和 `user_version` 一起提交。升级保留工程、原文引用、分章和 AI 历史。升级失败回滚到原版本，未知版本拒绝写入；已升级数据库不支持旧二进制自动降级。这不是 Legacy 分析格式的导入。

`chapter_analysis/types.rs` 定义 `formatVersion: 1` 的分析版本。来源固定工程/章节/来源 ID、完整 SHA-256 和半开 UTF-8 字节区间。正文仍由受控源文件读取，不复制进分析版本。历史JSON协议模型坐标使用宿主锚点 ID + 从零开始的 Unicode **标量**下标（不是 JS UTF-16，也不是字形数量）；宿主转换绝对字节坐标，保留 BOM、CR/LF/CRLF、emoji、组合字符和空白。正式C7使用源片整数索引及有序runs，见下文；二者均由宿主转换UTF-8范围。按原文行规则产生锚点，长行只在合法字符边界拆锚点。

片段分别保存 `narration/speech/thought`、`narrator/resolved/unknown/ambiguous` 和 `unreviewed/confirmed`。旁白不是人物 ID；台词或独白未知时不得改成 narrator。有效版本必须顺序、非空、无重叠且完整覆盖全章，证据必须位于当前章，人物必须属于当前工程。模型候选使用运行内 `new:` 键，宿主分配稳定 UUID；重名不触发合并。反序列化拒绝未知字段，纯校验与结构化模型协议独立；结构有效不证明语义正确。

分析版本不可变，当前指针保存递增分析/人工修订。首次完整结果直接保存待审阅初稿；重分析创建独立候选。人工保护绑定源范围与字段，连续替换组不能通过新 ID 或拆合绕过保护。采用必须显式选择，冲突另行允许；未选组沿用旧结果。撤回创建新版本，保留历史和共享人物，候选采用撤回标记 withdrawn。写命令以 UUID 命令身份和期望修订串行校验，回执与业务共同提交；回读失败不显示保存成功。

`analysis_inputs` 与通用 run 意图同时提交，明确区分 analyze/discuss；正常聊天不执行整章分析。正式 C7 窗口格式为 **5**：完整计划在首个请求前持久化，记录 owned/context、锚点摘要、实现/角色/配置摘要，先保存校验完成的 analysis，再保存独立只读 review；全部窗口和整章通过后沿用原事务发布。只复用相同来源、协议、提示词、角色与配置的完成阶段，不恢复在途工具循环。历史格式4的固定JSON窗口保持只读，不与C7混用。源片为整数索引，宿主转换为绝对UTF-8范围，分析/候选/审阅结果不修改正文；重叠只读上下文从权威来源重新构造，不写入检查点。定位证据明确标记为宿主来源定位，不能冒充模型语义论证。每个独立Agent最多32工具/3次失败校验，40轮防空转；不设累计token或整章墙钟配额。HTTP后台单请求仍有600秒传输保护，显式输出上限保持配置值，未知容量不虚构8k默认。

每次尝试以独立trace键保存脱敏的阶段、开始/最近观测时间、模型请求前规范输入摘要、真实提供的工具Schema摘要/数量、完成/未知用量及耗时。工具消息仅存参数/结果摘要、大小、主机错误码和耗时，不重复存read_source正文。进行中耗时随查询增长；中断/失败保留已观察下界，不完整用量不记零。计数是Agent模型调用和工具尝试，传输字节由既有wire台账记录，不把主机耗时解释为纯模型推理时间。AI预审建议只供人工核对，界面按原目标章定位，不自动采用。详见[正式C7接入](knowledge/decisions/chapter-agent-production.md)。

消息协议新增 `type: result` 和受控 `ResultReference {kind,id,summary}`，分析引用 kind 为 `chapter_analysis`。它映射成 AI SDK `data-result`，不会伪造一对工具调用和结果，模型历史投影忽略该展示引用；原 text/tool 消息保持原语义。目录查询只返回摘要，标注/证据按范围读取；待审阅列表按游标读取现有版本，不触发模型。

已验证证据：宿主契约/Unicode/覆盖/引用、窗口/差异、初稿→人工修正→重开→重分析冲突→采用/撤回、事务失败不发布成功，以及 v1 数据保留/迁移故障回滚测试；全库 210 项通过（5 项显式外部条件跳过）。实际路由的合成 IPC 浏览器闭环和真实模型公开短章抽样通过；macOS 原生导入/修正/重分析采用/撤回与重开已通过，其他平台未验收，最新门禁与覆盖边界见[验证记录](desktop-studio/chapter-analysis-validation.md)和 OpenSpec 任务。

## 本地工程与来源

当前工程通过本地 id 访问，没有工程文件打开、保存或最近文件协议；旧 `.castglean` 和 `chapter-imports` 目录不扫描、不迁移、不删除。新库由 `database/schema.rs` 检查结构版本，不兼容的版本明确停止初始化。

来源保留稳定 id、文件名、编码、原始字节摘要与 UTF-8 摘要。原始字节和解码文本分别发布到 `project-sources/` 下的摘要路径，发布完成后才提交数据库引用；原始文件移动不影响读取。正文不 trim、不改变 BOM、CRLF/CR/LF 或 Unicode，每个来源只保留一份不可变正文。列表与快照只返回元数据，正文按有界行页读取并校验所属工程、摘要与 UTF-8 范围。

章节保存稳定 id、title、sourceId、半开 UTF-8 字节范围 start/end、零基标题行 heading、volumeId 和 predecessorIds。每来源完整分区，范围不遗漏、不重叠且位于字符边界。卷只分组；人工修正包含 sourceId、line、include 和可空 title/volumeId，排除标题不删除正文。目录编辑、撤销和修订一起提交，单步撤销仅引用来源摘要，不复制全文。相关纯校验位于 `project/document.rs`，其中内存聚合类型不构成可移植文件解析器，也不导出到 IPC。

输入文件上限 32 MiB，解码来源 64 MiB，累计 UTF-8 128 MiB，最多 128 来源和 10,000 章。目录/范围校验失败时不发布成功状态；先发布文件后事务失败时可留下无引用不可变文件，不扫描或删除用户旧数据。容量与桌面验收边界见[分章验证记录](desktop-studio/chapter-splitting-validation.md)。

## 工程级 AI 助手上下文（2026-11-08）

新会话使用 `taskKind=project_assistant`、`chapterId=null`。每次 `StartRun.workspaceContext` 保存 `action=auto|split|analyze` 与可空 `chapterId`，参与请求幂等哈希；运行的来源摘要和工程修订仍由宿主冻结。显式分析在接收事务冻结 `analysis_inputs`，自然语言通过 `analyze_chapter` 工具在当前运行中冻结后交给相同 Worker 执行，重复/跨工程目标拒绝。显式重试复用旧目标及已验证输入，普通后续对话使用本次上下文，不能带回上一任务的 graph 检查点。

`ai_sessions(project_assistant)` 分页返回本工程统一及旧分章/归属历史。`HistoryPage.contexts` 批量返回本页运行的上下文，流式更新及向前分页合并同一映射；界面可为旧回复标明原章，不依赖当前可见章。新助手不会自动选中旧会话；旧会话在只读历史浮层显示，不拼接或迁移消息。结构候选和归属版本/候选仍分开持久化，结果目标由宿主查询，不能按当前阅读章猜测。来源、角色、人工保护和显式采用/撤回格式不变。

## LLM 配置

`llm-connections.json` v1 属于应用配置，不进入工程；保存多连接、多模型、默认引用、修订与分项探测结果。密钥仅存系统凭据库，JSON 使用不透明引用和待清理引用日志。换密钥先登记新引用，再写凭据、原子发布配置，最后清理旧引用；失败保留旧配置。活动任务固定配置，不因默认模型改变而切换服务。浏览器仅保留示例预览，不读取或导出真实工程，不实现正文校验或模型执行。

## 引擎设置 engine.json v1

`src-tauri/src/engine/config.rs` 实现的引擎设置文件保存在应用配置目录（`engine.json`），UTF-8 JSON、snake_case 字段：

```json
{
  "version": 1,
  "settings": {
    "cache_dir": null,
    "download_endpoint": null,
    "download_token": null
  }
}
```

`settings` 三字段均可空：`cache_dir` 为空使用共享 Hugging Face 缓存（`~/.cache/huggingface/hub`，与其他 Hub 工具字节级复用），非空时必须是绝对路径；`download_endpoint` 为空使用官方端点，可填镜像（必须是 http(s) URL）；`download_token` 为可选 Hub 访问凭据，仅存本机应用配置目录，不入 Git。保存走同目录临时文件原子替换；版本不匹配、未知字段、解析或值校验失败按默认值处理，下次保存覆盖。设置只对后续下载生效，不迁移已下载文件。引擎消费布局位于当前缓存目录的 `castglean/` 子目录，盘点随缓存目录切换；下载进行中需先完成或取消才能更改目录。

## 音色资产与多音色包 v2

音色资产由 TaleChime 的无模型 `VoiceLibrary` 管理，CastGlean 显式传入应用数据目录 `voices-v2/`，与工程文件及可切换的模型缓存目录分离。音色身份不绑定某个后端；模型专用参考编码是可再生缓存，不进入包。

当前只支持记录 `talechime/voice/2` 与包 `talechime/voice-bundle/2`。不读旧格式、不转换或删除历史目录；旧包报版本错误，输入保持原样。记录目录内包含原始 `reference.wav` 与 `voice.json`。记录的私有 DTO 包含格式标识、资产信息、本机导入时间和本地导入来源键；调用方经只读资产访问器消费，不依赖这个磁盘布局。

`.voice` 是自包含 ZIP：`manifest.json` 的 `assets` 数组列出音色；`voices/<id>/reference.wav` 存放精确录音。资产包含稳定 ID、名称、准确转写、可选描述、来源、原始创建时间、声音内容摘要、完整资产摘要、录音大小与时长。包不包含本机导入时间、本机路径、凭据、模型权重、模型专用缓存、任务或角色绑定。摘要证明一致性，不证明发布者身份。

一次最多 32 个包、合计 256 个资产，单清单最多 4 MiB、清单合计 16 MiB，单 WAV 最多 64 MiB，输入文件和解压音频分别最多 1 GiB。检查在归档目录分配前限制物理条目数与目录大小，并拒绝重复路径、非法身份、未声明文件、未知字段、版本错误、摘要不符和损坏 WAV。压缩输入与录音均冻结为受限暂存；预览不写正式音色记录。

导入先解决本地与批内冲突，再逐项暂存、同步与原子发布。完全重复返回已有本地 ID；同 ID 不同声音仅允许跳过或以新 ID 导入，默认不覆盖元数据。内部来源键保证作为新音色导入后重试不连续复制。取消保留已完成项，报告列出每一选择项的真实结果；应用重启重新读取资产，不自动恢复内存任务。

导出先冻结所有选中资产，再在目标同目录生成完整包，完成后才原子发布；替换已有目标需要明确确认，禁止把导出目标放在音色库内部。失败或取消不发布部分包，不破坏原目标。当前格式的暂存目录用租约避免清理活动写入；旧的当前格式 scratch 文件仅在超过五分钟且没有活动租约时回收，不扫描历史音色数据。

## Legacy 离线标注参考

多角色宿主如何消费完整已校验结果、处理未知/歧义及修订失效，见 [整章交接](chapter-consumption.md)。

阶段 A 使用 `format_version: 1` 的草案格式，尚未冻结对外协议。角色表和章节标注可通过 Rust DTO 构造或 JSON 解析；两者均为未校验输入，必须经 `validate_book` 才能作为已校验结果使用。校验证明结构与原文一致，不证明人物归属的语义真实性。

## 正文与坐标

`SourceSnapshot::import` 接收 UTF-8 字符串，将 CRLF、独立 CR 转为 LF，保留其他 Unicode、空白和 BOM 内容。元数据记录规范化版本 1、`offset_unit: utf8_byte`、原始 `import_sha256` 与规范化 `sha256`，摘要使用小写十六进制。库不混入章节标题。

`SourceSnapshot::from_saved` 接收已经保存的快照及元数据，检查规范化规则和快照摘要，不重新规范化。没有原始输入时，导入摘要只能检查语法，不能重新验证其来源。调用方应在导入阶段保存原始摘要；坐标与归属始终绑定规范化快照。

仓库 `.gitattributes` 禁止 Git 改写公开正文快照的换行，以免 Windows/Linux checkout 改变摘要。输入文件的编码必须为 UTF-8；CLI 对无效 UTF-8 报读取错误。

`ByteRange` 是非空、左闭右开的 UTF-8 字节范围，必须位于正文内且在字符边界。组合字符可以含多个 Unicode 字符，边界检查不是视觉字素簇检查。范围本身不识别正文版本，跨快照切片再次检查边界；章节元数据另外检查正文绑定。

## 角色与归属

`BookId`、`ChapterId`、`CharacterId`、`SegmentId` 是不同类型的非空白字符串，不解释为数组下标、路径或排序。角色显示名及别名不要求跨人物唯一，重复角色 ID 则拒绝。角色表 `revision` 必须为正，章节 `character_revision` 必须匹配。

表达类型为 `narration`、`speech`、`thought`、`quoted_text`。speech 和 thought 必须带归属；其他类型可省略，已知第一人称叙述者也可带确定身份。归属以 `status` 区分：

| 状态 | 字段约束 |
| --- | --- |
| resolved | 一个现有 `character_id` |
| ambiguous | 至少两个不同且现有的 `candidate_ids` |
| unknown | 不含确定角色或候选字段 |

三种状态均含当前章的 `evidence_segment_ids` 和独立的 `review_status`（unreviewed / confirmed）；resolved 不代表人工确认。引述或旁白省略归属不等同于给未知发言者分配旁白身份。

可选 `voice_profile` 保留草案中的 gender、age_band、impressions、evidence，不包含后端音色参数。属性可省略或为 unknown，非未知属性和印象要求证据。阶段 A 的证据集合支持画像整体的结构引用校验，逐属性证据和取值词表留待后续协议细化。

## 完整校验集合

`validate_book` 消费一个角色表及全部显式提供的章节/快照配对。每章片段必须按序完整覆盖正文，不能遗漏空白、重叠或切入字符编码；空章必须没有片段。章节和章内片段 ID 唯一。

人物和声音画像证据含 chapter_id / segment_id；归属证据只引用当前章。所有引用必须在提供的集合中存在，缺少引用章会报错；库不会自动访问目录或外部文件。增量书级快照与身份获知边界已在 BookState 实现，见 [跨章文档](archive/design/cross-chapter.md)；旧 validate_book 仍仅提供闭集结构校验，不推断章节顺序语义。

返回 `ValidatedBook` / `ValidatedChapter` 持有数据并只读访问，`segments()` 输出每个片段及精确正文切片。修改 DTO 克隆后必须重新校验。朗读片段当前仅表达完整分区；跨范围或嵌套语义台词层后续独立设计。

## JSON 与扩展

核心结构拒绝未知字段。角色表、人物、章节、片段提供可选 `extensions` 对象，扩展值参与 JSON 往返；不要把拼错的核心字段当作扩展。未知格式或规范化版本被拒绝。

Schema 检查 JSON 结构，不能替代摘要、范围、覆盖、修订和引用校验。JSON 读取成功仅得到 DTO，不授予“已校验”状态。读写助手及 Schema 生成入口随离线接口提供，生成文件放在 `schemas/`。

## 使用已实现的离线入口

从仓库根目录运行（示例均为公开人工标注）：

```bash
cargo run -- validate --characters examples/minimal/characters.json --annotations examples/minimal/chapter.annotations.json --source examples/minimal/chapter.txt
cargo run -p castglean-core --example validate_sample
cargo run -p castglean-core --example export_schema -- schemas
```

CLI 成功返回 0 并向 stdout 输出书籍及数量；文件读取、JSON 或业务校验失败返回非零并向 stderr 输出诊断，不修改输入。`--annotations`、`--source` 可以重复，按各自出现顺序配对，数量必须相等；同一批必须属于同书、同角色修订且提供全部引用证据。例如：

```bash
castglean validate --characters characters.json --annotations ch-001.annotations.json --source ch-001.txt --annotations ch-002.annotations.json --source ch-002.txt
```

上面的多章路径是使用方式示意，需替换为自己的已规范化快照。CLI 不隐式规范化或重算旧标注。

Rust 使用方通过 `read_json` 读取 DTO，或直接构造 DTO；正文可由 `SourceSnapshot::import` 创建。准备 `ChapterInput` 配对，调用 `validate_book`，从只读章节的 `segments()` 获得标注和精确文本。`write_json` 输出调用方提供的数据到指定流，不自动提交、缓存或选择路径。

可选 [增量章节交接](archive/design/incremental-delivery.md)输出只读 `AcceptedPrefixBatch`，其 JSON 形状由 `accepted-prefix.schema.json` 描述。批次范围引用同一完整快照，不是完整章节 DTO 或正式提交；只有分析最终成功返回，宿主才可封闭全文。

## 资源准备任务记录 v1

应用配置目录 `resource-preparations.json` 保存 version 1 和 tasks 数组。每条包含
`cache_dir`、类型化 `target` 与应用资源状态；target 为
`{ "kind": "synthesis", "backend": "moss", "model": "nano-candle" }` 或
`{ "kind": "design", "engine": "qwen-voicedesign" }`。合成与设计共用日志，按缓存目录
隔离，限制 1024 条/4 MiB，以临时文件、sync 和原子替换保存。日志不属于工程文件。

网络任务保存 Downloading 的文件/字节进度；原生准备保存 Preparing 的阶段、组件及
完成单位，不把转换单位当成网络字节。阶段为 Downloading、Converting、Verifying、
Publishing 或 Cancelling。重启将网络任务转为 Paused，将 Preparing 转为 Interrupted，
保留中断阶段和组件，等待用户重新确认。应用不会自动继续下载或转换。

任务身份与事件序号只在本次进程内分配，快照重连恢复当前事实；旧任务的迟到更新不能
覆盖暂停、取消或重试。取消转换先显示 Cancelling，等待 SDK worker 退出再释放活动占用。
令牌、端点、签名 URL 和私有音频不写入日志。

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
