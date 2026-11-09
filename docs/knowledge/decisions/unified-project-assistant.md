# 单一章节工作台与工程助手

日期：2026-11-08。规格：[unify-project-assistant](../../../openspec/specs/project-assistant/spec.md)。本决定替代[上一阶段](unified-chapter-workspace.md)的双模式与独立助手设计。

## 决定与依据

一个目录、一个虚拟正文、一个工程级 AI 会话。检查分章与分析本章是快捷命令和领域能力，不再要求用户先切页面。当前章和已引用文段可见；每次执行固定自己的目标，切章不切会话、不启动或重放任务。点击标注进入归属检查器，返回助手保留消息位置和草稿。结构操作通过独立编辑/规则/分卷/跳行浮层及逐行边界动作完成，待检查统一入口提供结构/归属筛选。

官方参考：[Cursor Agent](https://cursor.com/docs/agent/overview)的同一助手组合工具；[VS Code 工具](https://code.visualstudio.com/docs/agents/run/tools)与[上下文](https://code.visualstudio.com/docs/chat/copilot-chat-context)分离；[Notion Agent](https://www.notion.com/help/notion-agent)默认当前内容与快捷操作。这里选择工程会话而非每章独立助手，是结合 CastGlean 连续制作流程的产品决定，不代表这些产品实现完全一致。执行继续复用 [shadcn Trace/Tool](https://ui.shadcn.com/docs/ai-elements/base/tool)，输入使用原生文本域。

## 运行与数据边界

`project_assistant` 会话不绑定章，`StartRun.workspaceContext` 绑定本次 action/chapter。接收时固定工程修订和来源摘要；重试沿用旧目标，普通后续消息用新上下文。快捷分析直接进入已实现的结构化窗口流水线；普通请求由 Agent 调用分章工具、只读 `read_analysis` 或 `analyze_chapter`。显式分章快捷命令只暴露分章工具集。分析工具仅受理一个目标，graph 完成本轮后同一 Worker 发布分析，不在工具回调里提前终结租约。分析受理后保持同一回复 streaming，后续领域阶段复用同一消息 ID；最终发布才完成消息，避免前端因回复身份变化重新同步。工具参数与书籍内容不能提供执行身份。

结构候选仍需采用，重分析仍生成差异、保护人工修正，撤回继续由领域宿主处理。跨章结果通过宿主结果目标查询定位，不凭当前画面判断。回复通过按页运行上下文标注所属范围，翻页和重开仍可回原章。历史结构/章节会话保留为只读记录；不拼接旧消息、不自动发送。SQLite v3 增加可空运行上下文，旧记录事务升级，不支持旧二进制降级写入。

## 验证入口

- [宿主接收测试](../../../src-tauri/src/ai/service/tests.rs)：请求幂等、上下文变化拒绝、重试固定原章与不存在目标拒绝。
- [工具测试](../../../src-tauri/src/novel_import/splitting/tools.rs)：真实调度身份、一次受理、跨工程/重复/取消拒绝。
- [SQLite Worker](../../../src-tauri/src/jobs/runtime/tests.rs)：实际 SSE 工具调用→受理→结构化模型请求→归属发布，同一会话、一次执行与重复派发不重跑。
- [融合工作台浏览器测试](../../../tests/unified-workspace-browser.mjs)：旧历史只读、分章候选采用和归属分析共用会话、草稿、迟到结果导航及结构编辑。
- [布局与键盘矩阵](../../../tests/workspace-chrome-browser.mjs)、[分析模型/检查器矩阵](../../../tests/chapter-analysis-matrix-browser.mjs)及原归属/阅读/目录回归。

真实模型语义质量与原生桌面验证必须和可控 HTTP/浏览器证据分开，最终结果见[融合验收记录](../../desktop-studio/project-assistant-validation.md)。之前的归属原生样本不能代替本次工具路由验收。

## 规格与历史整理

已完成变更同步为 [现行工程助手契约](../../../openspec/specs/project-assistant/spec.md)及相关主规格后归档。较新决定优先：本地数据库自动保存替代旧 v2 工程另存为；无默认产品配额替代累计请求/字符限制；单一工程助手替代双模式和章节隔离助手。历史提案保留原貌，主规格表达当前有效要求，不把旧阶段截图和测试数量当成最新状态。

会话模型的明确同意绑定连接、模型和配置修订；设置中删除或修改旧模型后，自动回退的可选项不能当作用户确认。再次选择模型或确认当前具体配置才可续聊，不改变正在运行的请求。
