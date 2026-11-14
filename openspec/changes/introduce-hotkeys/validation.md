# 快捷键迁移验收

日期：2026-11-13。环境：macOS arm64，真实 CastGlean debug 窗口（标识 `com.yexiyue.castglean`），React StrictMode，TanStack React Hotkeys 0.23.1 / core 0.27.1。

## 本次修复

- 快捷发送绑定 textarea ref，只在所属输入框聚焦时生效；防止页面其他位置发送残留草稿、多个输入框串发。
- 保留 composition start/end ref，补足库的单事件 IME 标志过滤。
- 所有 chord 的声明使用 `options: { requireReset: true }`，长按不重复触发。此前文档把 sequence 的 repeat 过滤误认为 chord 默认行为，本次已修正。
- 保留原有分章 Control+G 与结构页 Mod+G；面板键按规格使用平台 Mod，输入区域内仍可使用系统修饰组合。

## 已验证

1. 在真实工程页面通过 tauri-mcp 操作 Cmd+B：目录从展开变为收起且只变化一次；Cmd+Alt+B 单独切换助手。Cmd+G 打开转到行弹窗；弹窗打开期间 Cmd+B 不切目录，Escape 关闭后 Cmd+B 恢复。只操作面板与弹窗，未提交正文、结构或 AI 请求。
2. `node tests/native/hotkeys-desktop.mjs`：17 项真实组件回归通过。独立 StrictMode root 在原生 WebView 挂载实际 `SessionInput`、共享 `Dialog` 和 `ChapterAudioTrack`，使用隔离数据、临时独占作用域与临时 command stub，不访问真实工程或模型。覆盖焦点内外、双输入框、isComposing/229/Process、composition 生命周期、长按防重、macOS Control 不匹配 Mod、隐藏视图停用、弹窗独占/关闭恢复，以及实际音频拖拽 Escape 取消且 pointerup 不提交、取消后恢复快捷键。事件由 DOM 合成，不能等同于系统输入法物理操作。
3. `pnpm build`、`pnpm lint` 通过；lint 仅报告 target 历史目录的既有损坏符号链接警告。`node --test tests/*.test.mjs`：56 项通过。
4. `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`、`cargo doc --no-deps` 通过：库 400 项、集成 2 项通过，10 项外部条件测试保持忽略。桌面启动成功；链接器的大型 `__eh_frame` 警告不代表构建失败。
5. `openspec validate introduce-hotkeys --strict` 通过；`src/` 无手写全局 keydown 监听残留。

复验方式：先启动 `pnpm desktop:dev`，确认 `tauri-mcp driver-session start --port 9223`、status 的应用标识与 connected 状态，再运行桌面测试脚本。不要与使用默认 Vite 缓存的另一测试服务器同时运行；测试完恢复原页面。

## 待完成边界

- 5.1 保持未勾选：尚未用系统中文输入法实际选词，在组合未提交时物理按 Cmd+Enter；分章工作台 Control+G 的独立原生页面全量矩阵也未完成。已有合成事件回归不能替代这两项。
- Windows/Linux、非拉丁键盘布局未验。本变更不新增用户自定义键位、速查表或系统全局快捷键。
- `redesign-production-experience` 不在本次实施范围，保持既有草案与 0/16 任务状态。
