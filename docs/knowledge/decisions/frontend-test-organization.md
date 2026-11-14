# 前端测试分层与迁移

2026-11-14，已实施。适用于当前 Vite 8、Vitest 5 和 Playwright Test 1.65。

以 SwarmDrop 的 Vitest 分层为参考：前端逻辑测试在 `tests/unit/`，浏览器流程在 `e2e/`，共用合成夹具在 `tests/helpers/`。Playwright Test 管理浏览器和夹具服务器，使用项目声明的依赖；不再要求新测试手动启动浏览器。历史独立脚本已迁移到按领域分组的 `e2e/`；旧工作台专有流程按可用行为迁入当前路由或共享组件。不得为了减少文件数直接删除恢复、并发或数据完整性场景。

验证：Vitest 20 个文件、85 项通过；Playwright Test 在 macOS Edge 单工作进程下 103 项通过，含 128 组页面矩阵。三工作进程时 3 项出现等待/元素卸载失败，分别单进程通过；默认单进程并保留失败 trace，不把并发稳定性描述为已解决。浏览器使用合成宿主，不证明真实 Tauri 窗口行为；原生 WebView 可后续评估 SwarmDrop 使用的 WebdriverIO Tauri 服务，目前未接入或验收。覆盖对应关系见 [OpenSpec 设计](../../../openspec/changes/migrate-frontend-tests/design.md)。
