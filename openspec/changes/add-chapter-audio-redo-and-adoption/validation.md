# 验证记录

日期：2026-11-23 至 2026-11-24。环境：macOS（Apple Silicon），Rust 宿主测试与 Chromium 浏览器夹具。先记录自动化检查，再记录独立的 macOS 原生与真实模型验收，人工听感边界见文末。

## 宿主

`cd src-tauri && cargo test`：库测试 470 项通过、12 项按原配置忽略，集成测试（含 `specta_export`）通过。本变更新增 8 项，均不加载模型：

- `derived_runs_inherit_identical_units_and_only_redo_changed_ones`：改第 2 个单元的声音后只重做该单元；沿用单元有独立产物身份、位于派生目录且与来源逐字节一致；来源任务、采用状态与单元不变；派生任务成功后成为当前采用版本、原版本让位；新进程的启动恢复重建沿用单元的媒体登记，当前版本解析为完整可播。
- `units_without_readable_audio_or_with_other_inputs_are_redone`：来源的模型、合成文本语义或制作方式不同时不沿用；产物文件缺失的单元回到重做。
- `retakes_wait_for_an_explicit_decision`：空的、空白单元的、越界的重录请求被拒；重录成功进入待采用，当前版本保持可播且待采用版本是章节状态；未完成、待采用与被取代的版本不能导出；放弃只作用于待采用版本，重放不重复提交，同一操作换内容冲突；已放弃版本不再是章节状态、不进版本列表；采用让先前的当前版本让位；缺文件的版本不能被采用；重新采用先前版本后章节状态与当前版本都回到它。
- `derived_runs_inherit_pauses_that_still_anchor_to_a_boundary`：单元合并后锚定在字节 6 的停顿被舍弃并计数，锚定在字节 12 的停顿映射到新单元并作为修订 1、不可撤销；来源编排不变。
- `redo_preview_is_read_only_and_only_reports_compatible_sources`：预检返回可沿用数、重做数与位置；来源不存在、不属于本章或执行配置不同时不报告范围也不报错；预检后没有新任务，也没有为沿用准备任何副本。
- `derived_runs_synthesize_only_changed_units_and_adopt_on_success`（执行循环）：计划变化不能续跑原任务；派生任务只把变化的单元送进引擎，整章拼接按正文顺序，沿用单元保持原幅值，来源的整章文件不被改写。
- `retakes_finish_pending_until_the_user_decides`（执行循环）：重录只把指定单元送进引擎，成功后待采用，当前采用版本保持。
- `v12_audio_runs_adopt_the_latest_success_per_chapter_and_mode`：v12 升到 v13 后每章每种方式最近的成功任务成为当前采用版本，失败任务与其他成功任务保持未涉及；新列默认值正确；升级建立的唯一索引拒绝第二个当前采用版本。

既有测试扩充：`current_schema_enforces_chapter_audio_constraints` 增加新列默认值与唯一索引断言；`v11_chat_and_running_checkpoint_survive_the_summary_column_upgrade` 验证 v11 逐级升到 v13。

