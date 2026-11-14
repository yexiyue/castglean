# Design

## Context

（动机见 proposal.md — Why。）设计依据的现状事实：

- `project-workspace.tsx` 同时渲染 `SidebarProvider`（vendored `ui/sidebar.tsx` 自带 Cmd+B 监听，无 IME/输入框防护）与 `ImportedWorkspace`（Cmd+B 切目录、Cmd+Alt+B 切检查器，防护齐全）——双触发是结构性共存，不是假设。
- 其余散装监听：`chapter-splitting-workbench.tsx` ×2、`structure-actions.tsx`、`ai-elements/session-input.tsx`（Cmd+Enter + 手写 isComposing 守卫）、`chapter-audio-track.tsx`（拖拽期间局部 Escape）。
- 就地键盘行为（章节目录行内 onKeyDown、面板 resize handle、search-input）是焦点作用域行为，不迁移。
- 迁移前没有快捷键自动化测试；本次增加原生 WebView 真实组件回归，系统输入法物理按键验收单列。

## Goals / Non-Goals

Goals:

- 全局快捷键统一经 `@tanstack/react-hotkeys` 声明注册，删除全部手写 window/document keydown 监听。
- 键位常量单一来源，处理器留在所属组件。
- 独占作用域覆盖弹窗与音频拖拽。
- 用户可见行为不变：键位、IME 语义、平台语义均保持现状。

Non-Goals:

- 用户自定义快捷键与速查表 UI（二期；本期常量模块为其预留）。
- Tauri 系统级全局快捷键。
- 焦点作用域就地键盘行为的迁移或改造。
- 自研运行时冲突扫描。

## Decisions

### D1 依赖与集成形态
新增 `@tanstack/react-hotkeys`（v0/beta；按仓库最新版策略取最新，不因 beta 手动锁死，升级时按任务清单逐项核验）。根组件挂 `HotkeysProvider` 作为默认作用域，各视图内用 `useHotkey`/`useHotkeys` 就近注册。Provider 非必需但统一挂载，为 scope 与后续 devtools 留口。
替代方案：继续手写监听——现状已证伪（冲突已发生）；自研 scope 管理——重复造轮且无类型安全键位。

### D2 Cmd+B 归属：目录/检查器保留键位，侧栏内置监听直接移除
`ui/sidebar.tsx` 是我们拥有的 vendored 组件，按房规不为旧机制保留兼容层，直接删除其内置 Cmd+B 监听（不留参数化开关）。`ImportedWorkspace` 的 Cmd+B / Cmd+Alt+B 语义不变——阅读/制作视图中目录与检查器是高频操作，且 Cmd+B 的编辑器肌肉记忆（主面板切换）与目录面板吻合。侧栏切换不设全局键，靠 UI 入口发现。
替代方案（侧栏保留 Cmd+B、目录改键）被否：改变既有键位、引入学习成本，且侧栏切换是低频导航。

### D3 作用域布局
- 根 Provider：全局默认作用域；视图级注册（面板切换等）随视图挂载/卸载，天然承接 `chapter-production-workspace` 既有要求"只有当前可见工作台响应快捷键"（该 spec 不改）。
- 弹窗：`ui/dialog.tsx` 的 `Dialog` 包装层镜像开合状态（受控取 `open` prop，非受控跟随 `onOpenChange`），打开期间在 Root 旁挂载**空**的 `HotkeysProvider scope={useId()} exclusive`（Fragment 兄弟，不包裹任何内容——独占是 manager 全局状态，与树位置无关；scope 用 `useId` 保证层叠弹窗不重名）。keepMounted 弹窗因镜像状态而非挂载判断，关闭后正确恢复外部快捷键。
- 音频拖拽：拖拽激活时条件挂载 `HotkeysProvider scope="audio-drag" exclusive` 子树，内含唯一注册 `Escape → 取消`（模块私有 `DragCancelHotkey` 宿主组件），替代原局部监听；拖拽结束卸载并恢复。
- 弹窗独占落地后，`splitting.jumpToChapter` 回调里的 `querySelector('[role="dialog"]')` 兜底已删除（全库扫描确认所有弹窗均出自共享 `Dialog` 基元，无旁路 `role="dialog"` 生产者）。

### D4 键位常量与处理器分离
`src/lib/hotkeys.ts` 集中导出类型化键位常量（`HotkeyChord` 字符串），组件内就近绑定处理器。不建"单文件快捷键表 + 命令总线"——那会把行为扯离所属组件，等二期用户自定义时再引入。`useFormatForDisplay()` 留给二期速查表，本期不接。
实施修正（0.23.1/0.27.1）：常量模块直接采用库官方的 `defineAppHotkeys` 声明式清单（含 id、默认键位、可选 meta/scope），配合 `declare module` Register 类型增强——比裸字符串常量多出速查表/自定义/冲突分类的官方承载，符合"官方 API 优先"。meta 本期不设（不引入用户可见文案，i18n 免疫）。

