# Tasks

## 1. 路由与会话

- [x] 1.1 新增 `src/routes/settings.tsx`（`validateSearch` 接 `section`，LibrarySidebar + 圆角面板 + `SettingsPanel`）；验证：`/settings` 与 `/settings?section=models` 直达分区
- [x] 1.2 `desktop-session.tsx`：`openSettings` 改导航 `/settings?section=`（页内 replace、跨页 push）；删除 `settingsOpen` / `settingsSection` / `closeSettings`；验证：tsc 通过
- [x] 1.3 顶栏返回按钮：`/settings` 时显示，`canGoBack` 后退否则回首页；验证：从工作台进入→返回原位，直开深链→回首页
- [x] 1.4 删除 `settings-dialog.tsx` 与 DesktopShell 挂载；验证：全局无 `role=dialog 设置` 残留

## 2. 测试迁移

- [x] 2.1 `e2e/settings/` 8 个 spec：地址改 `/settings?…&section=…`，dialog 定位器改页面容器，「关闭」相关断言改返回按钮；验证：`pnpm test:browser e2e/settings` 全绿
- [x] 2.2 `tests/unit/` 无设置浮层引用（grep 核实），无需改动

## 3. 文档

- [x] 3.1 知识库决策记录（浮层 → 路由取舍、参数语义升级），更新索引
- [x] 3.2 i18n 提取返回按钮文案并补英文

## 4. 验证

- [x] 4.1 门禁：`pnpm lint`、`pnpm build`、`pnpm test:browser e2e/settings e2e/workspace`；验证：输出全绿
- [ ] 4.2 浏览器目验：亮暗、中英、1024×680 下设置页布局、齿轮直达、返回行为、分区深链；验证：实操记录
