# 验证记录

日期：2026-11-17；macOS arm64。应用前后端已切到 AG-UI；以下分别记录类型实验、自动化与真实执行，不代表完整 AG-UI conformance 或所有平台验收。

## 采用边界

- Rust 精确 `ag-ui = 0.5.0-alpha.3`，关闭默认特性。`cargo tree -e features -p ag-ui` 核验仅类型依赖，没有开启其 client/server/http/sse runtime；宿主继续复用 Rig/Tokio。
- TS 精确 `@ag-ui/client/core 1.0.4`、`@assistant-ui/react 0.15.36`、`@assistant-ui/react-ag-ui 0.1.10`，RxJS 7.8.1 与 client 统一。
- 按用户最终决定直接使用库类型，不修正 `subAgents` 命名，不添加通用非法文档/schema 拦截。后端使用标准文本/reasoning 生命周期、消息/状态快照、运行与子任务事件；不发送退役 THINKING、JSON Patch 或旧 AI SDK chunks。工具事实通过标准 assistant/tool 消息配对投影。
- SQLite v9 保留工程与领域数据，将旧 agent 会话标为版本 0、保留但排除列表/执行。没有在用户日常数据库执行迁移试验；原生验收使用独立应用标识 `com.yexiyue.castglean.agui-validation`。

## 类型实验（历史依据）

typify 0.10.1 对固定官方原 schema 生成预期失败（101，not-null panic）；诊断投影编译成功但放宽约束，不引入应用。`ag-ui` 的 31/31 官方事件、7/7 消息及 RunAgentInput 字段表面无缺失；135/135 合法文档往返满足原 schema，21/84 非法文档被 serde 接受。此结果不当作生产端全协议认证。固定来源、372 次探针、哈希/锁文件与命令见 [spike README](../../../docs/research/spikes/ag-ui-typify/README.md)。生成物/报告仅在被忽略 target 目录。

## 自动化

