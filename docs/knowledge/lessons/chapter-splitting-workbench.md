# 分章工作台的界面边界与验证

日期：2026-11-07。状态：前端已实现；Edge 156 浏览器隔离 IPC 回归通过，macOS Tauri 开发构建与启动通过，真实桌面交互及真实模型建议质量未验证。

## 决策与约束

- [工作台](../../../src/components/projects/chapter-splitting-workbench.tsx)采用目录、正文/方案和右侧助手。已有来源的 `/new?draft=…` 直接进入工作台，追加文件显式返回导入界面；来源正文始终只读，人工修章、分卷、规则和撤销由原有宿主命令提交。
- [结构对照](../../../src/lib/projects/split-review.ts)不能按章节 id 判断新增：候选会重新产生 id。按来源、起点与 heading 匹配，并比较标题、结束位置及卷的来源/位置/标题；按映射和集合处理一万章，避免逐章重新扫描来源或卷。界面整套采用，逐条查看不等于逐条提交。
- [方案](../../../src/components/projects/split-proposal.tsx)在 revision 改变时重新读取，过期禁用采用。提交后读取新工程再刷新，不做乐观成功；同一视图中的失败重试保留 command id。若提交成功但工程回读失败，界面仍报未确认，允许重新读取状态。
- [输入引用](../../../src/lib/projects/source-context.ts)有 UTF-8 字节限额。不能仅用 JavaScript `slice` 限制中文/emoji：宿主消息上限为 8192 字节。引用按 Unicode 码点截取，预留用户正文与来源说明的字节；逆向选区使用 Range 的起点，而非用户开始拖选的 anchor。
- [助手](../../../src/components/projects/chapter-diagnostics.tsx)保留现有 transport。草稿按会话隔离，发送完成前不清空，失败保留；发送期间的新草稿不被旧响应清掉。切换会话、收起助手和解除订阅均不取消任务；只有显式停止才取消。草稿是临时 UI 状态，不承诺跨路由卸载/重启恢复。
- [共享消息](../../../src/components/ai-elements/session-messages.tsx)展示已知工具的本地化动作及结果引用，未知结果仅展示转义摘要；不展示原始工具 JSON/提供商失败正文。中断回复明确标为不完整，长历史加载保留位置，用户离开底部后不抢回滚动。

## 可复现验证

自动检查：`pnpm build`、`pnpm lint`、`pnpm test:ai`（17 项）、`pnpm test:playback`（9 项）、`pnpm i18n:extract`（英文缺失 0）、`openspec validate redesign-chapter-splitting-workbench --strict` 与 `git diff --check`。

浏览器验收使用 [独立入口](../../../tests/helpers/serve-workbench.mjs)、[公开合成数据与 IPC](../../../tests/helpers/workbench-fixture.tsx)和[浏览器流程](../../../tests/workbench-browser.mjs)。先运行 `node tests/helpers/serve-workbench.mjs`，再执行 `node tests/workbench-browser.mjs`；需可用 Playwright 与 Chromium，亦可通过 `PLAYWRIGHT_MODULE`（ESM 绝对路径）及 `BROWSER_EXECUTABLE` 指向外部安装。夹具只有显式测试服务器才提供 `/__workbench`，不加入产品路由、不连接模型、不读写真实工程；夹具并非宿主正确性的证据。

已观察：

- 当前目录/候选/原文定位联动；人工标题保存后方案过期且不可采用；采用失败保持原目录，成功重试使用同一 command id；已采用状态禁用重复采用。
- 会话切换不启动/取消执行，草稿隔离；发送失败保留输入；发送期间编辑的新草稿保留；行引用和逆向跨行选区携带正确的来源与起点。
- Ctrl+Enter 发送，输入法组合不发送；中断回复标记及明确重试；活动助手收起不取消，显式停止只发送一次取消。
- 原文读取失败不保留旧正文，重新读取可恢复；加载更早历史；一万章目录只渲染一页，可翻页；面板可用键盘调整。
- 1440×900 与 1024×680（包含 44px 应用栏占位），中英文和亮暗主题，页面无横向溢出，输入框与方案操作可达。截图在 ignored `src-tauri/target/workbench-acceptance/`，可重跑生成。

## 集成检查发现的既有问题

main 的全量 lint 原有 5 处错误：侧栏与音色列表在函数内定义组件、设计引擎详情间接条件调用 `useLingui`、两个卡片集合在普通 div 使用 `aria-label`。本轮将导航组件移到模块、选择框改普通渲染函数、详情翻译 Hook 移到组件顶层，并使用命名 section；不改模型或音色业务。

