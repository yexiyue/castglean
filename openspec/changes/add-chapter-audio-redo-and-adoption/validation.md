# 验证记录

日期：2026-11-23 至 2026-11-24。环境：macOS（Apple Silicon），Rust 宿主测试与 Chromium 浏览器夹具。本记录只包含自动化证据；真实桌面窗口、实际模型输出与人工听感未执行（见文末）。

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

## 未执行

- 任务 4.3：真实 macOS 窗口下「生成 → 修正一处归属 → 重做 → 播放 → 重录一段 → 采用或放弃 → 重启 → 导出」的闭环、无关单元未重复合成的实机确认与人工听感。留待统一原生窗口验收。
- 重录结果与原音频是否可辨、Windows 上硬链接的实际行为（失败时回退为复制）。
- 新增入口在屏幕阅读器下的名称与顺序。
