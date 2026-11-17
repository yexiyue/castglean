# 设置从浮层改为路由页面

2026-11-17。用户反馈设置弹窗遮挡工作区、高度受限；随 `settings-as-route` change 落地。

## 决定

设置以 `/settings?section=` 独立路由页面呈现（Codex 式：分类导航与分区内容同为白色面板双栏 + 顶栏返回按钮），入口唯一为最左侧栏底部的设置按钮（同轮把顶栏的模型状态 chip 与设置齿轮迁入侧栏底部 `RailFooter`，AGENTS.md "设置只由顶栏齿轮进入"规则随之更新）。**关键取舍：`SettingsPanel` 组件常驻挂载在 DesktopShell（`data-slot="settings-page"`），路由只驱动可见性**——不做真卸载。

## 原因

原浮层是 `keepMounted`，以下状态机跨"关闭设置"存活，且有 e2e 断言：

- 引擎存储表单草稿（endpoint/token）：关闭后重开仍在（`engine-storage-form.spec` 47–49 行）
- LLM 连接表单草稿与凭据输入（`llm-form.spec` 23–27 行）
- **待确认保存的恢复状态**（保存失败/回执丢失后的"重试原保存"，`llm-form.spec` 55–64 行）——真卸载会丢失恢复入口

真路由卸载要么重写这套产品语义，要么把全部表单草稿提升到会话（两个大组件的状态机改造）。常驻挂载 + 路由驱动可见性以最小代价保住全部语义：URL、深链、顶栏返回、浏览器后退都是真实路由行为，仅组件生命周期保持会话级——与会话持有工作区草稿的既有原则一致。

## 焦点归还

对话框时代的"关闭归还焦点"由会话显式接管：`openSettings` 记住 `document.activeElement`，DesktopShell 在 `/settings` 离开时调用 `restoreSettingsFocus`（含浏览器后退路径）。回归：`model-settings-navigation.spec` 断言返回后焦点回到模型菜单触发按钮。

## 边界

- `?settings=` 参数不再兼容，e2e 已同步为 `/settings?…&section=…`；fixture 参数（fixture/llmFixture/locale/theme）由 openSettings 以 `search(previous)` 透传。
- 设置不是侧栏目的地，齿轮唯一入口不变（AGENTS.md）。
- 未识别分区回落默认分区（SettingsPanel 既有行为）。


2026-11-17 审查补充：根路由不再保留退役的 `?settings=` 参数；设置深链只由 `/settings?section=` 表达。返回会卸载并重建原页面，不能只缓存旧 DOM 节点归还焦点；优先按原控件的无障碍名称定位重建节点，避免生成 id 在其他控件上的复用；在目标异步挂载期间有界跟随加载界面到正式页面的节点替换，用户已主动移焦时不抢回焦点。页面加载/失败外壳可先于桌面会话 provider 渲染，设置入口在此阶段直接导航，不读取尚未存在的会话。模型状态与设置共用底部栏，模型中心不再保留顶部重复入口；模型状态仅报告真实盘点，浏览器明确显示预览。回归见 `e2e/settings/model-settings-navigation.spec.mjs` 与设置、工作台矩阵。
