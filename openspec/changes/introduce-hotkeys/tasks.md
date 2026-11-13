# Tasks

## 1. 依赖与常量基建

- [x] 1.1 安装 `@tanstack/react-hotkeys`（最新版），根组件挂 `HotkeysProvider` 默认作用域，新建 `src/lib/hotkeys.ts` 集中导出类型化键位常量；验证 `pnpm build` 与 `biome lint` 通过，应用启动且无任何行为变化（此阶段不迁移任何监听）。

## 2. 试点迁移与语义定夺

- [x] 2.1 试点迁移 `session-input.tsx` 的 Cmd+Enter 快捷发送到 `useHotkey` + 常量；真实窗口验证：发送正常、焦点在输入框时无修饰键快捷键不误触、**输入法组合期间 Cmd+Enter 不触发**；据此落地 design D6 决策——库默认满足则删除 isComposing 手写守卫，不满足则保留，并把结论回写 design.md。
- [x] 2.2 核验已装版本是否内建注册冲突检测（devtools / manager 形式）；验证方式：在 dev 模式故意注册重复键位观察行为，结论（内建或走 D5 兜底）回写 design.md D5。

## 3. 批量迁移存量监听

- [x] 3.1 迁移 `imported-workspace.tsx` 的 Cmd+B / Cmd+Alt+B 面板切换；真实窗口验证目录与检查器各切换一次、行为与迁移前一致（repeat/输入框内不触发语义保持）。
- [x] 3.2 删除 `ui/sidebar.tsx` 内置 Cmd+B 监听；真实窗口验证 Cmd+B 只触发目录面板切换（侧栏不再联动，双触发消除），Cmd+Alt+B 不受影响。
- [x] 3.3 迁移 `chapter-splitting-workbench.tsx` 的两处快捷键；真实窗口验证原有键位与触发表现不变，文本框聚焦时原有防护语义不降级。
- [x] 3.4 迁移 `structure-actions.tsx` 的 Cmd/Ctrl 快捷键；真实窗口验证原行为不变。
- [x] 3.5 全库扫描确认无残留手写 window/document keydown（允许保留：焦点作用域的元素级 onKeyDown、以及尚未迁移的拖拽 Escape）；验证 `rg -n "addEventListener\(\"keydown\"" src/` 输出仅含允许项。

## 4. 独占作用域

- [x] 4.1 音频拖拽 Escape 纳入独占作用域（拖拽激活时挂载 exclusive 子树，内含 `Escape → 取消`），删除 `chapter-audio-track.tsx` 局部监听；真实窗口验证：拖拽中 Escape 取消且不提交、拖拽期间 Cmd+B 不触发、结束后快捷键恢复；若 v0 条件挂载行为不稳，按 design D3 回退保留局部监听并回写 design.md（拖拽期间全局停用仍须满足）。
- [x] 4.2 为共享弹窗基元接入 exclusive 作用域；真实窗口验证：任一代表性弹窗打开时 Cmd+B 不触发背后面板切换、弹窗自身 Escape/关闭键生效、关闭后快捷键恢复。

## 5. 集成验收与同步

- [ ] 5.1 真实窗口全量验收：逐项核对迁移后全部键位（Cmd+B、Cmd+Alt+B、Cmd+Enter、Escape、分章工作台与结构操作键位）、IME 组合、弹窗与拖拽作用域、dev 模式（StrictMode）无双触发；与迁移前行为对照无回归后视为通过。
- [x] 5.2 同步文档：README 路线图状态、知识库（v0 库的实际行为偏差若有，记入 lessons 并更新索引）；验证相关文档与实现一致。

验收证据与未完成边界见 [validation.md](validation.md)。5.1 尚缺系统中文输入法物理按键与分章工作台独立页面矩阵，未以合成事件替代勾选。