### D5 冲突治理：内建存在，但浏览器 dev 下注册期警告无效（已核验源码与 dev 产物）
`hotkey-manager.js` 在每次注册时查找冲突注册并按 `conflictBehavior` 处理：默认 `"warn"`、可选 `"error"`（无条件抛错）/`"replace"`（顶掉旧注册）；另有声明级 `AppHotkeysStore.findConflicts` 与运行期 `findHotkeyConflicts` 查询 API。
**局限（v0 踩坑）**：`"warn"` 分支被 `typeof process !== "undefined"` 前置守卫——浏览器运行时没有 `process` 全局（Vite 只静态替换 `process.env.NODE_ENV`，不替换 `typeof process`），故 WebView dev 下该 console.warn **实际不触发**，警告只对 Node/SSR 环境有效。`"error"` 虽不依赖 `process` 但无条件抛错，生产环境真实冲突会变崩溃，不作默认。
治理路径修正为：D4 声明清单单一来源（新增键位走 code review）+ 5.1 验收清单含同键位双组件场景 + 二期可选用 `useHotkeyRegistrations` 做开发期可视化。不自研运行时扫描。

### D6 输入焦点、IME 与按键复位（2026-11-13 复验修正）

库将 `event.isComposing || keyCode === 229 || key === "Process"` 归一化，组合期不匹配快捷键。但它不跟踪整个 DOM composition 生命周期；`SessionInput` 保留 `onCompositionStart/End` 与 ref，防止 composition 尚未结束但某次 keydown 不带组合标志时发送。

快捷发送使用 `target: textarea`（传 ref，不传首帧为 null 的 `.current`），保持只在所属输入框聚焦时触发；多个挂载输入框互不发送，页面其他位置的 Mod+Enter 不发送残留草稿。面板键继续按规格采用 `ignoreInputs: 'auto'`，无系统修饰键的字母在输入区域暂停。

**替代此前的源码核验结论**：`hotkey-manager.js` 中忽略 repeat 的分支属于 sequence 路径；chord 默认 `requireReset: false`，会长按重复触发。清单中所有 chord 显式设 `requireReset: true`，一次按下至松开只触发一次，按键松开后下一次正常触发。

验证入口为 `tests/native/hotkeys-desktop.mjs` 与真实组件夹具 `tests/helpers/hotkeys-fixture.tsx`。夹具在原生 WebView 中挂载独立 StrictMode root、临时独占作用域与合成数据，不调用真实工程或模型；键盘/composition/pointer 是桥接合成事件，不能当作 macOS 系统输入法的物理按键验收。

## Risks / Trade-offs

- [v0 API 变动、文档与实现漂移] → 绑定点集中在 6 处组件 + 1 常量模块，升级影响面可枚举；任务安排先单组件试点冒烟，再批量迁移。
- [冲突检测未内建] → D5 兜底路径明确，验收清单含同键位双组件场景。
- [拖拽独占作用域条件挂载不稳] → D3 回退路径明确；拖拽期间全局快捷键停用不因回退豁免。
- [库对个别组合或焦点边缘行为与手写不一致] → 桌面 WebView 无浏览器保留键竞争；迁移后逐键位人工核对（Cmd+B、Cmd+Alt+B、Cmd+Enter、Escape、分章工作台键位）。
- [React StrictMode 双挂载导致重复注册] → 库按挂载/卸载自管理；dev 模式验收含无双触发检查。

## Migration Plan

1. 引入依赖 + 根 Provider + `src/lib/hotkeys.ts` 常量模块（无行为变化，独立提交点）。
2. 单组件试点：`session-input.tsx` Cmd+Enter（含 IME 组合验证），确定库默认语义（D6 决策落地）。
3. 批量迁移其余监听：`imported-workspace.tsx`、`chapter-splitting-workbench.tsx` ×2、`structure-actions.tsx`；同批删除 `ui/sidebar.tsx` 内置监听（消除双触发）。
4. 拖拽 Escape 纳入独占作用域（或按 D3 回退），弹窗接入 exclusive 作用域。
5. 真实窗口验收清单全过后提交；回滚为 revert 该 commit，监听删除与迁移原子完成，revert 即回到现状。

## Open Questions

（无——键位归属、作用域形态、常量位置均已定；v0 API 细节差异由任务内试点冒烟吸收，不改变设计与任务结构。）
