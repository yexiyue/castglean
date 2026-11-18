# Tauri 2 拖放导入链路与事件模拟

日期：2026-11-14；适用：Tauri 2（@tauri-apps/api 2.x）、macOS 15（其他平台未实测）。

## 结论

- 文件拖放用 `getCurrentWebview().onDragDropEvent()`（`src/hooks/use-drag-import.ts`），底层注册 `tauri://drag-enter|over|drop|leave` 四个监听；`dragDropEnabled` 默认开启即可用，不要关闭（关闭则 Tauri 事件不触发，Windows 上才轮到 HTML5 drop）。webview 内部的 HTML5 onDrop（如音轨段内拖拽）与 OS 文件拖放互不影响。
- 宿主侧路径校验集中在 `Selections::select`（`src-tauri/src/novel_import/selection.rs`）；对话框与拖放两条入口收敛到 `select_many`（整批回滚，不留部分选择）。新入口直接复用，不要另写校验。
- e2e 模拟：`tests/helpers/desktop-fixture.tsx` 的 `mockIPC(cb, { shouldMockEvents: true })` 启用官方 mocks 的事件分发，`window.fixture.fireDragEvent(type, paths)` 用 `emit('tauri://drag-…')` 直达监听器，payload 保持对象形状。
- tauri-mcp 的 `ipc-emit-event` 会把 `--payload` 按**字符串**发出（双重序列化）：`onDragDropEvent` 内部 `new PhysicalPosition(payload.position)` 拿到 undefined 抛错、监听器静默不走。真实窗口验收要在 webview 内用 `window.__TAURI__.event.emit(事件名, 对象)` 发射。

**Why**：拖放事件的 position/paths 在库封装层被解构，payload 形状错误不会报错到调用方，只会表现为「事件发了但 UI 没反应」；两条模拟路径（fixture/tauri-mcp）的序列化行为不同，混用排查成本高。

**How to apply**：新增拖放类功能时先决定接收范围（本项目为全窗口接收，无需坐标换算）；宿主命令复用 `select_many`；e2e 用 `fireDragEvent`；真实验收用 webview 内 emit 对象 payload。相关规格：`openspec/changes/archive/2026-11-19-import-drop-entry`（拖放导入入口）。
