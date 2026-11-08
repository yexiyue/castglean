# 项目知识库

保存开发过程中可以复用的规划、决策和踩坑经验。当前功能状态以[根 README](../../README.md)为准，现行功能契约以 [OpenSpec 主规格](../../openspec/specs/) 为准；[活动变更](../../openspec/changes/)记录待完成工作，[归档](../../openspec/changes/archive/)保留历史决定，工程规范以 [AGENTS.md](../../AGENTS.md) 与[工程约定](../engineering.md)为准。

## 内容索引

| 记录 | 状态与用途 |
| --- | --- |
| [章节工具 Agent 方案 C 对照](../desktop-studio/chapter-tool-agent-validation.md) | 现有 Agent 与 ECS 共用草稿工具、校验反馈、修正预算和实际模型桥；公开对照整轮门禁拒比、真实小说两路线均未交付；含成本/阶段观察及边界 |
| [Rig ECS 隔离评测原型](decisions/rig-ecs-evaluation-prototype.md) | 0.46 真实 agent/effect 与三路并发、只读预审、取消及 SIGKILL 恢复；公共 known-only 离线机制与可选原生凭据桥已对齐，真实在线失败/路线对照见验证；生产迁移未验 |
| [Agent 运行时与 AI 预审](plans/agent-runtime-and-ai-pre-review.md) | 当前并发限制与 Rig 0.46 ECS/harness/子 agent 插件调研；一次 47 秒盲预审命中已知误判，正式接入尚未实施 |
| [章节分析协议对照实验](plans/chapter-protocol-experiment.md) | 同一真实章节 8 次正式对照完成：预切片＋紧凑协议 2/2 交付、73–87 秒；含嵌套引语误判、空白缺口、缓存与低思考边界，未改变正式流程 |
| [单一章节工作台与工程助手](decisions/unified-project-assistant.md) | 单一阅读器/会话、按任务工具、固定运行目标、旧历史只读；验收边界见融合记录 |
| [统一章节工作台与工程布局](decisions/unified-chapter-workspace.md) | 上一阶段：双模式与独立助手已由单一工程助手替代；工程侧栏和阅读保护继续适用 |
| [章节归属工作流决定](decisions/chapter-attribution-workflow.md) | 首次初稿、重分析候选、角色身份与坐标/提示边界；原生和真实模型验收单独记录 |
| [章节归属分析交付](../desktop-studio/chapter-analysis-validation.md) | 已实现并通过自动化与 macOS 原生公开样本闭环；含实际模型错误、Schema/prompt 修正、撤回/迟到保存修复、用量与未覆盖平台 |
| [紧凑校对与原样显示](decisions/source-whitespace-presentation.md) | 用户确认后已实现：跨块空白合并、精确行号/复制/引用、显示切换锚点与选区；14 项源窗口/空白测试与浏览器验证，保留[调研依据](plans/source-whitespace-presentation.md) |
| [章节制作后续规划](plans/chapter-production.md) | 已更新：角色与归属、统一助手已交付；声音绑定和章节音频仍待独立规格 |
| [有声漫画承载方式决策](decisions/audio-comics-hosting.md) | 已拍板：留在 CastGlean 内实现，不另起项目、不做 Mihon 插件；立项仍待 spike 验证 |
| [LLM 通信与分章恢复的踩坑记录](lessons/llm-transport-and-recovery.md) | 已验证：本机代理、协议结束、工具计数、恢复订阅与原文完整覆盖 |
| [本地存储重构的 Windows 验证](lessons/local-storage-windows-validation.md) | 已验证（Windows）：本地工程、不可变来源、共享会话/Worker/订阅与真实桌面闭环；含临时音频锁、测试 manifest 和初始化失败修复；其他平台及真实模型质量未覆盖 |
| [分章工作台界面边界与验证](lessons/chapter-splitting-workbench.md) | 已实现：分章工作台、AI Elements 消息（Tiptap 已由章节归属工作流中的原生文本域替代）；隔离 IPC、Markdown/编辑器与原一万章分页通过（目录现由虚拟树替代），含 Vite 缓存隔离经验；真实桌面交互未验证 |
| [分章原文连续虚拟阅读](decisions/continuous-source-reading.md) | 已实现：章内前后自动补读、章末显式切章、可变高度块与有界缓存，保留跨块复制/引用和精确定位；11 项窗口测试与浏览器回归通过，原生另验 |
| [目录、问题定位与稳定检查器](decisions/directory-and-inspectors.md) | 已实现：虚拟分卷树、柔和选中/对称留白/居中空状态、加宽目录与单行图标标签/常驻范围搜索（独立查询与滚动）、统一序号定位、紧凑章末、单行图标阅读工具/Info 元信息/同位置显示图标切换与完整本地检查空状态、固定本地问题入口与全应用附加浮层；大目录及实际路由浏览器验证，原生另验 |
| [分章工作台交互减负](decisions/chapter-workbench-interaction.md) | 已实现并经浏览器验证：一键检查、按需信息、明确行号跳转与阅读位置；含 NN/g、GOV.UK、Vercel 指南取舍 |
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
- 后续候选：声音绑定、演绎和章节音频闭环；漫画与小模型训练调研不是已启动功能。
