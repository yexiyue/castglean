# 项目知识库

保存开发过程中可以复用的规划、决策和踩坑经验。当前功能状态以[根 README](../../README.md)为准，现行功能契约以 [OpenSpec 主规格](../../openspec/specs/) 为准；[活动变更](../../openspec/changes/)记录待完成工作，工程规范以 [AGENTS.md](../../AGENTS.md) 与[工程约定](../engineering.md)为准。

## 内容索引

| 记录 | 状态与用途 |
| --- | --- |
| [章节直接编辑与 AI 角色可用性](decisions/chapter-direct-editing.md) | 用户已确定并实施：AI 来源与生产权限分离；原位归属/声音编辑、自动合并保护、幂等与跨章刷新边界 |
| [真实章节制作后的流程简化](plans/chapter-workflow-simplification.md) | 已授权并实施：AI 结果直接可用、归属自动保存、就地处理声音、来源优先导入、统一播放与失败动作；完整验证边界见对应变更 |
| [AI 消费器注册冲突与恢复](lessons/ai-consumer-recovery.md) | 已定位快速重启的固定消费器名称冲突；实例独立身份与有退避监督，真实 SQLite 心跳故障注入验证无重复模型调用 |
| [开发构建的模型盘点哈希耗时](lessons/dev-model-inventory-hashing.md) | 原生采样定位未优化 SHA-256；宿主补齐依赖 profile 与盘点耗时日志，缓存完整性和窗口生成分别验收 |
| [角色分段正文与音频轨道](decisions/chapter-audio-workbench.md) | 已实现、中文原生样本已验（完整矩阵与听感待验）：分析后角色列、底部逐单元进度与播放、独立停顿及 WAV 导出；自动化与原生听感分别记录 |
| [整章生成优先](decisions/chapter-generation-first.md) | 用户已确定：复用已有分析/绑定，先整章顺序生成与播放，再重做/采用/WAV 导出，随后助手工具卡；交互习惯待真实任务验证 |
| [Hub 缓存与应用数据分离](decisions/hub-cache-separation.md) | 固定资源直接读取 Hub，持久数据与应用缓存独立配置并在重启后切换；本次不删除共享模型，记录 macOS 原生检查与平台边界 |
| [章节音频第一阶段](../../openspec/changes/chapter-audio-generation/proposal.md) | 已实现、未完成验收：合成单元与生成前检查、顺序生成、持久化与中断恢复、整章播放；设计取舍见同目录 design.md，任务状态见 tasks.md |
| [审阅与播放重构](../../openspec/changes/attribution-review-and-playback/proposal.md) | 已实现、真实窗口验收未做：归属审阅异常驱动（仅未知/歧义且未处理进待检查）、段首说话人标注、片段就近起播连播（单文件/串播双载体）与跟读高亮；交互形态的品类背书见[调研](../research/segment-review-and-playback-patterns.md) |
| [日志与诊断系统](../../openspec/changes/host-logging-and-diagnostics/proposal.md) | 已实现：tracing 统一管道、埋点与 TaleChime 规范化、诊断导出；分层与字段规范见 design.md D2；界面侧真实验收与完整冒烟闭环未做，[调研与验证状态](../research/logging-and-diagnostics.md) |
| [章节音频验收记录](../desktop-studio/chapter-audio-validation.md) | 自动化通过；真实 Kokoro 多音色整章（宿主层，含真实失败案例复现与修复复验）与真实目录下七类阻塞已验；用户日常应用提供进度/失败/定位的部分窗口证据，**系统化原生窗口验收未执行** |
| [原生窗口验收需要已解锁的会话](lessons/native-acceptance-needs-unlocked-session.md) | 已定位（macOS）：锁屏时 WebView 页面脚本暂停而 HMR 连接仍在，窗口内验收全部不可行；先确认会话解锁，用户不在时改做宿主层真实测试 |
| [助手驱动制作方案](../../openspec/changes/assistant-guided-production/proposal.md) | 后置待实施：章节生成主链落地后接目标推进、用户决定及对话内进度/试听/信息；复用章节用例，短试听仅作补充 |
| [声音绑定真实验收](../desktop-studio/voice-binding-acceptance-2026-11-10.md) | macOS 隔离工程、GLM 真实选角/推理重试、VoxCPM Metal 设计入库绑定与恢复；撤回采用及显式忽略仍有缺口 |
| [声音绑定与会话配置审查](decisions/voice-binding-review.md) | 目录校验/删除竞争、选角工具注册与互斥、冻结证据与推理覆盖；领域查询与发布拆分，清理失效翻译和重复生成物，原生验收单列 |
| [专业任务工具收敛与效率验证](../desktop-studio/task-efficiency-validation.md) | 领域纯试算、原子候选与直接交接；类型化评测、独立输入绑定及完整计量，含双轴审查和真实对照边界 |
| [工程助手与专业任务](decisions/professional-ai-tasks.md) | 统一交互与子Agent执行设施；分章任务隔离历史，章节归属分析/只读预审保持独立上下文，保留领域恢复、可观测与正式评测 |
| [分章Agent规范化](decisions/normalize-splitting-agent.md) | typed分章工具、权威作用域、失败事实、SSE错误/取消与原子候选发布；复用共享解码、错误分类和通用思考配置，含连续工具回合请求回归 |
| [后端类型边界](decisions/typed-backend-boundaries.md) | 工具参数/Schema同源、typed Tool拒绝计数、格式6阶段检查点、SeaORM查询与原子JSON保存 |
| [正式架构收敛](decisions/production-architecture.md) | 删除退役JSON/ECS、一次性脚本与归档；按纯核心/运行时/阶段/发布/观察收敛，保留正式评测 |
| [章节归属分析正式接入](decisions/chapter-agent-production.md) | 已接入原生Rig Agent、独立只读预审、阶段恢复、脱敏可观测和正式代码评测；思考按供应商能力默认最低、前端可改；真实两例冒烟/子agent复核，原生桌面另验 |
| [单一章节工作台与工程助手](decisions/unified-project-assistant.md) | 单一阅读器与工程助手会话、按任务工具、固定运行目标；验收边界见融合记录 |
| [统一章节工作台与工程布局](decisions/unified-chapter-workspace.md) | 上一阶段：双模式与独立助手已由单一工程助手替代；工程侧栏和阅读保护继续适用 |
| [章节归属工作流决定](decisions/chapter-attribution-workflow.md) | 首次初稿、重分析候选、角色身份与坐标/提示边界；原生和真实模型验收单独记录 |
| [章节归属分析交付](../desktop-studio/chapter-analysis-validation.md) | 已实现并通过自动化与 macOS 原生公开样本闭环；含实际模型错误、Schema/prompt 修正、撤回/迟到保存修复、用量与未覆盖平台 |
| [紧凑校对与原样显示](decisions/source-whitespace-presentation.md) | 用户确认后已实现：跨块空白合并、精确行号/复制/引用、显示切换锚点与选区；2026-11-12 补齐正文装饰排除与选区坐标浏览器回归；14 项源窗口/空白测试与浏览器验证，保留[调研依据](plans/source-whitespace-presentation.md) |
| [章节制作后续规划](plans/chapter-production.md) | 已更新：分析与声音绑定主链已验；整章生成优先，单章收尾与助手交互随后，章节音频实施前需独立规格 |
| [有声漫画承载方式决策](decisions/audio-comics-hosting.md) | 已拍板：留在 CastGlean 内实现，不另起项目、不做 Mihon 插件；立项仍待 spike 验证 |
| [LLM 通信与分章恢复的踩坑记录](lessons/llm-transport-and-recovery.md) | 已验证：本机代理、协议结束、工具计数、恢复订阅与原文完整覆盖 |
| [本地存储重构的 Windows 验证](lessons/local-storage-windows-validation.md) | 已验证（Windows）：本地工程、不可变来源、共享会话/Worker/订阅与真实桌面闭环；含临时音频锁、测试 manifest 和初始化失败修复；其他平台及真实模型质量未覆盖 |
| [分章工作台界面边界与验证](lessons/chapter-splitting-workbench.md) | 已实现：分章工作台、AI Elements 消息（Tiptap 已由章节归属工作流中的原生文本域替代）；隔离 IPC、Markdown/编辑器与原一万章分页通过（目录现由虚拟树替代），含 Vite 缓存隔离经验；真实桌面交互未验证 |
| [分析修订与工程修订不可互传](lessons/analysis-vs-project-revision.md) | 已修复：角色中心绑定/画像/采用曾误传分析修订致宿主 Conflict；分析域与工程域命令的期望修订来源不同，传参前核对宿主命令锁哪张表 |
| [展开与折叠的布局稳定分流原则](decisions/layout-disclosure-patterns.md) | 已定案：参考型→Popover、编辑型→就地替换、长文→accordion 带动画、异步→滚动流追加、状态→顶部横幅；角色中心已落地，含全站扫描结论与调研依据 |
| [分章原文连续虚拟阅读](decisions/continuous-source-reading.md) | 已实现：章内前后自动补读、章末显式切章、可变高度块与有界缓存，保留跨块复制/引用和精确定位；11 项窗口测试与浏览器回归通过，原生另验 |
| [目录、问题定位与稳定检查器](decisions/directory-and-inspectors.md) | 已实现：虚拟分卷树、柔和选中/对称留白/居中空状态、加宽目录与单行图标标签/常驻范围搜索（独立查询与滚动）、统一序号定位、紧凑章末、单行图标阅读工具/Info 元信息/同位置显示图标切换与完整本地检查空状态、固定本地问题入口与全应用附加浮层；大目录及实际路由浏览器验证，原生另验 |
| [分章工作台交互减负](decisions/chapter-workbench-interaction.md) | 已实现并经浏览器验证：一键检查、按需信息、明确行号跳转与阅读位置；含 NN/g、GOV.UK、Vercel 指南取舍 |
| [模型设置与列表容量](decisions/model-settings-listing.md) | 已实现：草稿查询、容量边界与合成验证；真实服务和原生窗口待验 |
| [全应用控件与交互一致性](decisions/desktop-interface-consistency.md) | 已实现：四档语义圆角、共享搜索、创建与设置减负；128 组中英亮暗/运行环境/页面检查和真实组件计算样式通过，原生桌面另行验收 |
| [桌面上下文栏与任务流程减负](decisions/desktop-workflow-layout.md) | 已实现：替代标题说明式页头、集合操作集中、连续创建/选文件、紧凑表单/候选分区；含 Apple/Atlassian/Carbon 调研与取消/重试、键盘、128 组页面检查；分章已并入窗口顶栏，补充实际路由的两侧面板与 8 组布局验证 |
| [会话模型、上下文用量与默认限制](decisions/ai-conversation-controls.md) | 已实现：移除正常会话固定配额、真实服务商 token 用量、可选窗口/输出参数和直接切换下次模型；190 项宿主测试/Clippy 与浏览器回归通过，原生 UI/真实厂商另验 |

