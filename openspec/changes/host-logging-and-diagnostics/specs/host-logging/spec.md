# Spec Delta

## Purpose

宿主与前端的运行事件、性能观测与崩溃统一进入本地滚动日志文件，分层与字段有明确规范，敏感内容永不落盘；用户可一键导出诊断包支撑问题排查。

## ADDED Requirements

### Requirement: 统一日志管道
系统 SHALL 在宿主初始化最早阶段安装 tracing subscriber，作为全部日志的唯一汇聚点：按天滚动的本地日志文件（平台日志目录）经非阻塞写线程写入，`log` 门面依赖的事件 SHALL 汇入同一管道。系统 SHALL 实施保留策略（天数与总容量上限，超限删除最旧），MUST NOT 让日志无界增长。

#### Scenario: 事件落盘
- **WHEN** 宿主任何模块记录一条日志
- **THEN** 它出现在按天滚动的日志文件中，含时间、级别、target 与结构化字段

#### Scenario: 保留清理
- **WHEN** 启动时存在超过保留窗口或总量上限的历史日志文件
- **THEN** 最旧的文件被删除，受控日志总量满足上限；旧格式日志保留但不加入新诊断包

#### Scenario: 运行期持续写入
- **WHEN** 当前日志分段达到大小上限或跨越 UTC 日界
- **THEN** 后台写线程先淘汰最旧受控分段再写入新分段，受控日志总量始终不超过上限；单条事件过长可跨分段

### Requirement: 分层与字段规范
系统 SHALL 遵循统一级别语义（ERROR 用户可感知失败/数据风险；WARN 已自动恢复的异常；INFO 生命周期与里程碑；DEBUG 细粒度过程与性能观测，默认关闭）与 target 规范（模块默认 target；性能事件 `perf`/`talechime_perf`；前端事件 `frontend`）。结构化字段 SHALL 使用 snake_case 的身份（run_id 等）、带单位的度量（duration_ms 等）与稳定错误码。

#### Scenario: 级别默认档
- **WHEN** 应用以默认参数启动
- **THEN** INFO 及以上事件落盘，DEBUG 性能事件不落盘；`--verbose` 启动后 DEBUG 落盘

#### Scenario: 可按身份检索
- **WHEN** 一次生成任务失败
- **THEN** 该任务从启动到失败的日志行均携带同一 `run_id` 字段，可单行过滤还原时间线

### Requirement: 隐私红线
日志 MUST NOT 包含小说正文或来源文本片段、LLM 请求/响应内容、凭据或密钥。事件 SHALL 只记录身份 id 与度量（数量、字节、时长和稳定错误码）；只有来源确定安全的错误详情可以记录。任意异常消息、堆栈和 panic payload MUST NOT 写入日志或诊断包。

#### Scenario: 单元失败日志不含正文
- **WHEN** 某合成单元失败并记录日志
- **THEN** 日志含 run_id、单元序号、错误码与截断详情，不含该单元的正文文本

### Requirement: 崩溃与前端异常捕获
系统 SHALL 安装 panic hook，把 Rust panic 以 ERROR 级别写入同一日志管道并保留最近一次 panic 的可导出记录。前端 SHALL 捕获全局脚本错误、未处理的 Promise 拒绝与顶层 React 渲染异常，并转发到宿主同一管道。

#### Scenario: panic 记录
- **WHEN** 宿主线程 panic
- **THEN** 日志出现 ERROR 记录（固定分类和行号），且安全格式的 last_panic 指示文件被更新；不记录 panic 消息或源码路径

#### Scenario: 前端异常转发
- **WHEN** WebView 中发生未捕获脚本错误
- **THEN** 宿主日志出现 `frontend` target 的 WARN/ERROR 记录（固定异常类别），不记录消息、堆栈或 URL

### Requirement: 性能埋点
系统 SHALL 在关键路径记录性能事件（默认 DEBUG 档）：宿主启动各阶段耗时、schema 迁移耗时、引擎加载耗时（后端/模型/设备）、章节音频逐单元与整章耗时、LLM 请求时长与重试次数、下载任务速率。TaleChime 的性能事件 SHALL 遵循统一 target（`talechime_perf`）与字段规范（snake_case 事件名、带单位度量），并在引擎加载与合成完成时发出含耗时的结构化事件。

#### Scenario: 引擎加载耗时
- **WHEN** 引擎加载完成
- **THEN** 日志记录 backend、model、device 与 duration_ms

#### Scenario: 整章生成汇总
- **WHEN** 一次章节音频任务到达终态
- **THEN** 日志记录终态、单元总数、已完成数与总耗时，逐单元耗时事件（DEBUG）可还原

### Requirement: 诊断导出
系统 SHALL 提供"导出诊断信息"能力：先向用户展示将包含的内容清单，经用户选择保存位置后打包为单个压缩文件，包含最近日志文件与环境摘要（应用版本、平台、schema 版本、引擎资源盘点、最近 panic 记录）。导出 MUST NOT 包含工程数据或小说正文，MUST NOT 自动发送到任何远端。

#### Scenario: 导出前可见清单
- **WHEN** 用户点击导出诊断信息
- **THEN** 界面列出将打包的日志文件与摘要项，用户确认并选择位置后才生成文件

#### Scenario: 诊断包自包含
- **WHEN** 导出完成
- **THEN** 压缩文件可独立打开，含日志与 manifest 摘要，不含凭据与正文

### Requirement: 日志归属
日志文件保存于平台日志目录，MUST NOT 进入工程数据目录、Git 仓库或任何导出的工程文件。

#### Scenario: 卸载残留边界
- **WHEN** 查看应用数据目录与日志目录
- **THEN** 日志仅存在于平台日志目录，工程目录内无日志文件