仍有既有 sidebar cookie 和 app-state Tailwind 排序警告；构建保留既有中文 catalog 静态/动态导入与工具链提示，不作为功能错误。

## 实机边界

使用独立 identifier `com.yexiyue.castglean.workbench-acceptance`，构建和启动真实 macOS Tauri 开发应用成功（3m28s），未复用正式工程数据。桌面控制工具连接超时，未完成原生文件选择器、真实宿主采用或系统 WebView 的交互验收；不能用浏览器 IPC 夹具替代这些结论。本轮无 Rust 行为修改，没有重新执行全套宿主测试，也未发布应用。

规格与实现任务见 [redesign-chapter-splitting-workbench](../../../openspec/specs/chapter-splitting-workbench/spec.md)。后端事务与运行时的既有验证仍见 [本地存储验证](local-storage-windows-validation.md)。


## 同日追加：Tiptap 与 AI Elements

按用户要求，输入换用 Tiptap 3.33.0（React/PM、基础段落文本、换行、UndoRedo/Placeholder），消息接入官方 AI Elements registry 的 Message/MessageContent/MessageResponse 源码，并使用 Streamdown 2.7.1、CJK 1.0.4 与 code 2.0.0。来源与改动说明在 [message.tsx](../../../src/components/ai-elements/message.tsx)；未覆盖已有 Base UI 组件，也未引入数学/图表等未使用的插件。

输入仍按纯文本发送；旧 `promptDocument`（已移除，当前输入见 [SessionInput](../../../src/components/ai-elements/session-input.tsx)）将外部草稿转换为 JSON 文本节点，不能直接把字符串传给 setContent（会解释为 HTML）。编辑器事务按导出的文本计算 2000 UTF-16 单元限额，含段落与硬换行；引用的宿主 UTF-8 限额仍由 source-context 负责。组合输入不快捷发送，发送失败不清空，切换会话不丢草稿。用户消息保留字面内容；助手由 Streamdown 渲染 Markdown 并跳过原始 HTML，工具摘要与候选引用继续由业务组件展示。

验证：原 17 项 AI/分章测试增加 Markdown/代码/表格及不安全 HTML/URL 断言，全部通过；当时的编辑器浏览器流程验证真实 contenteditable、多行/空行/硬换行、粘贴、undo/redo、字数限制、字面标签和 emoji、切换会话后恢复以及提交纯文本。另验证活动消息从未闭合代码块更新为代码与表格，1024×680 无横向溢出、停止可用，浏览器无错误；既有 workbench-browser 回归再次通过。构建、TypeScript、lint（2 项既有警告）、Lingui（英文缺失 0）和严格规格校验通过。图片可重跑生成：`ai-sidebar-tiptap.png`、`ai-sidebar-streamdown-dark.png`，位于 ignored 验收目录。

非直观约束：SSR 组件测试与浏览器 Vite 服务器不得共用优化缓存。首次同时运行时，组件测试的无配置服务器替换了预构建缓存，浏览器稍后加载 Streamdown 的 highlighted-body chunk 返回 504，整个夹具退到路由错误页。现将 SSR 测试和浏览器夹具的 cacheDir 分别设为 `src-tauri/target/vite-ai-components` 与 `src-tauri/target/vite-workbench-fixture`；同时运行测试再验证代码块/历史恢复通过。不是通过禁用高亮或忽略浏览器错误规避。

Streamdown 代码高亮会增加构建体积并生成按语言加载的 Shiki chunks，当前构建有大 chunk 提示；尚未据此声称发行包性能通过。本次组件增量未重新做真实桌面交互验收。


## 同日追加：交互减负

按[交互决策](../decisions/chapter-workbench-interaction.md)完成默认检查的一键触发、输入/模型工具栏整合、按需说明、工程菜单、目录编辑展开、有效选区询问、明确行号提交与历史阅读跟随。新增 UX 浏览器流程通过；既有工作台和编辑器流程更新后通过，包含小窗口中英亮暗主题。本轮没有新增产品依赖，也没有变更宿主保存、采用或恢复协议；真实桌面交互未重新验收。

> 2026-11-14：上述旧助手输入夹具已由实际路由的 `tests/session-input-route-browser.mjs` 和共享排版的 `tests/typeset-browser.mjs` 接替；历史 Tiptap 描述仅反映当时实现。
