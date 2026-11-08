# Design

## Context

沿用 `refactor-local-ai-task-runtime` 的 localProjectText、localProjectEdit、aiHistory/Channel 和 splitProposal/adopt/discard 契约。当前 `/new` 混合导入与长表单，ChapterDiagnostics 将候选挂在输入后方。动机见 proposal。

## Goals / Non-Goals

Goals：用具体的分章流程重写前端，将导入入口与已导入工作台分离，复用真实宿主状态和现有主题。
Non-Goals：不改变 schema、后台调度、来源坐标、预算及整套采用；不添加迁移、小说正文富文本编辑、通用 agent 页面或逐条采用。

## Decisions

1. 导入页只负责创建、文件选择与编码确认；已有来源时进入专用工作台。已有工程的追加导入通过显式入口展开，保留每文件一章流程。工作台自有目录、正文和助手布局，避免 PageShell 固定宽度与应用侧栏挤占空间。
2. 工作台持有临时选中来源/行、面板显隐和审阅引用；宿主持有全部业务事实。目录和正文分页，源请求有失效保护，定位即清除旧页，避免迟到响应和旧正文混淆。使用 sourceId+heading/start 匹配结构变化，不能按候选随机 id 判断新增；包括标题、范围和分卷差异。
3. 方案从消息引用打开，在中间区域显示可过滤的结构对照及固定操作区；查看原文可返回同一方案。每次工程 revision 变化重新查询方案。采用/放弃复用命令身份，先提交再读取工程，不在前端乐观改目录。
4. 保留共享 useAiSession/transport 的订阅语义，重写展示组件：历史可展开列表，工具展示业务动作和状态，技术参数默认不显示，方案引用单独按钮。正文上下文是明确添加的有限用户文本，不伪造工具事实。未发送草稿按 session id 存在页面会话状态，失败不清除；切页/重启不承诺恢复未发送草稿。
5. 宽屏三栏，目录默认 224px、助手默认 360px，可通过带键盘支持的分隔条调整；容器较窄时目录默认隐藏，助手可收起，收起不卸载会话。独立 overflow 与 min-width:0 保证输入框和审阅操作可达。不增加布局依赖。
6. 工具名来自本地已知映射，未知类型显示安全摘要；JSON 不再直接铺在正常用户流程。生成中仅在用户处于底部时跟随滚动，读历史时不抢回位置。

## Risks / Trade-offs

- [旧方案与新工程对照不再同基线] → 过期提示并禁止采用，对照只作为当前参考。
- [长目录/历史影响布局] → 目录和变化分页，消息独立滚动，历史加载保留滚动位置。
- [SDK 发送错误可能通过 onError 返回] → 以消息身份/提交结果判断草稿清理，失败恢复原输入，不将取消视为清空历史。
- [浏览器没有宿主] → 产品保持真实预览引导；自动化使用隔离的合成 IPC 夹具，不作为真实桌面验收。

## 调研依据

- Cursor：上下文引用与 diff 审阅 https://cursor.com/help/ai-features/agent
- VS Code：独立变更集合与审阅 https://code.visualstudio.com/docs/agents/run/review-code-edits
- Claude：对话旁独立文档 https://support.claude.com/en/articles/16923645-get-started-with-claude-docs
- Google：引用定位原文 https://support.google.com/gemininotebook/answer/16179559?hl=en

参考交互机制，不照搬其已落盘编辑语义；CastGlean 仍为确认后提交候选。


## 2026-11-07 助手组件增量

按用户后续要求，输入使用 Tiptap 的 React 编辑器，消息使用官方 AI Elements registry 的 Message/MessageContent/MessageResponse，并适配现有主题及 Base UI。通过 shadcn CLI 的 dry-run/view 读取官方源，保留相关源码与来源注释，避免覆盖现有 button/tooltip 等组件。Markdown 渲染使用 Streamdown 的 CJK 和代码插件；数学及图表插件不属于当前分章消息需求。

Tiptap 只启用文档、段落、文本、换行、撤销及占位提示，保留纯文本 IPC 契约。字符串按 JSON 文本节点恢复，不能将用户输入当 HTML 解析；保留会话草稿、字数限制、组合输入和快捷发送。正文引用仍是可移除的显式上下文，不引入新的宿主持久格式。

消息文本采用流式 Markdown，用户输入仍原样展示，工具结果继续通过宿主类型引用进入方案审阅；未完成/失败标记不改变。验证覆盖 Markdown/代码/表格、HTML 安全、字面标签、多行粘贴、撤销、发送失败与切换会话。


## 同日追加：交互减负

依据 NN/g Progressive Disclosure、GOV.UK Button/Validation 和 Vercel Web Interface Guidelines：默认视图保留当前任务必需项，低频功能使用明确入口，反馈邻近操作并保留输入。

- 空会话“检查当前分章”直接发送默认检查请求；有草稿时不显示此捷径。发送共享同一入口并防止快速重复触发。
- Tiptap 与模型选择/发送组成一组；正常时不重复展示解释与全程计数，字数接近限额时显示；会话信息展示请求预算及发送范围，配置缺失、重绑定、失败和停止仍直接可见。
- 工程规则/追加文件进入“更多操作”，撤销仅可用时显示；目录浏览与标题编辑分开，折叠表单保留显式入口。继续制作降为次级导航。
- 监听来源区域的真实选区，只有有效选区才出现询问动作，捕获范围而不依赖按钮抢焦点后的选区。引用加入后才聚焦输入。行号表单先本地编辑，Enter/前往才提交读取。
- 消息保持用户/助手语义但移除重复可视角色标签，约束 Markdown 标题尺寸与嵌套表面；阅读旧消息时不跟随，回到最新后恢复跟随。方案采用/放弃、后端事务和隐私确认语义不变。

参考：
- https://www.nngroup.com/articles/progressive-disclosure/
- https://design-system.service.gov.uk/components/button/
- https://design-system.service.gov.uk/patterns/validation/
- https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
