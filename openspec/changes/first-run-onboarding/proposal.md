# Proposal

## Why

「快速上手」目前是侧栏底部的常驻目的地，但内容是首次使用的三步清单：导入完成后它长期留在导航里，已完成的步骤变成过期勾选，与当前工程无关的说明每次都要被读到。侧栏刚按「只放目的地」收敛过一次，说明书混在目的地里与该决定冲突；而首次引导本身是一次性体验，用常驻页面承载是形态错误。

正确的拆法是：首次引导只在第一次出现，用真实动作把用户带到「看到章节列表」这一步，之后保持安静；主流程说明移到设置里，随时可复看，不再占用导航。

## What Changes

- 删除常驻「快速上手」页面：`/start` 路由、`StartGuide` 组件与侧栏入口一并移除，不保留兼容跳转。
- 新增桌面端一次性首启引导层：本地没有任何工程时于工程首页呈现，只把用户带到「看到章节列表」；可随时跳过，跳过即静默（由宿主持久化），此后不再自动出现。
- 引导层由真实状态驱动：无工程指向新建工程；只有未完成导入的草案时指向继续导入；出现章节即判定引导完成并写入完成状态。不依赖前端本地存储判定首次使用。
- 设置新增「使用指南」分区：常驻可复看的主流程步骤与入口（新建工程、模型中心、音色中心、存储位置），承接原快速上手页的说明内容。
- 浏览器预览不弹引导层：`BrowserPreviewGuide` 保持能力边界说明，移除指向快速上手的链接。

## Capabilities

### New Capabilities

- `first-run-onboarding`：桌面首次使用的引导层、跳过语义与常驻使用指南入口。

### Modified Capabilities

- `desktop-workflow-layout`：侧栏只列目的地，不承载一次性引导与说明书入口；「上手」界面改称使用指南。

## Impact

- 宿主：`src-tauri/src/app_state.rs`（新增应用级状态模块，持久化引导完成标记）、`src-tauri/src/lib.rs`（命令与状态注册）、生成的 `src/lib/bindings.ts`。
- 前端：`src/components/onboarding/first-run-guide.tsx`（新增引导层）、`src/routes/index.tsx`（首页接入）、`src/components/settings/guide-settings.tsx` 与 `settings-panel.tsx`（使用指南分区）、`src/components/library-sidebar.tsx`、`src/components/browser-preview-guide.tsx`；删除 `src/routes/start.tsx` 与 `src/components/onboarding/start-guide.tsx`。
- 文案与测试：Lingui 提取与英中翻译、`e2e/workspace/navigation-links.spec.mjs`、`e2e/settings/settings-guide.spec.mjs`、`e2e/workspace/desktop-polish.spec.mjs`、`tests/helpers/desktop-fixture.tsx`（合成 IPC）、新增引导状态判定的单元测试。
- 不影响工程数据格式、章节制作与导出链路；引导只覆盖「导入到章节列表」这一段，模型准备与声音绑定仍由模型中心、音色中心和工程内空态承担。