## 怎么使用

开始工作时先找相关条目，再核对所属主规格、活动变更和当前代码；不要把历史记录直接当作当前行为证明。已有领域文档保留原位置，知识库通过链接建立入口，不为统一目录而移动所有文档。

| 目录 | 适合保存的内容 | 应保留的边界 |
| --- | --- | --- |
| `plans/` | 阶段目标、依赖、下一步与待验证问题 | 规划不代表已批准或已实现；执行任务归 OpenSpec |
| `decisions/` | 问题背景、备选方案、取舍、影响与重新评估条件 | 具体功能设计仍归所属 spec；有实际决策时再创建文件 |
| `lessons/` | 可复现故障、原因、修复和预防方式 | 区分假设、自动测试、真实验收及未验证平台 |

每条记录保持简短，包含：日期与状态、适用版本/平台、问题或目标、原因与选择、验证证据、相关链接，以及尚未解决的问题。只有简单结论时，不必机械地拆出全部章节。

在解决问题的同一改动里更新记录与索引。新结论替代旧结论时，标明替代关系并更新现行文档；跨功能复用的做法提炼到 `docs/engineering.md`，长期必须遵守的短规则再提炼到 `AGENTS.md`。不把案例全文复制成规范，不用新增笔记代替修复源码。

不收录密钥、私人小说、模型文件、运行产物和整段日志。证据尽量链接公开合成测试、源码、规格、提交或经过整理的验收报告。

