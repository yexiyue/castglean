# 架构重构验收记录

## 归档前审查与提交范围复测

2026-11-26，按工程规范与提案分别审查。分章候选恢复私有字段及已完成回执缺失候选时的存储失败分类，三个调用方共用工程来源哈希查询。重试时的选角拒绝判定回归选角领域。助手模型确认使用同一键函数，音频状态模块承担启动与对话框状态，工作台继续协调跨面板导航。导入检查覆盖固定模板字符串和规范化后的本地路径。

| 提交范围 | Archify 发现 | 分析文件 | 解析错误 |
| --- | ---: | ---: | ---: |
| 前端原口径 | 110 | 254 | 0 |
| 前端应用源码 | 109 | 253 | 0 |
| Rust 宿主 | 36 | 190 | 0 |

同口径复测没有产生此前清单之外的 ID。两个更新器相关发现和三个前端目录聚合信号在提交范围内未报告。工作台圈复杂度为 266，章节音频状态模块为 18。工作台仍负责候选及助手结果的跨面板路由。三份报告位于原可视化目录的 `resolve-architecture-findings-20261126/archive-review`。后文保留集成工作区的原始复测和 167 条对账记录。

提交范围运行了前端 lint、build、103 个单测和 30 个不同的 Playwright 用例。章节重做、重录、底栏居中与助手输入回归已对最终前端重跑。Rust 的 472 个库测试与 Specta 导出、引擎库存两项集成验证通过。

## 最终复测

2026-11-26，以 CastGlean `7df146f2e4cc6b2269e8cef696288cd67fb42cb5` 和当时的工作区增量为输入。最终复测冻结当前源码，保留同工作区的 `release-desktop-app` 更新器增量。更新器界面与窗口关闭的两条新增项在逐项清单标为并行变更。前端沿用原始架构 IR，分析配置和阈值沿用基线。宿主以 `src-tauri` 为根。三份 Archify 3.3.1 报告、原始导入边和结构分量边清单保存于原可视化目录的 `resolve-architecture-findings-20261126/final-reconciliation`。

| 范围 | 原始发现 | 最终发现 | 分析文件 | 解析错误 |
| --- | ---: | ---: | ---: | ---: |
| 前端原口径 | 106 | 115 | 257 | 0 |
| 前端应用源码 | — | 114 | 256 | 0 |
| Rust 宿主 | 41 | 36 | 191 | 0 |

[逐条对账](archify-reconciliation.md)包含 147 条原始记录和 20 条复测新增记录，新增含此前列出的 11 条。两个前端口径的唯一结果差异是生成绑定的文件集中度。未修改分析规则、阈值或接受列表。

- 组件文件环及前端模块环消失。三个目录级泄漏诊断仍报告直接导入，原口径分别记录 28 条组件边、82 条 hook 边及 310 条库边。逐项核对入口和边方向，助手的选角和结构恢复表面已归共享领域，AI 会话进入窄入口。`pnpm lint` 拦截反向引用、助手直连工作台实现以及绕开 AI 公共入口。
- `ImportedWorkspace` 圈复杂度 390 → 268，文件行数 3,107 → 2,384。右侧章节检查器、原文行、阅读交接、面板几何和音频会话拥有各自实现。Archify 仍报告工作台装配集中度及其他函数分支，清单保留数值和职责判断。`ChapterAudioTrack` 157 → 135、`ChapterAudioControls` 149 → 118、`ChapterVoicePanel` 91 → 75、`LlmSettings` 101 → 85。
- 工程、导入和 AI 的跨域强连通分量消失。工程提供检测、严格解码与分区，导入确认依赖工程。AI 提交分章候选、工具事实、预算回执与检查点的事务，候选存储没有反向发布边。章音频启动命令的运行持久化移交受理模块。选角试听恢复分别处理已存预览、待重试项和再次审批。
- Rust 最终仍报 AI、引擎和队列三个域内结构分量。`structural-edges.json` 分别记录 29、31、7 条本地边。AI 的分量仅包含域内门面、助手的策略/适配实现及分章执行和发布。引擎去除 `mod` 声明边后可拓扑排序，队列去除声明和 `Runtime` 门面重导出后可拓扑排序。逐条清单保留原 ID 与后继 ID 的映射。Rust 解析器仍存在未解析引用，域边结论同时对照源码及宿主回归。