- 宿主库：`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`，432 通过、10 按原配置忽略；额外真实模型测试另列。
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`、`cargo fmt --check`、`RUSTDOCFLAGS='-D warnings' cargo doc --no-deps --lib`：通过。
- Specta 导出集成测试：通过，bindings 由导出器生成。macOS debug 链接器仍报告已有 `__eh_frame` 体积警告；不把它记为测试失败或正式发布包验收。
- Vitest：77 通过；使用真实 AbstractAgent/Observable，覆盖只读重连、游标缺口、停止受理竞争、响应丢失、未决请求跨实例及分页旧任务归因。
- `pnpm build`、tsc、Lingui extraction、Biome 和视觉边界检查：通过。全库 Biome 有既有 Tailwind 排序等 warning，未将全库无 warning 当成已达成。
- 浏览器：首次 assistant/workspace/chapters 扩大回归 60/66 通过。代码与翻译仍在修改时出现页面加载超时/重载；随后独立重跑，中断继续中英文×亮暗四组、空白原文引用、批量导入恢复和工作台 chrome 通过。滚动测试原先用脚本赋值 scrollTop，落在初始程序滚动期间；现改为真实 wheel 输入并等待回到底部按钮的 data-active 状态，单独通过。最终稳定代码上 assistant 全目录与 desktop-polish 合计 13 项通过，后者覆盖 128 个页面/主题/语言/运行环境组合；另补 structure-confirm 单项通过。原批次全部 6 个失败均已在稳定代码上通过复验；不把复验描述为同一次完整 66 项全部通过。

宿主新增覆盖：非空 v8 及 v7→v8→v9 升级/失败回滚，正文元数据、人工修正/撤销、候选与音色引用保留；旧排队行不能领取。持久问题、回答幂等、新 run、同子任务身份、受理事务内转移 queued 子调用；取消后问题不可回答、子任务先收尾；问题提交后崩溃恢复仍可回答且不请求模型。真实 Rig fixture 核验 `request_input` 的工具事实/问题原子提交、一次调用后停止模型循环并释放活动名额。原有领域/队列/正式评测回归继续运行，实现摘要已纳入共享协议/任务/归因代码。

## 真实模型与 macOS 原生

验证端点为显式选定的本机网关，模型 `zcode/GLM-5.3-Flash`；公开合成两章共 313 UTF-8 字节。未读取私人小说或输出凭据。

- opt-in `selected_real_model_public_chapter_acceptance -- --ignored`：1 项通过，覆盖真实归属分析核心。
- 原生 bridge 已核验 connected、独立 identifier、schema 9；真实 UI 发送普通对话、重启后读历史、再次发送成功，终态不残留额外模型请求。
- 原生点击检查分章后离开页面：后台成功，子任务 `chapter_splitting` 成功；该样本结构完整，模型没有制造不必要候选，工程 revision 保持 2。
- 原生分析本章：`chapter_analysis` 及嵌套 `review` 使用独立调用身份并成功收尾，返回分析结果引用。
- 原生自然语言发起选角：`casting` 成功，关联父工具和父消息，生成 `casting_suggestion`；建议等待人工逐项采用，没有自动绑定。
- 选角采用前旁白绑定为 0，显式采用一个有效预置音色后为 1；相同 commandId 重放同一回执，没有重复绑定。
- 真实必要问题经标准 request_input 挂起，再通过 resume 创建新 run 回答成功；受理状态核对返回相同身份，中断只消费一次。
- 真实运行中显式取消，命令先返回 cancelling，之后查询为 cancelled。
- 以上截至选角累计台账为 11 次请求、89,740 输入字节、7 次工具、4,372 结果字节；这是该隔离会话累计观察值，不是单任务 token 消耗，也不代表完整计费。

原生 1024×680 的中英文×亮暗四组已截图，中文浅色与英文深色已逐图检查，问题、输入区及操作可见，无横向溢出；图在被忽略的 `src-tauri/target/agui-acceptance/native-{locale}-{theme}.png`。受理/恢复过程中曾因开发依赖预构建重载出现 Lazy 导入失败，稳定后重载恢复；浏览器自动化抢占前台时 WebView 会 hidden，视觉检查在其结束并聚焦原生窗口后完成。原生问题表单已实际输入并提交，继续 run 成功且表单消失。浏览器夹具不替代原生或真实模型质量验收；Windows/Linux/发布包未验。

## 已修复的回归与实现取舍

- 候选发布曾提前结束 run，导致子任务最后写入撞租约；领域发布改为只提交结果，任务所有者先关闭子任务再结束 run。
- 父助手与子任务曾共享输出假设；现在每生产者独立稳定消息，领域与正式评测断言同步为该契约。
- 官方 runtime 的短 runId 不满足旧 UUID 假设；受理身份改为有界不透明字符串，保留幂等与冲突校验。
- 原生回答后曾将整段 resume JSON 当作用户消息展示；现只保存回答 payload 作为聊天文字，路由身份留在中断事实中，协议门面回归核验两者分离。
- runtime append 不等待受理，快照单独也不足以保证问题可回答；受理等待、迟到会话隔离和标准流式边界的经验见 [恢复边界](../../../docs/knowledge/lessons/ag-ui-runtime-restore.md)。
- 恢复从 SQLite 权威事实加有界内存交付缓冲重建完整事件边界，不另建持久事件日志。旧 `StreamEvent`/AI SDK transport 与 UI 协议投影已删除；Rig 自己的同名 streaming::StreamEvent 是模型 SDK 类型，继续使用。

`assistant-guided-production` 的目标步骤、选声/审阅专用决定和音频任务卡不由通用 AG-UI 中断自动交付；已核对两项在途变更重叠边界，未冒领其未完成任务。当前任务勾选为 23/24，剩余 6.3 保持未勾选：macOS 原生关键流程、回答及四组外观已验，但最后停止按钮交互在 WebView 暂停/脚本超时期间未成功驱动；该次按钮尝试的运行随后正常完成，取消命令返回已完成状态；另一次真实运行已验证 cancelling→cancelled。不能把命令层取消通过冒充该按钮的完整原生验收。Windows/Linux/发布包亦未验。

## 2026-11-17 后续：新工作区停止与工具-only 恢复

上述首次验收中“停止按钮未取得原生点击证据”的子项，现由 [redesign-agent-workspace 原生记录](../redesign-agent-workspace/validation.md#原生与真实模型)补充替代：隔离公开工程、visible 窗口实际点击普通 composer 与任务区段的停止按钮，并回读 cancelled；停止中仍禁用操作。此处只补该子项，不自动勾选本变更的整组原生验收任务。

新 UI 验收另暴露工具-only 根问题恢复缺少工具生命周期的问题，修复仍归本协议生产端 `ai/protocol.rs`；标准工具事件由现有事实派生，不新增协议 reducer/持久事件日志。Rust、真实捕获帧的官方 runtime 回归与最终原生边界以[工作区验证](../redesign-agent-workspace/validation.md)为准。