## 当前边界

- 已交付：本地导入/分章、章节角色与归属闭环、统一工程助手。现行要求见主规格，验证入口见本索引；较早 UI 记录保留当时证据，已标明后继方案。
- 仍有未完成任务：视觉系统的指定原生验收、音色中心、TaleChime 集成，保留对应活动变更；不以其他功能验收代为勾选。
- 声音绑定与 AI 选角建议已按 `bind-character-voices`（2026-11-10 归档）交付：schema v4、原子提交工具的选角任务、描述必填与反向引用。其上叠加 `restructure-character-center`：角色中心 master-detail 重构、选角会话入口（自定义要求随消息冻结）、结果卡审阅直达与设计候选预选绑定；macOS 原生与真实模型主链已验；建议撤回与显式忽略尚未实现，原归档勾选已补纠正说明，活动重构变更保留未完成任务。
- 整章顺序生成与连续播放：宿主和前端已实现；后端处理文本，续跑比较冻结的模型资源和文本算法身份。原生窗口与人工听感尚待验收，见[验证说明](../desktop-studio/chapter-audio-validation.md)。角色分段、底部轨道、停顿与 WAV 导出已按 `chapter-audio-workbench` 实现并通过自动化验证，原生待验；局部重做与候选采用仍待完成。
- 统一日志与诊断（`host-logging-and-diagnostics`，2026-11-11）：宿主/前端/引擎事件统一进平台日志目录的滚动文件（隐私红线：只记 id 与度量），设置页可导出诊断包；真实应用冒烟实证了落盘、log→tracing 汇入、panic 记录与 `--verbose` 性能事件，界面交互与"生成→导出"闭环待窗口验收。
- 后续候选：整书批量、读音与演绎；漫画与小模型训练调研不是已启动功能。
