# 分章工作台的交互减负

更新：2026-11-08，输入部分由[章节归属工作流](chapter-attribution-workflow.md)替代，当前使用 shadcn 原生文本域，不再依赖 Tiptap。

日期：2026-11-07。状态：已决定并实现，隔离浏览器 IPC 回归通过；本轮未验证真实桌面与模型质量。适用范围：分章工作台、Tiptap 输入及 AI Elements 消息，不代表全应用重新设计。

## 调研与取舍

- [NN/g：Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)：常用功能直接出现，低频功能按需展开，入口须清晰且避免多级隐藏。采用“更多操作”集中规则/追加文件；模型选择仍直接显示。目录与原文审阅互相依赖，因此继续同屏，不改成多步向导。
- [GOV.UK：Button](https://design-system.service.gov.uk/components/button/)：减少竞争性主按钮，精简页面后再增加次级操作。继续制作使用次级样式，撤销仅可用时出现；空会话的检查由“填默认问题→发送”缩为一次明确触发。
- [GOV.UK：Recover from validation errors](https://design-system.service.gov.uk/patterns/validation/)：保留用户已填内容，提供问题原因和下一步。保留失败输入与人工修改；配置不可用及发送目的地改变仍直接呈现，不收入说明菜单。行号先本地输入，再明确提交，避免每个数字都触发读取。
- [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)：有名称的操作、可见焦点、长内容约束、键盘替代和可理解的状态。用快捷键标题/无障碍提示替代常驻快捷说明，字数接近限制才显示；原文引用后聚焦输入，历史可键盘阅读，回到最新恢复跟随。

以上是针对本应用的取舍，并非将政务网站表单规范或全部通用规则机械套用到桌面制作工具；未进行真实用户可用性研究。

## 实现

- [ChapterDiagnostics](../../../src/components/projects/chapter-diagnostics.tsx)：空会话且无草稿时一键检查，同会话请求在接受前也防重；有输入不覆盖。状态与失败保持可见，发送范围和预算放在明确的“会话信息”入口。
- [SessionInput](../../../src/components/ai-elements/session-input.tsx)：模型选择、设置、Tiptap 和发送组成一个区域；2000 单元限额保留，1800 起显示计数。引用加入才聚焦，不因流更新夺取焦点。
- [工作台](../../../src/components/projects/chapter-splitting-workbench.tsx)：目录点击用于定位，编辑字段显式展开；有效选区才显示询问动作并保存截取范围；行号 Enter/前往才读取，错误在字段旁反馈。
- [消息](../../../src/components/ai-elements/session-messages.tsx)：保留语义角色但移除重复可视标签，Markdown 标题和表格/代码表面服从侧栏尺度。消息增高时仅在用户原本跟随底部时滚动；主动阅读旧记录可保持位置并“回到最新”，随后焦点回到可键盘滚动的历史。

## 验证

新增 `tests/workbench-ux-browser.mjs`：模型选择在输入工具栏、默认不显示用量/常规说明、键盘打开信息并 Escape 返回焦点、菜单可发现、行号提交前不读取、引用后聚焦、有草稿不显示默认检查、双击只产生一次 ai_start、缺少工具能力禁止检查、改变配置须确认、旧消息阅读位置保持与回到最新。

既有 `tests/workbench-browser.mjs` 更新到新菜单/编辑入口，仍验证采用失败幂等重试、过期、人工操作、历史、停止、1024×680 中英亮暗主题；`tests/session-input-route-browser.mjs` 与 `tests/typeset-browser.mjs` 分别覆盖实际助手输入及流式 Markdown。全部使用合成夹具，命令与桌面边界见[工作台验证](../lessons/chapter-splitting-workbench.md)。截图在 ignored 验收目录，生成截图关闭有限动画，避免把 150ms 选中态过渡误认为最终样式。

> 2026-11-14：上述旧助手输入夹具已由实际路由的 `tests/session-input-route-browser.mjs` 和共享排版的 `tests/typeset-browser.mjs` 接替；历史 Tiptap 描述仅反映当时实现。
