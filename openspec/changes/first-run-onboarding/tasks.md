# Tasks

## 1. 宿主应用状态

- [x] 1.1 新增 `src-tauri/src/app_state.rs`：`AppStateSnapshot`（`onboardingCompleted`）、`app-state.json` 原子读写、文件缺失或损坏按未完成处理；`init` 落在应用配置目录。
- [x] 1.2 在 `src-tauri/src/lib.rs` 注册 `app_state_snapshot` 与 `app_state_complete_onboarding` 命令及状态；`cargo test --test specta_export` 刷新 `src/lib/bindings.ts`。
- [x] 1.3 宿主单元测试覆盖：首次读取为未完成、写入后为已完成、损坏文件按未完成恢复。

## 2. 前端首启引导层

- [x] 2.1 新增 `src/lib/onboarding-state.ts`：读取宿主状态与写入完成标记的 hook，失败时不向用户暴露底层异常。
- [x] 2.2 新增 `src/components/onboarding/first-run-guide.tsx`：按真实工程状态给出「新建工程」或「继续导入」，提供跳过入口，不阻断导航；纯函数判定拆到 `src/lib/first-run-step.ts` 并补单元测试。
- [x] 2.3 `src/routes/index.tsx` 接入引导层：引导出现时不重复渲染常规空态；出现章节后自动结束并写入完成状态。
- [x] 2.4 引导判定对齐设计 D3：本地没有已出章节的工程即呈现引导，已导入但尚无章节的工程指向继续导入（不再按「已有工程」直接判定完成）。

## 3. 删除快速上手页并补使用指南

- [x] 3.1 删除 `src/routes/start.tsx` 与 `src/components/onboarding/start-guide.tsx`；侧栏移除「快速上手」入口，`NavId` 去掉 `start`。
- [x] 3.2 `src/components/browser-preview-guide.tsx` 移除指向快速上手的链接，保留示例工程入口与能力边界说明。
- [x] 3.3 新增 `src/components/settings/guide-settings.tsx` 并在设置面板注册「使用指南」分区：四步主流程与新建工程、模型中心、音色中心、存储位置入口。

## 4. 文案与测试

- [x] 4.1 `pnpm i18n:extract`，补齐 `src/locales/en/messages.po` 新条目翻译并清理废弃 msgid。
- [x] 4.2 `tests/helpers/desktop-fixture.tsx` 增加 `app_state_snapshot` 与 `app_state_complete_onboarding` 合成 IPC，支持引导已完成的场景参数。
- [x] 4.3 更新 `e2e/workspace/navigation-links.spec.mjs`、`e2e/settings/settings-guide.spec.mjs`、`e2e/workspace/desktop-polish.spec.mjs`：移除 `/start` 断言，补充「首启引导出现 → 跳过后不再出现」「设置可打开使用指南」「侧栏无快速上手」的断言。

## 5. 验收

- [x] 5.1 真实桌面窗口验收（macOS，隔离标识符实例 `com.yexiyue.castglean.firstrun20260715`）：全新数据目录首次启动出现引导层；点「跳过」后引导消失、回到常规空态，宿主 `app-state.json` 落盘且 `app_state_snapshot` 返回已完成；设置内「使用指南」可打开，四步入口与存储位置入口可达；亮色中文与暗色英文两套文案均正确渲染。浏览器预览不弹引导层由浏览器回归覆盖（宿主缺失，不具备文件选择与模型能力）。
- [x] 5.2 `pnpm test`（86 项）、`pnpm build`、`pnpm lint` 与目标 e2e 通过；Rust 侧 `cargo test`、`cargo clippy --all-targets` 通过。
