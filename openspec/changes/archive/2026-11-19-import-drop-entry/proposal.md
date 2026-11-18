# Proposal

## Why

新建工程页（`/new`）初始态是全应用最关键的首次动作入口，但目前只有一个「选择 TXT 文件」按钮与模式下拉漂浮在大片空白里：模式下拉只有 aria-label 没有可见标签，两种导入方式（整本自动分章 / 每文件一章）的语义差异无从解释；导入类工具的类别惯例——拖放文件——完全缺失；非 TXT 文件失败时落到笼统的「操作未完成」默认错误，用户不知道原因。Tauri 2 原生支持文件拖放（`getCurrentWebview().onDragDropEvent()` 提供 enter/over/drop/leave 事件与绝对路径，`dragDropEnabled` 默认开启），宿主 `Selections::select` 已含全套校验，接一条 `local_source_accept` 命令即可复用，拖放可以是真功能而非摆设。用户确认采用全窗口接收（拖入窗口任意位置即全屏高亮，松开即导入）。

## What Changes

- 宿主新增命令 `local_source_accept(paths)`：路径列表走与文件对话框完全相同的校验（.txt 扩展名、单文件 32MB、≤128 个、总量上限、文件名合法性、编码探测），任一失败整批回滚；对话框命令的内联循环与它收敛到同一个 `select_many`。
- 前端 `/new`：初始态重设计为虚线导入卡（拖放说明 + 选择按钮）+ 带可见标签的「TXT 导入方式」字段与按模式显示的帮助文案；拖放 overlay（全窗口高亮「松开以导入 TXT」，pointer-events 不拦截）；未完成草案列表样式对齐应用列表习惯；`invalid_format` 补专属错误文案。
- 拖放事件监听仅在本页挂载期间存在（组件卸载 unlisten），注册失败静默降级为仅按钮导入；busy / 草案加载中不接收拖放。
- 不做（明确出范围）：Windows/Linux 平台实测（先落机制，平台验收另行记录）；拖放追加到已有 pending 的多文件边界以外的新 UI（沿用现有追加按钮行）；全应用任意页面接收拖放。

## Capabilities

### Modified Capabilities

- `novel-chapter-import`: 新增「拖放导入入口」要求（全窗口接收、同套校验与整批回滚、非 TXT 明确报错、监听仅本页挂载）。

## Impact

- 受影响代码：`src-tauri/src/novel_import/selection.rs`（select_many + 单测）、`novel_import/selection/commands.rs`（新命令 + 对话框命令复用）、`src-tauri/src/lib.rs`（命令注册）、`src/lib/bindings.ts`（重新生成）、`src/hooks/use-drag-import.ts`（新增）、`src/routes/new.tsx`（初始态与 overlay）。
- 测试：selection 单测；fixture 启用 `mockIPC` 事件模拟并暴露 `fireDragEvent`；新增 `e2e/workspace/import-drop.spec.mjs`。
- 不改变数据格式与既有对话框导入行为；浏览器模式不受影响（拖放仅桌面端挂载）。
- 验证：cargo test/clippy、pnpm build/test、新 e2e、真实窗口用 ipc-emit-event 注入拖放事件核对 overlay、成功导入与错误提示。
