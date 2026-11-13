# TanStack Hotkeys v0 集成踩坑与核验结论

- 日期：2026-11-13
- 版本：`@tanstack/react-hotkeys` 0.23.1 / `@tanstack/hotkeys` 0.27.1（React 19.3、Vite 8 浏览器侧）
- 适用范围：CastGlean 全局快捷键体系（[introduce-hotkeys 变更](../../../openspec/changes/introduce-hotkeys/)，规格 `keyboard-shortcuts`）
- 验证方式：源码与 dev 产物核验、构建/回归、macOS 原生页面面板/弹窗操作，以及原生 WebView 真实组件的合成事件回归；系统中文输入法物理按键另验

## 结论速查

1. **注册冲突的 dev 警告在浏览器不触发**。`handleConflict` 的 `"warn"` 分支有 `typeof process !== "undefined"` 前置守卫；Vite 只静态替换 `process.env.NODE_ENV` 字面量，不注入 `process` 全局，WebView 运行时守卫恒假。该警告只对 Node/SSR 有效。`"error"` 策略不依赖 `process` 但无条件抛错，生产风险不可接受。
   → 治理靠声明清单单一来源（`src/lib/hotkeys.ts`）+ code review + 验收清单，不自研运行时扫描。
2. **同 scope 同键位的多个活注册会都触发**。dispatch 按"最佳匹配分 + 最佳 scope 层级"循环 fire，`"warn"` 冲突处理不会去重。互斥视图必须用 `enabled: visible`（disabled 注册不参与 dispatch，与旧代码 `if (!visible) return` 等价）。
3. **事件级 IME 防护不能替代 composition 生命周期，chord 默认也不防 repeat**。库覆盖 `isComposing`、`keyCode === 229` 和 `key === "Process"`；但 `SessionInput` 仍需保留 composition start/end ref。2026-11-13 回归推翻了此前“可放心删守卫、库自动忽略重复”的结论：忽略 repeat 的代码属于 sequence 路径，chord 默认 `requireReset: false`。现集中声明全部设 `requireReset: true`，长按不重复，松开后恢复。

4. **输入框语义默认即智能**：`ignoreInputs: 'auto'`——单键/Shift/Alt 组合在输入控件内忽略，Ctrl/Meta 组合与 Escape 照常。旧行为里手写的 `closest("input,textarea,...")` 排除对修饰键组合是过度防护，迁移时按规格有意升级。
5. **弹窗独占用"空 provider 兄弟节点"最稳**：独占是 manager 全局状态，与树位置无关。在共享 `Dialog` 包装层镜像开合状态（受控取 `open` prop，非受控跟随 `onOpenChange`），打开时挂 `HotkeysProvider scope={useId()} exclusive`（空 children）。`useId` 避免层叠弹窗同名 scope 双激活；`keepMounted` 弹窗靠镜像状态而非挂载判断，关闭后外部快捷键正确恢复。
6. **chord 词表是 `Mod/Meta/Control/Alt/Shift`**：`Ctrl` 不是合法词（类型错误），平台无关声明用 `Mod`；严格 Ctrl（排除 Cmd）的历史键位写 `Control+G`。

7. **快捷发送必须绑定输入框 target ref**。迁移前是 textarea 的 `onKeyDown`，改为无 target 的 `useHotkey` 会升级为全局监听，其他区域可能发送残留草稿，多个挂载输入框还会串发。使用 `target: textarea` 保留焦点边界；不要传首帧为 null 的 `.current`。

## 关键链接

- 可复验入口：`node tests/hotkeys-desktop.mjs`（先启动 `pnpm desktop:dev` 并连接 tauri-mcp）；夹具不写真实工程
- 声明清单与类型注册：`src/lib/hotkeys.ts`
- 弹窗独占：`src/components/ui/dialog.tsx`（`Dialog` 包装层）
- 拖拽独占：`src/components/projects/chapter-audio-track.tsx`（`DragCancelHotkey`）
- 决策与备选：[变更 design.md](../../../openspec/changes/introduce-hotkeys/design.md)（D1–D6）

## 未验证边界

- 真实窗口的 IME 组合输入（中文输入法）终验；非拉丁键盘布局（俄语/AZERTY）未测。
- `useFormatForDisplay`/用户自定义/速查表为二期，本期未接。
