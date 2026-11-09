# 本地存储与 AI 运行时的 Windows 验证

日期：2026-11-07。适用版本：Windows、SeaORM 2.0.4、Apalis/Apalis SQLite 1.0.0、Rig 0.46.0、graph-flow 0.8.1、AI SDK 7.0.163 / React SDK 4.x，以及相邻 TaleChime 工作区。本记录替代本文件早期各接入阶段的“主链尚未切换”结论；不代表其他平台或发布包验收。

## 架构与验证边界

- [工程用例](../../../src-tauri/src/project/edits.rs)、[导入确认](../../../src-tauri/src/novel_import/confirm.rs)和[候选事务](../../../src-tauri/src/novel_import/splitting/store.rs)拥有各自短事务；来源验证/发布、regex 和模型网络均在事务外。目录、卷、修订、撤销、候选状态及幂等回执共同提交，任何侧失败均回滚。
- [来源发布](../../../src-tauri/src/project/assets.rs)校验原始字节与确认编码对应的正文，采用不覆盖发布。来源 id 不重绑定不同内容；撤销只保存来源元数据及摘要。先发布文件后数据库失败可留下无引用文件，不自动清理用户旧文件。
- [共享 AI](../../../src-tauri/src/ai.rs)只保存一次消息/工具事实；[调度](../../../src-tauri/src/jobs/runtime.rs)只传 run_id，领取与写入受 owner/generation 保护。等待输入释放名额，重试新建身份并保留预算，已开始的 run 不整轮自动重试。
- [交付流](../../../src-tauri/src/ai/stream.rs)有界、按提交 cursor 排序，慢消费者或缺口要求重读；[前端 transport](../../../src/lib/ai/transport.ts)的卸载和重连不 start/cancel。候选状态按引用独立查询，聊天“同意”没有采用权限。
- 主界面已接新 IPC；旧 Recovery、便携文件 parser/打开保存、最近文件、Diagnostic DTO/transport 和旧契约测试已移除。纯 UTF-8/完整分区校验保留。旧目录不扫描测试验证原文件保持原样，没有双写或兼容 facade。

