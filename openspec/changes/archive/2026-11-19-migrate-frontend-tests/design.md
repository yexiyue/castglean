## 设计

参考 SwarmDrop 的 Vitest 分层。Node 环境用于纯逻辑与静态检查；需要组件环境时再按需加入 DOM 测试支持。Playwright Test 管理独立 Vite 夹具服务器，默认使用其安装的 Chromium，也允许通过环境变量指定本地浏览器。保持现有合成 IPC 与历史测试，逐项迁移并验证，不能仅删除旧脚本。原生桌面端另行验收。

## 旧工作台覆盖核对

`ChapterSplittingWorkbench` 仅被旧测试夹具引用；当前工程路由使用 `ImportedWorkspace`。旧夹具中的适用覆盖按行为转移：方案确认、修订过期和相同操作重试由 `e2e/chapters/split-confirm.spec.mjs`、`split-recovery-route.spec.mjs` 覆盖；目录搜索、结构编辑、原文选择和不同窗口布局由 `e2e/chapters/directory-search-route.spec.mjs`、`structure-actions.spec.mjs`、`source-selection.spec.mjs` 和 `e2e/workspace/workspace-chrome.spec.mjs` 覆盖；会话草稿、模型确认、失败恢复由 `e2e/assistant/session-input-route.spec.mjs`、`model-consent.spec.mjs`、`project-assistant-send-failure.spec.mjs` 覆盖；上下文用量由 `tests/unit/context-usage.test.mjs` 与 `e2e/assistant/context-usage-route.spec.mjs` 覆盖；更早消息、流式滚动与中断提示由 `e2e/assistant/session-messages.spec.mjs` 覆盖，取消/重试语义另有 `tests/unit/ai-transport.test.mjs`。旧的独立“分章诊断”窗口、其专有菜单与像素值已不属于当前界面，不再作为当前产品要求。

浏览器测试默认单工作进程：部分需要实际媒体解码和持续状态更新的场景在本机三进程竞争时出现元素卸载或等待超时；相同场景单进程重跑通过。保留失败 trace 和截图，允许需要时显式调整 workers。夹具服务器扫描全部夹具入口预处理依赖，避免冷启动时 CommonJS 模块未转换；不因此将合成浏览器测试视为原生验收。