### 本轮自动化

| 验证入口 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm build`、`pnpm test` | 通过。24 个测试文件、100 个用例，包括 9 条导入边界样例。Biome 仍有 14 条警告，Vite 仍有分包告警。 |
| Playwright 相关用例，Microsoft Edge 和 Chromium | 107 个不同用例均取得通过记录，详见报告目录的 `browser-pass-list.tsv`。Edge 的连接中断、共享夹具停止后的连接拒绝在独立 Chromium 批次复跑。目录矩阵先等待实际控制按钮，再根据 `aria-expanded` 决定是否展开，修正读取过早导致把已展开目录关闭的竞态。覆盖助手、章节、资源、音色、导航及 1024×680 播放底栏。 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets -- -D warnings`、`RUSTDOCFLAGS='-D warnings' cargo doc --manifest-path src-tauri/Cargo.toml --locked --offline --no-deps` | 通过。 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline` | 473 个库用例及 Specta 导出、引擎库存两项集成验证通过。常规运行按条件跳过 14 项。Specta 输出与 Archify 冻结快照中的绑定字节一致。 |
| `CASTGLEAN_HUB_CACHE=… cargo test --manifest-path src-tauri/Cargo.toml --locked --offline real_kokoro_generates_a_multi_voice_chapter_in_order -- --ignored --nocapture` | macOS 上用真实缓存模型通过，最新运行耗时约 100 秒。 |

## 此前的隔离快照和原生验收

2026-11-26，CastGlean `7df146f2e4cc6b2269e8cef696288cd67fb42cb5` 基线及其工作区增量。诊断和自动化在隔离快照执行，保留本变更和章节音频既有修改，排除并行开发的 `release-desktop-app` 更新器、命令和生成绑定增量。原生验收使用独立 macOS 应用标识、本机模型缓存和公开合成文本。

### 隔离快照 Archify

Archify 3.3.1 基线复测逐项匹配原始报告的 147 个 ID 和证据摘要。前端使用同一份原始架构 IR 及原口径和校正口径，宿主以 `src-tauri` 为 Rust 根。未修改分析阈值。报告 HTML、JSON 和原生验收结果位于本次 Codex 可视化目录的 `.archify/resolve-architecture-findings-20261126`。

| 范围 | 基线 | 复测 | 分析文件 | 解析错误 |
| --- | ---: | ---: | ---: | ---: |
| 前端原口径 | 106 | 107 | 249 | 0 |
| 前端应用源码 | — | 106 | 248 | 0 |
| Rust 宿主 | 41 | 37 | 187 | 0 |

前端两条依赖环和宿主中断审批、日志命令、声音工作室媒体三条结构环已消除。工作台圈复杂度由 390 降为 300，目录、属性面板与助手栏的显隐、焦点和快捷键迁入 `useWorkspacePanes`，工作台仍直接协调候选和跨功能操作。引擎线程的模型准备受理与模型验证已独立，线程、任务登记和推理闸门继续共用。原始 147 条与 11 条复测新增逐项记录在[对账清单](archify-reconciliation.md)。仅随聚合变化消失的诊断、仍需逐边确认的内部泄漏、保留的复杂度及迁出后新增项继续开放。

宿主基线和复测的边清单位于同一可视化目录的 `before-rust-scc-edges.json` 与 `engine-rust-scc-edges.json`。采用 Archify 已解析的本地导入边并去除测试节点：

- 引擎分量包含 9 个文件、8 条 `mod` 边和 23 条命名引用。去除 `mod` 边后可拓扑排序。目录和准备消费引擎域的类型与状态。
- 队列分量包含 3 个文件、2 条 `mod` 边和 5 条命名引用。去除声明及 `Runtime` 的门面重导出后可拓扑排序。消费器调用 `Runtime::handle`，运行时和消费器共享 `RunJob`，运行时持有目录所有权锁。Apalis SQLite 使用任务类型名标识队列，因此保留 `RunJob` 的模块路径。
- AI 分量包含 18 个文件、15 条 `mod` 边和 38 条命名引用。分章阶段机通过 `ai::tasks` 注入诊断能力；分章存储仍从 AI 侧消费发布及回执接口，工程与导入模块仍共享分区与持久化结构。这些跨域边继续开放。

### 隔离快照自动化

| 验证入口 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm build`、`pnpm test` | 通过，91 个单测。Biome 与 Vite 输出警告。 |
| `pnpm test:ai`、`pnpm test:source`、`pnpm test:playback`、`pnpm test:binding`、`pnpm test:audition` | 分别通过 22、15、23、8、8 个用例，各批含重复计数。 |
| `pnpm test:browser`，Microsoft Edge | 46 个覆盖助手、章节、目录、角色、绑定与试听的用例通过。前端后续拆分额外通过 14 个音频、阅读、候选及片段恢复用例。 |
| Playwright 播放栏、面板及任务卡复测，Microsoft Edge | 首轮 8 个章节播放与音频用例通过。后续面板回归通过 12 个用例；目录关闭后过早读坐标的断言修正为等待几何收稳。最终底栏几何和两条助手音频任务卡用例全部通过。 |
| `node scripts/check-frontend-imports.mjs` | 仓库扫描通过。静态类型导入、类型 `import()`、重新导出、动态导入和 `require()` 的违规样例均拒绝，合法向下导入通过。 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets -- -D warnings`、`RUSTDOCFLAGS='-D warnings' cargo doc --manifest-path src-tauri/Cargo.toml --locked --offline --no-deps` | 通过。 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline` | 471 个宿主库用例及 Specta 导出、引擎家族库存集成用例通过。常规运行有 14 个按需测试跳过。 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline real_kokoro_generates_a_multi_voice_chapter_in_order -- --ignored --nocapture` | 使用 `CASTGLEAN_HUB_CACHE` 指定既有缓存，真实多音色用例通过。修正夹具计划与持久化来源 ID 不一致后重跑；真实单音色导入、归属、生成、停顿与 WAV 导出宿主用例也通过。 |

Specta 独立再生与变更基线的 `src/lib/bindings.ts` 字节一致。并行更新器的生成差异归该变更。Archify 原配置纳入了生成文件，校正配置将它排除，两个结果都保留。

助手音频任务卡由工作台提供共享播放会话的 `start`、`state` 与 `toggle`，删除任务卡对工作台播放 Provider 的直接导入。用例覆盖切章、重开助手、状态更新与返回原章。选角结果和分章结果仍各有一条到工作台组件的直接导入。

宿主验证覆盖受理回执重放、并发与重复派发、过期修订、取消排空、消费器心跳故障重建、审批与工具回执原子提交、分章诊断重启恢复。分章阶段机的单测直接注入诊断回调，已提交检查点及过时检查点两条路径以回调一旦执行即失败的断言验证。真实本地 SSE 的助手与分章集成用例仍沿宿主真实执行入口。

### 真实桌面

- macOS 26.6.2，arm64，Tauri 原生 WebView。导入公开合成 TXT，确认人工归属与剩余旁白，选择两种 Kokoro 预置声音，生成单音色和多角色音频，跨章保持播放。局部重录继承一个单元，完成后由用户动作采用版本。
- 工程助手使用本机 OpenAI SSE 夹具。实际宿主接收 `check_splitting` 委派，首个分章请求受控失败，再以原运行显式重试。夹具收到一次根助手请求及两次分章请求，重试成功。本机受控协议验证与外部服务模型质量独立。
- 原生应用调整到 1024×680，中文亮色、中文暗色、英文亮色、英文暗色四组合均检查工作台和播放栏，有正确翻译、主题 CSS 变量及零横向溢出。Tauri WebView 使用应用自己的语言激活入口和主题 CSS 切换完成此矩阵。
- 播放按钮定位复测覆盖 1024×680 和 1440×680。1024 像素宽、属性面板打开时，按钮中心由 376 移至底栏中心 538。1440 像素宽时同时打开目录和属性面板，按钮中心与底栏中心均为 900。各状态均零横向溢出，设置、版本、导出和展开轨道按钮可点击。截图及几何记录随 Archify 产物保存。
- 从已采用版本调用真实 WAV 导出命令，用原生保存面板保存到独立路径。宿主返回 `succeeded` 和 2/2 单元。产物为 318764 字节、24 kHz、16 bit 单声道 PCM WAV，宿主报告时长 6640 ms。

Windows、Linux、外部模型响应质量及其他语音引擎的真实听感未在本次验证。
