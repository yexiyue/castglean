# 助手结果卡就地领域操作验收

2026-11-19，macOS Apple Silicon，桌面夹具（`fixture=desktop&analysis=1`）与公开合成工程。复审用系统盘独立副本和相同 pnpm 锁文件复跑，避免工作盘夹具服务启动超时。

## 自动化

| 检查 | 结果 |
| --- | --- |
| TypeScript `tsc --noEmit` | 通过 |
| `pnpm lint` | 通过，含视觉边界检查；Biome 报告 19 条 Tailwind 排序警告 |
| `pnpm test` | 85/85 通过 |
| Lingui 提取 | 英文缺失条目 0 |
| `pnpm run build` | 通过 |
| `openspec validate agent-card-direct-operations --strict` | 通过 |
| 宿主 | 零改动（`git status` 无 src-tauri 文件） |

## 浏览器会话回归

`session-recovery-regressions.spec.mjs` 13/13 通过，覆盖以下新增用例：

- 选角建议卡：折叠态外可见，展开旁白行就地「采用绑定」走 `voice_binding_adopt_binding`，重取后显示「当前绑定」；夹具联动（`window.fixture.castSuggestion/castBindings`）挂在 desktop-fixture 既有 voice_binding 分支之前拦截处。
- 卡内采用冲突如实呈现：`failCastAdopt=1` 时面板显示「操作未保存，请刷新后重试。已有结果保留。」，可重新读取工程修订和结果后再操作。
- 分章候选卡：整套采用（`split_adopt`）回执丢失时，当前界面只有一个恢复入口；从卡内重试后显示「已采用」，`splitWrites` 恰一次。审阅弹窗发起的操作仍可跨路由恢复。
- 归属候选卡：模拟写入回执丢失后，重试保留相同命令 ID、候选基线修订与差异选择，随后读取到「已采用」。
- 选角试听进度：审批续跑后仍锚定到原工具消息，已处理数、总数和失败数可读，进度只渲染一次。

既有用例更新：4 处「查看结果与审阅状态」跳转按钮断言改为新结果面的「打开审阅弹窗调整」（分章）与「在检查器中逐片段审阅」（归属）。`chapter-analysis-task`、`split-recovery-route`、`unified-workspace`、`chapter-agent` 全部通过。

## 已知边界与未决

- 初次全量套件记录为 120 通过、2 失败：`e2e/chapters/continuous-route.spec.mjs` 与 `chapter-cross-navigation.spec.mjs`（正文连续阅读/跨章导航）。二者在基线 `adbd2bf`（`git stash` 后）同样恒定失败（清理失控 biome 进程、清除 vite e2e 依赖缓存、无系统负载后基线 3/3 失败，失败点一致）。复审在系统盘独立副本跑了 24 项相关浏览器用例，22 项通过。两条仍失败，分别是 1024px 跨章播放器的横向溢出断言和连续阅读缩窗后的滚动锚点断言。
- 桌面真窗口验收（任务 6.3）未做：三个专业任务各跑一轮真实流程 + 中英/亮暗/窄窗口。
- 设计草稿预填通道（`onDesignInCenter` → 角色中心弹窗）只有实现没有浏览器用例，依赖桌面验收覆盖。
