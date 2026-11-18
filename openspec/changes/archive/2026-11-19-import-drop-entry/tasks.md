# Tasks

## 1. 宿主命令

- [x] 1.1 `selection.rs` 新增 `select_many`（数量预检 + 逐个 `select` + 失败回滚）与测试用 `count`；单测覆盖多文件成功、含非 txt 整批回滚、超量报错。
- [x] 1.2 `commands.rs` 对话框命令改用 `select_many`，新增 `local_source_accept(paths)`；`lib.rs` 注册；`cargo test --test specta_export` 重生成 bindings；`cargo test` + `cargo clippy` 通过。

## 2. 前端入口

- [x] 2.1 新增 `use-drag-import.ts`（仅桌面挂载、unlisten、注册失败静默降级）；重构 `new.tsx`：初始态虚线导入卡 + 可见「TXT 导入方式」标签与模式帮助文案、拖放 overlay、`acceptSelected` 共用追加逻辑、`invalid_format` 专属错误、未完成草案列表对齐应用列表习惯；`pnpm build` 通过。
- [x] 2.2 `pnpm i18n:extract`，补 en 翻译，清理废弃条目。

## 3. 测试与验收

- [x] 3.1 fixture 启用 `mockIPC` 事件模拟，新增 `local_source_accept` 分支与 `fireDragEvent`；新增 `e2e/workspace/import-drop.spec.mjs` 覆盖 overlay 出现/消失、拖放成功导入与自动填名、非 TXT 错误；受影响 e2e（desktop-workflow、desktop-polish）通过。
- [x] 3.2 真实窗口验收：ipc-emit-event 注入 drag-enter/drop 核对 overlay、真实 txt 导入、pdf 错误提示，亮暗主题各一轮。
