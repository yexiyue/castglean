# Proposal

## Why

工作台类界面的键盘快捷键已经散装生长为 6 处手写 `window`/`document` keydown 监听（`ui/sidebar.tsx`、`projects/imported-workspace.tsx`、`projects/chapter-splitting-workbench.tsx` ×2、`projects/structure-actions.tsx`、`ai-elements/session-input.tsx`），IME/输入框/repeat 防护各处不一，且 `ui/sidebar.tsx` 内置的 Cmd+B 与 `imported-workspace.tsx` 的面板切换 Cmd+B 在同时挂载时**双触发**——没有冲突检测、没有弹窗作用域，每新增一个快捷键都在积累冲突债。`chapter-production-workspace` 规格已要求"只有当前可见工作台响应快捷键"，但当前没有统一机制承载这条要求。TanStack Hotkeys（React 适配、框架无关内核）以声明式注册 + 作用域栈 + 冲突检测恰好解决这个问题；作为叶子依赖替换成本低，v0/beta 的 API 变动风险可容纳。

## What Changes

- 新增依赖 `@tanstack/react-hotkeys`，建立集中式快捷键声明入口，替代各组件自建监听。
- 迁移现有 6 处全局 keydown 监听到声明式注册，行为保持：Cmd/Ctrl 平台语义、IME 组合期间不触发、聚焦文本框时字母键不误触（原手写防护升级为库内建语义）。
- 解决 Cmd+B 双绑定：同一组合键只允许一个注册项生效，shadcn `Sidebar` 组件自带的内置监听移除或参数化让位（具体归属在 design 定夺）。
- 弹窗与独占交互（如音频轨道拖拽中的 Escape）纳入作用域机制：打开时独占键盘，关闭后恢复父级快捷键。
- 不做（明确出范围）：用户自定义快捷键设置页与速查表（二期）、系统级全局快捷键（Tauri global-shortcut 属另一层）、焦点作用域的就地键盘行为（章节目录行内导航、面板 resize handle、search-input 的 Enter/Escape——这些不是全局快捷键，不迁移）。

## Capabilities

### New Capabilities

- `keyboard-shortcuts`: 应用内键盘快捷键的声明式注册、平台感知（Mod→⌘/Ctrl）、注册期冲突检测、作用域隔离（弹窗独占、仅可见工作台响应）与文本框/IME 智能暂停的统一行为。

### Modified Capabilities

（无。`chapter-production-workspace` 的"仅可见工作台响应快捷键"与 `chapter-splitting-workbench` 的"输入法组合期间不得触发快捷发送"均为既有要求，行为不变，实现由新能力承接。）

## Impact

- 依赖：新增 `@tanstack/react-hotkeys`（v0/beta，注意后续 API 变动需跟版本核验）。
- 受影响代码：`src/components/ui/sidebar.tsx`、`src/components/projects/imported-workspace.tsx`、`src/components/projects/chapter-splitting-workbench.tsx`、`src/components/projects/structure-actions.tsx`、`src/components/projects/chapter-audio-track.tsx`（拖拽 Escape）、`src/components/ai-elements/session-input.tsx`。
- 不影响宿主（src-tauri）与数据格式；不新增交互入口，只更换既有快捷键的承载机制。
- 与进行中的 `redesign-production-experience` 并行不冲突：本 change 只迁移存量行为，不改界面结构与文案。
- 验证：真实窗口中逐项核验迁移后的快捷键触发、弹窗打开时的独占、Cmd+B 冲突消除；现有前端测试（`node --test`）不受影响。