官方 Entity、handler/Data 和 Transport 扩展点如何落到具名模块，见[工程约定](../../engineering.md#官方实践在本仓库的落点2026-11-07)及[本次设计](../../../openspec/specs/background-ai-execution/spec.md)。没有通用 repository 基类、额外 runtime 或 Node 产品后端。

## 实机流程证据

使用临时 Tauri 配置、独立标识 `com.yexiyue.castglean.runtime-acceptance` 和真实 WebView2/宿主。配置、截图和构建产物放 ignored target；不替换另一工作树正在运行的实例，不改正式应用数据。产品无 MCP bridge，验收使用仅临时配置启用的 CDP 和原生文件选择器；正式配置未加入调试端口。

模型使用[本机 OpenAI 协议夹具](../../../tests/helpers/runtime-model.mjs)，只监听 127.0.0.1，不记录请求正文；人工步骤使用公开合成 TXT，不发送私人小说。夹具证明协议、事务和生命周期，不证明真实模型建议质量。

| 场景 | 已观察结果 |
| --- | --- |
| 冻结输入与自动保存 | 原生选择 TXT 后移动最初输入，仍能预览/确认；导入后直接进入工作台，默认检测 2 章，无另存为。 |
| 切页期间执行 | 启动诊断后进入音色页，后台保存 2 次模型请求、1 次工具调用，返回后显示同一助手和候选，没有重发 start。 |
| 明确采用 | 模型发现 `【二】`，候选 3 章；点击采用后 revision 2→3、目录变 3 章，历史工具事实不变。 |
| 原文完整性 | BOM、CRLF、CR、LF、中文和 emoji 共 130 UTF-8 字节；导入/采用/人工改标题后来源摘要与移动后的原文件一致，章节连续覆盖 0..130。 |
| 提交失败与重试 | 仅在独立验收库临时注入 projects 写入失败；页面显示操作失败，revision 保持 3、原标题不变。撤去故障后同一操作成功，revision 为 4；未显示虚假的新目录。测试 trigger 已撤除。 |
| 人工修改使方案过期 | 修改首章标题后，旧候选保留摘要和聊天记录，显示 outdated 且采用按钮禁用；来源摘要不变。 |
| 退出重开 | 正常退出后重启，首页恢复同一工程及 3 章；进入工作台保留原文和目录，不需打开工程文件。 |
| 明确失败重试 | 夹具首请求返回 500，界面显示安全错误；点击 Retry 新建 retry_of，累计请求为 3，宿主和界面均保留用户、旧中断助手及新助手共 3 条消息，不显示原始响应。 |
| 长历史 | 12 轮真实调度、24 次模型请求，先恢复最近 20 条消息，点 Earlier messages 补齐 24 条；不重复或回退最新 cursor。 |
| 双会话与界面响应 | 两个连接的会话同时处于 running，窗口任务计数为 2；期间设置、深色主题和英文切换可操作，任务独立完成。 |
| 主题与语言 | 已检查中文浅色和英文深色的工程/诊断流程；原生窗口宽度实际缩到 1024，页面无横向溢出。已按产品窗口装饰配置验证实际 1024×680：正文、目录与诊断可通过滚动访问，中英文均无横向溢出。 |

关闭窗口前的真实后台任务提示已验证；一次在途退出/立即重启的组合操作被自动审批拦截，未据此声称完成在途桌面恢复。随后明确取消自建测试执行，确认 cancelled、计数 0 后正常关闭。正常桌面重启与明确失败重试已实测；在途重启不自动请求、旧所有者迟到写入被拒绝、用户显式继续保留预算，由真实 SQLite/Worker 故障回归证明。

## 非直观约束与修复经验

### Windows 临时音频锁（相邻 TaleChime）

触发：全量 CastGlean 回归中的音色保存/删除/取消预览报 Windows 错误 33。`temporary()` 锁住 WAV 字节，`publish()` 又按路径重开，Windows 拒绝读取。经用户明确授权，在相邻 `talechime-core/src/voices/store.rs` 改用 Scratch 目录独立 `.lease`；发布/回收在库锁内先释放自身租约，再重命名或删除，仍跳过其他活动所有者。没有放宽活动文件保护，也未引入模型依赖。

该阶段 TaleChime 核心 70 项测试、相关 Clippy/rustdoc，以及 CastGlean 原失败的三项音色测试通过。未发布 SDK 版本；其他平台未实测。

### Windows bindings 测试启动

触发：specta_export 子进程在执行测试前报 `0xc0000139`。临时 loader snaps 定位到 `TaskDialogIndirect`：测试目标没有应用目标的 Common Controls v6 manifest。`build.rs` 现只为 Windows tests 嵌入 `windows-test.manifest`，真实导出恢复；没有加入 CRT DLL、修改系统依赖或保留调试设置。

### Apalis 共享 SQLite 池与唤醒

`SqliteStorage::setup` 会在共享连接设置 synchronous=OFF，不能用于应用池；改为仅运行队列 schema migrator，由 database.rs 统一设置 NORMAL/WAL/FK/busy_timeout。测试同时占用 4 个池连接核验配置。Worker 使用显式 250ms poll interval，避免下一批队列项停留到心跳才唤醒；用两个独立服务的真实 SQLite Worker 验证重叠和受限连接不占满所有 Worker。

### AI SDK 恢复与 regenerate

SDK 的 regenerate 会先从界面移除最后一个助手。宿主历史不允许覆盖旧失败记录，因此 transport 接受/通知时按宿主稳定 id 恢复投影，再让 chunks 更新当前助手；仅停止本地 reader 不等于取消后台任务。真实 SDK Chat 测试覆盖已有助手恢复、reset-step、重试保留旧助手；桌面重试也核对了宿主/可见消息数量。不要凭对 SDK 常见行为的猜测移除这一恢复步骤。

### 初始化失败不能回落到空工程

逐项审计发现：未知 schema 已会拒绝初始化，但原应用入口只会终止。现在隐藏主窗口，显示中英双语原生错误，指引保留应用数据、检查权限并使用支持该库的应用版本，确认后退出；早于 LLM/Worker 初始化返回。隐藏 WebView 的迟到命令在统一 IPC 入口返回受控错误，避免访问未 manage 的状态。

独立验收库设置 user_version=999 后，已看到原生提示，所有表结构和行的逻辑导出摘要保持一致、版本仍为 999；没有清空、降级或启动旧工程导入。迟到 IPC 返回受控 local_data_unavailable，日志无 panic；恢复验收库原版本后正常重启，首页、三章目录、人工修正和正文均恢复。最后正常退出，临时协议夹具已停止。

### 执行前必须校验磁盘正文

2026-11-07 代码审查发现，图的 scope 检查只比数据库中的 revision/hash；磁盘正文损坏且模型未调用读取工具时，诊断仍会发送请求。回归先在原实现复现成功返回，再修复为执行入口在 blocking pool 复用 project/store::read 的摘要核验，文件 IO 不持有数据库事务；后续节点继续复核 revision/hash，恢复跳过 prepare 也不能绕过入口。损坏正文回归确认返回安全存储错误、模型请求与预算为 0、没有助手记录，损坏文件保持原样。

### 测试必须等待实际 handler 释放

全量并发回归暴露了一处测试观察竞态：终态事务提交后、提交后通知及 RAII guard 返回前，另一个任务已能读到终态。测试现以 3 秒上限等待实际 admission 归零，再验证新任务准入；不是固定延时或删除释放断言。旧所有者退出与两连接测试复用同一有界条件等待，继续验证名额最终释放。生产逻辑未为迎合测试改变提交语义。

## 自动检查与未验证边界

当前证据：宿主完整 cargo test 通过（184 库测试、1 项 bindings 导出、1 项编译覆盖集成测试；库 4 项、集成 2 项按原配置 ignored）；fmt、严格 Clippy 与 rustdoc 通过。AI Node 12 项通过（含真实 React/Lingui 渲染的未知摘要转义与工具原始错误屏蔽），音频播放 Node 9 项通过；TypeScript、构建、Lingui（英文缺失 0）与 lint 通过，保留原有 sidebar cookie 和中文 catalog 同时静态/动态导入警告。启动提示及统一 IPC 拒绝修正后已重新完成上述整套检查，bindings 导出后的 TypeScript 再次通过；严格 OpenSpec 校验和最终差异检查通过。

依赖树只有 SQLx 0.9.0 / libsqlite3-sys 0.37.0 一套 SQLite native link，SeaORM 与 Apalis SQLite 共用该驱动。来源摘要 DTO 已放回 project/query.rs，正文页放 project/text.rs，导入预览放 selection.rs；旧导入 types.rs 删除，绑定协议形状保持不变。

不承诺 token 级崩溃恢复、任意断电无损、退出后继续运行、真实模型语义质量或其他平台/发布包性能。6 项既有 ignored 涉及真实下载、原生凭据、网关或准备好的模型条件，普通回归不自动执行。此记录不替代任务勾选、用户授权或后续章节音频制作验收。
