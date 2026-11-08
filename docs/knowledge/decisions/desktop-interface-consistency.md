# 全应用控件与交互一致性

日期：2026-11-07。状态：已实现并经浏览器验证。适用：React 19、Tailwind 4、Base UI 的桌面界面；验证运行于 macOS Edge 的浏览器预览和合成 IPC，不代表原生 WebView、系统文件选择器或真实模型验收。

后续布局更新：标题＋说明式页头已由[桌面上下文栏与任务流程减负](desktop-workflow-layout.md)替代；本文的圆角、搜索、数据边界和既有验证仍有效。

## 选择与边界

用户要求其他页面同步优化，并明确提出边框与输入框不能过硬、圆角需要统一。沿用已有主题与组件，不另建视觉外壳。规范在[品牌文档](../../brand.md#桌面界面的圆角与间距)，需求在 [OpenSpec](../../../openspec/changes/archive/2026-11-08-polish-desktop-interactions/specs/desktop-interface-consistency/spec.md)。

- 控件 10px、列表项 8px、独立表面/菜单 12px、弹窗 16px，以 `control/item/surface/overlay` 集中定义。小按钮不再自行 clamp 圆角，弹窗页脚与外框一致。贴边面板仍使用直边；图标、徽章、轨道等按用途保留例外，不强制把所有元素变成同一形状。
- [SearchInput](../../../src/components/ui/search-input.tsx) 统一工程、模型、预置/自有音色和设置分类的搜索。清除按钮与非空 Escape 均保持输入焦点；空搜索框的 Escape 才交还弹窗。搜索结果为空与真实资产为空分别展示。
- [NativeSelect](../../../src/components/ui/native-select.tsx) 保留原生键盘语义，仅统一控件外观和焦点；移除页面重复样式，避免固定高度叠加过大垂直 padding。Biome 将该透传组件视为表单控件，保留标签检查，浏览器验证实际可访问名称。
- 首页已有工程时可直接导入，空态仍保留单一主行动；修正旧工程格式文案。音色库增加预置搜索，有资产才出现批量操作，实际选择后再显示数量与取消全选。
- 音色制作方式直接以两个页签呈现，已有草稿保留；设备与随机种子放到“高级选项”，错误可见且阻止无效生成。设置去掉未接入的偏好开关和远程语音表单，保留简短状态说明及真实主题、语言、LLM、存储入口。

调研原则延续[分章交互减负](chapter-workbench-interaction.md)中记录的 NN/g 渐进披露、GOV.UK 单一主行动/保留输入与 Vercel 键盘/焦点指南。本次四档圆角是本项目的设计决定，并非声称外部指南规定了这些像素值。

## 验证与复现

启动 `node tests/helpers/serve-workbench.mjs`，设置 `PLAYWRIGHT_MODULE`（Playwright 模块位置）及可选 `BROWSER_EXECUTABLE`，运行 `node tests/desktop-polish-browser.mjs`。

- 真实共享组件在亮暗主题检查 Input、Textarea、所有被测按钮尺寸、Base UI/原生 Select 的计算圆角；面板、Popover、选项、Dialog 及其页脚分别断言 12/8/16px。
- 工程、模型、预置/自有音色搜索的清除与焦点；模型/音色详情与导入弹层；音色批量选择/取消与空库；创建方式切换及跨路由草稿、随机种子错误；设置非空 Escape 清除、再次 Escape 关闭。
- 16 个页面/设置分区 × 浏览器预览/合成桌面 × 中文/英文 × 亮/暗，共 128 组 1024×680 检查，无窗口横向溢出、页面异常或未声明 IPC。截图人工检查了创建、设置、模型、音色和工程角色布局；产物位于 ignored `src-tauri/target/workbench-acceptance/`。
- 17 项 AI/分章测试、9 项播放测试，以及分章工作台、交互与 Tiptap/Streamdown 三套浏览器回归通过。构建、lint、Lingui 英文缺失 0、严格 OpenSpec 校验通过。构建保留包体积/静态中文目录提示，lint 保留既有 sidebar cookie 警告。

夹具只由测试服务器显式入口加载，不进入生产路由。测试未触发真实下载、生成、删除、文件选择或保存；宿主协议与工程/音色数据未改变。真实 macOS 原生交互及 Windows/Linux 需要分别验收，不以合成数据替代。