静态检查：`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`RUSTDOCFLAGS='-D warnings' cargo doc --no-deps --document-private-items` 均通过。

## 前端

- `pnpm build`（`tsc && vite build`）通过；`pnpm lint`（Biome 与 `scripts/check-visual-boundaries.mjs`）通过，14 条警告均为既有的共享控件类排序提示，不在本变更的文件里。
- `pnpm test`：23 个文件、91 项通过。新增 4 项覆盖 `pendingVersion`、`exportableVersion`、`derivedProgress` 与 `versionRole`。
- `pnpm i18n:extract` 后英文缺译为 0，`lingui compile` 通过；本变更新增 22 条中英文案。
- Specta 绑定由 `cargo test --test specta_export` 重新生成，`tsc --noEmit` 通过。

## 浏览器夹具

新增 `e2e/chapters/chapter-audio-redo.spec.mjs`，5 项通过：

- 计划变化后下一步显示「重做 1 段」，预检带沿用来源，发起请求为 `{ kind: "fresh", inherit_from }`；进度显示「重做中 0/1」且 `aria-valuenow` 为 0；沿用单元与重做位置正确；重做失败后可定位失败单元并续跑同一任务，期间不出现采用提示、当前版本仍可播；完成后可整章播放与导出。
- 没有可沿用单元时显示「生成新版本」，请求仍带沿用来源，进度按整章计数。
- 检查器「重做此段」发起 `{ kind: "retake" }`；完成后就地出现「已重录 1 段，等待决定」及试听、采用、放弃，默认播放和 WAV 导出仍指向当前采用版本；试听从重录单元起播；放弃停止对该版本的播放并回到当前版本；再次重录后采用，播放与导出切换到新版本。
- 版本列表标明当前版本，可查看历史版本（轨道切到该版本、导出不可用），重新采用后当前版本让位，并可返回当前版本。
- 英文、深色主题、1024×680：用键盘完成重录与采用，页面无横向溢出。

相关回归：13 个涉及章节音频的 spec 文件共 42 项，完整重跑 40 项通过。两项失败均不由本变更引起：

- `chapter-cross-navigation` 在干净基线 `a73633f`（分离工作区）上同样失败，偶有通过；用同一流程在 1024×680 下探测，文档宽度为 1024、没有溢出元素。
- `pause-recovery` 在该轮因测试框架关闭浏览器上下文时的偶发错误失败，单独复跑两次与上一轮完整运行均通过。

夹具更新：`tests/helpers/audio-workbench-fixture.ts` 按宿主规则解析采用状态、版本列表与三种发起请求；`tests/helpers/desktop-fixture.tsx` 处理非音频页面的版本列表读取；`chapter-audio-state-fixture.tsx` 为状态竞争测试补版本列表桩；`refined-chapter-audio.spec.mjs` 的续跑断言改为新的请求形态。

## 开发中发现并修复的问题

- 导出按钮提示曾在任务生成中显示「采用后可导出 WAV」，使既有音频工作台用例超时；改为查看未采用的完整历史版本时提示，待采用结果可从独立入口试听。
- 测试夹具读取重录请求时字段名写错（`runId` 应为 `run_id`）；非音频页面读取版本列表未在通用夹具中处理，使四个用例把该命令记为意外调用。
- 放弃正在试听的重录版本时原先继续播放，改为同时停止播放。

## 提交前审查回归（2026-11-24）

- 宿主库复跑 471 项通过、12 项忽略。新增用例验证生成已发起后改绑，成功产物仍可读取，当前采用版本保持。迁移用例以同秒且插入顺序相反的任务验证遵循 v12 的排序。
- 前端构建、lint 与 91 项单测通过。章节重做与音频工作台的 13 项 Chromium 回归通过，包括待采用期间默认播放与 WAV 导出仍使用当前版本，以及 1024×680 下的中英文、亮暗主题和键盘操作。
- OpenSpec 严格校验 50 项通过。归档前依赖既有章节音频及编排主规格，版本列表当前最多返回最近 32 个任务。

## macOS 原生流程验收（2026-11-24）

macOS Apple Silicon，Tauri 2 调试窗口与 schema v13 隔离工程。使用自撰短篇、Kokoro `1.1-zh-g2pw` CPU 和共享缓存。初始归属及声音绑定使用正式宿主命令准备；改归属、生成、重做、停顿、试听、放弃、采用和导出通过桌面界面操作。正文无改写，也无需远程分析服务。

| 操作 | 原生证据 |
| --- | --- |
| 生成与修正 | 首版 5 段，14.80 秒。轨道首段后添加 0.5 秒停顿。通过正文选区将一处台词从小林改归小周，预检显示可沿用 4 段、重做 1 段。 |
| 局部重做 | 仅索引 1 进入合成，音色从 `zf_002` 改为 `zm_009`，该段从 1.95 秒变为 1.82 秒。其余四段确认 WAV 字节与来源相同，独立媒体身份下共享硬链接。重做结果自动成为当前版本，原边界停顿保留为修订 1。 |
| 试听与版本选择 | 新旧试听从同一原文范围起播，真实 WKWebView 媒体时钟推进。修复后，两颗试听键各播放一段并在段末停下。播放中切到历史版本，主播放键明确起播所看版本。旧版停顿仍可查看。 |
| 重录决定 | 同音色重录仅合成指定段。一次选择放弃，当前版本保持。另一次显式采用，当前指针切换，重录段 1.83 秒，PCM 与 1.82 秒的原段不同。选择待采用行只保留一套决定入口。 |
| 重启与导出 | 使用 Cmd+Q 退出并重开，确认进程身份改变。恢复采用的同一重录版本和停顿修订 1。点击导出，使用 macOS 保存对话框写出 15.18 秒、24 kHz、16 位、单声道 PCM WAV。首段边界插入 12,000 帧全零静音，其余 PCM 与采用版本逐采样一致。 |

原生还检查了 1024 CSS 像素宽窗口，待采用操作都可见，页面无横向溢出。实际输出对照样本及截图留在本机忽略目录。播放器成功起播、停止和 PCM 差异有机器证据，主观可辨性仍需人工试听。

前端类型检查、构建、lint、Lingui 严格编译、91 项单测与 17 项相关 Chromium 回归通过。OpenSpec 严格校验 50 项通过。

### 原生发现与修复

- 归属变化时，打开的停顿编辑器将旧版失效当作保存中并拦住「重做」。将只读状态与真正的在途保存分开。无草稿可关闭或继续重做，保留显式放弃未保存草稿的入口。
- 从版本菜单选中待采用版时曾同时呈现两个采用入口。现复用一套比较与决定操作，并给历史整章和时间加可辨识的标签。片段检查器使用「重录此段」区分同输入重录与计划改变后的局部重做。
- 查看历史版时主播放键曾暂停另一版本。现按被查看的版本决定起播目标。新旧试听按同一原文范围比较，单段试听不串播后文。等待决定用状态消息报告，不移动焦点。参照 [Adobe Audition 历史与原音对比](https://helpx.adobe.com/audition/desktop/editing-audio-files/undo-redo-history.html)、[ElevenLabs 段落生成历史](https://elevenlabs.io/docs/help-center/product/studio/studio/what-is-generation-history-in-studio)、[Apple 撤销与重做](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)及 [W3C 状态消息](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)。

## 仍待验收

人工听感、VoiceOver 实读、完整原生中英亮暗矩阵、其他模型和平台（含 Windows 硬链接）。本轮验证了 macOS 单章闭环，未外推到整书或其他模型。
