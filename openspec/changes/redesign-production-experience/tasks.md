# Tasks

## 1. 基线与设计

- [ ] 1.1 用真实工程逐项记录导入、分析、绑定、生成、试听、导出及失败恢复的当前路径、截图和问题；与示例界面逐项比对并记录差异。
- [ ] 1.2 在真实 Tauri 界面中迭代覆盖正常、空、加载、失败、运行中和窄窗的交互方案；用一章完整任务检查入口、反馈和往返路径，不维护独立浏览器原型。
- [ ] 1.3 编写颜色、排版、空间、组件、交互和无障碍规范，实测亮暗对比度与焦点；将最终规范关联到品牌和工程文档。
- [ ] 1.4 审计原生交互控件和重复实现，逐项对照共享 shadcn/Base UI 与成熟组件，记录替换或保留理由；评估 Motion 的布局动效、减少动态效果、包体和真实桌面表现。
- [ ] 1.5 以隔离测试工程在真实桌面逐页审计入口、状态、键盘、亮暗与小窗口；记录复现、证据及未验证项，禁止用示例状态代替宿主事实。
- [ ] 1.6 为已确认问题补齐可测试规格，核对现行主规格、在途变更及数据保护约束；通过 `openspec validate redesign-production-experience --strict`。

## 2. 章节制作

- [x] 2.1 实现共享工程外壳及可发现、窄窗可操作的导航；验证路由、键盘、焦点和阅读位置保持。（已由 `icon-navigation-rails` 交付，8 项任务完成并经 macOS 真实窗口验收。导航按用户 2026-11-17 的决定改为 56px 纯图标栏，名称由悬停提示与无障碍名称提供，窄窗口不再需要展开入口；design 第 2 节的文字入口要求随之作废。）
- [x] 2.2 重组目录、正文和片段属性，使归属与声音编辑就近完成；验证保存失败、重试、人工保护和切章草稿。（已由 `simplify-chapter-workflow`、`refine-chapter-audio-workbench` 2.5 与 `add-manual-speaker-attribution` 交付：当前章归属与声音就近编辑、自动保存与撤销、失败重试、正文归属标记与浮条；证据见各自的 validation.md。）
- [x] 2.3 重组章节音频区域及状态、失败恢复与播放控制；验证真实进度、断点、选中和播放位置分离及导出。（功能已由 `chapter-audio-workbench`、`refine-chapter-audio-workbench`、`add-chapter-workflow-status` 与 `localize-workspace-feedback` 交付：常驻播放栏、可折叠片段轨道、真实进度、单一播放会话、失败恢复与下一步。真实窗口闭环由 `chapter-audio-workbench` 6.1/6.2 和 `refine-chapter-audio-workbench` 3.1 跟踪，不在此勾选原生验收。）
- [x] 2.4 整理助手入口与上下文面板；验证草稿、迟到结果、固定任务目标和面板往返。（已由 `redesign-agent-workspace` 交付，17 项任务完成；其后 `rebuild-agent-ui-on-assistant-ui` 将会话区替换为 assistant-ui 实现，真窗口验收由该变更任务 9 跟踪。）
- [x] 2.5 移除独立静态示例工作台；先确定示例入口、替代路径及隔离的数据适配，使示例复用真实工作台并验证无法写入真实工程，不删除用户数据。（已由 `unify-forms-theme-and-interactions` 10.3 与 `simplify-project-home` 交付：示例页以隔离的只读数据复用 `ProjectWorkspace`，独立静态 `chapter-workspace.tsx` 已删除，2026-11-23 复核源码无该文件。）

## 3. 产品其余页面

- [x] 3.1 按统一规范重做首页和导入流程；验证无模型时可导入、编码确认、失败恢复和示例隔离。（已由 `simplify-project-home`、`import-drop-entry` 与 `first-run-onboarding` 交付，三者任务全部完成；导入不依赖模型见 `simplify-chapter-workflow`。）
- [ ] 3.2 重做角色、音色和模型入口与任务状态；验证资源状态、绑定、试听、下载取消和失败恢复。
- [x] 3.3 重做设置及引导的导航、表单、反馈；验证搜索、保存、失败、语言与主题。（已由 `first-run-onboarding` 与 `settings-as-route` 交付：常驻快速上手页改为一次性首启引导加设置内使用指南，设置由浮层改为路由页；`settings-as-route` 4.2 的浏览器目验仍在其变更内跟踪。）

## 4. 集成验收

- [ ] 4.1 执行前端构建、相关自动化和完整任务回归；记录中英文、亮暗、1024×680 与更窄窗口的检查。
- [ ] 4.2 在真实桌面宿主完成本地导入到章节播放和导出，记录真实模型、听感和平台限制；更新 README、主规格、知识库及验收记录。

## 对账说明（2026-11-23）

本变更是 2026-11-13 建立的伞形变更，其后多个具体变更已经交付其中的功能任务。2026-11-23 逐项对照源码、归档变更的任务与验证记录：2.2–2.5、3.1、3.3 由后续变更交付，按证据勾选并注明出处；2.1 的交付形态与原设计不同，同样注明。以下任务仍未完成，继续由本变更跟踪，安排在统一原生窗口验收时执行：

- 1.1、1.5（真实工程与真实桌面审计）：已有部分记录见[组件与交互审计](../../../docs/desktop-studio/component-interaction-audit.md)、[界面问题清单](../../../docs/ui-ux-audit/README.md)与[制作体验设计](../../../docs/desktop-studio/production-experience-design.md)；逐路径、键盘、读屏及中英亮暗最小窗口的完整矩阵未覆盖。
- 1.2（真实界面迭代）：各后续变更分别做过真实窗口迭代，尚未用一章完整任务统一复核入口、反馈与往返路径。
- 1.3（设计规范与实测）：视觉方向已被[官方视觉基线](../../../docs/knowledge/decisions/default-ui-baseline.md)取代，现有对比度实测只针对已被替换的方案，需要按官方基线重新实测。
- 1.4、3.2：剩余工作由 `unify-forms-theme-and-interactions` 的未勾任务承接。
- 1.6：与现行主规格冲突的增量已于 2026-11-23 移除，即 `desktop-interface-consistency` 对「语义圆角」的修改、`chapter-production-workspace` 对「稳定工程外壳」的修改，以及 `production-experience` 中针对已删除的快速上手页的「引导状态可感知且基于事实」。`production-experience` 的其余需求仍然有效，归档时并入主规格。
- 4.1、4.2：系统输入法、读屏、减少动态效果、人工听感及非 macOS 平台的证据仍缺。
