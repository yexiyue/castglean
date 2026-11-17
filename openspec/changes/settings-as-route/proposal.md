# Proposal

## Why

设置以浮层对话框呈现，占据屏幕中央却遮挡工作区，调整设置时无法对照页面实际效果（如存储路径、服务连接对工作台的影响）；浮层高度受限（约 42rem），长表单要内部滚动。改为独立路由页面后与工程首页、模型、音色同等地位，配合新外壳（内容面板浮于背景色）呈现 Codex 式整页设置：左侧分类导航 + 右侧分区内容 + 顶栏返回。用户 2026-11-17 反馈"设置页面弄成弹窗不太好，应该是单独的路由"。

## What Changes

- 新增 `/settings` 路由（`?section=` 深链分区），在圆角内容面板内复用现有 `SettingsPanel` 双栏布局（分类导航 + 分区内容）。
- 设置入口保持唯一：顶栏齿轮 → 导航至 `/settings`；`openSettings(section)` 改为路由导航，失败路径（服务连接、存储位置）仍可直达对应分区。
- 顶栏在 `/settings` 时显示返回按钮（历史可退则后退，否则回工程首页）。
- 移除设置浮层：删除 `SettingsDialog` 与会话中的 `settingsOpen` / `settingsSection` / `closeSettings`，不保留兼容层。
- 分区切换在设置页内以 `replace` 改写地址（后退一次回到进入设置前的页面，不逐分区回退）。
- 更新 `e2e/settings` 相关 spec 的地址形态与定位器（`?settings=` → `/settings?section=`，dialog → 页面）。

## Capabilities

- **New Capabilities**: 无。
- **Modified Capabilities**:
  - `desktop-interface-consistency` —— 设置呈现从浮层改为路由页面：新增"设置页面与返回入口"要求（唯一入口、分区深链、顶栏返回）；"可清除搜索"中设置搜索的 Escape 语义保持不变。

## Impact

- **代码**：`src/routes/settings.tsx`（新增）、`src/lib/desktop-session.tsx`、`src/components/desktop-shell.tsx`、删除 `src/components/settings/settings-dialog.tsx`；`SettingsPanel` 本体与各分区组件不动。
- **测试**：`e2e/settings/` 8 个 spec 的地址与定位器；无宿主改动。
- **文档**：知识库决策记录（浮层 → 路由的取舍）；DESIGN.md 不涉及新视觉规范（沿用外壳面板）。
- **不改动**：各分区设置组件的表单行为、凭据三态、存储语义；顶栏齿轮唯一入口约束（AGENTS.md）。
- **验证**：`pnpm build`、`e2e/settings`、浏览器目验（亮暗、中英、1024×680）。
