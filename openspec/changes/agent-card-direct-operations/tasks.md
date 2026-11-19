# Tasks

## 1. 框架重构

- [x] 1.1 `DelegatedToolCard` 泛化为注册表驱动的三段式卡片：展示行 / 进度段 / 结果段，结果段按 `ResultReference.kind` 分发；结果区渲染在折叠态外。验证：三个专业任务卡折叠态可见结果区，展开仍见子代理嵌套消息。
- [x] 1.2 `DelegatedToolContextValue` 扩展：`castingProgress`、`projectRevision`、`onDesignInCenter`、`onOpenSplitReview`、`onOpenCandidateReview`；`ThreadTrailing` 选角进度条移除。验证：进度锚定选角结果处随帧更新，同屏无双份。

## 2. 选角结果面（吸收 cast-review-in-agent-card）

- [x] 2.1 选角结果面组件：拉取建议/绑定/画像与模型资源，按目标复用 `CastingSuggestionPanel`；`onAdopted` 后重取并触发 `version` 复读。验证：卡内试听并采用绑定后与角色中心状态一致。
- [x] 2.2 `onDesignInCenter` 外部预填通道：定位角色中心目标并打开设计草稿。验证：卡内选择设计草稿后跳转角色中心，草稿内容一致。

## 3. 分章结果面

- [x] 3.1 分章结果面组件：差异摘要 + 整套采用/放弃（`structure` 操作族），过期/已采用/已放弃卡内标注禁止重复采用；细调入口打开既有审阅弹窗。验证：卡内采用后目录与弹窗一致，改目录后旧卡显示过期。

## 4. 归属结果面

- [x] 4.1 归属结果面组件：候选状态显示（待采用/已采用/过期/来源变化）+ 采用（显式传入全部无冲突差异的 ID；`selected=null` 用于放弃，走 `candidate-operations` 注册表）/放弃/重分析入口 + 逐片段修正跳检查器。验证：卡内采用后当前版本与检查器一致；来源变化候选禁止采用。

## 5. 清理与文案

- [x] 5.1 删除 `cast-review-in-agent-card` change 目录，知识库索引行改指本 change。验证：`openspec list` 无该 change，索引链接可达。
- [x] 5.2 新增文案补齐 zh/en（进度、失败、采用、跳转入口），`pnpm lingui` 提取无遗漏。验证：构建通过，en 无占位残留。

## 6. 回归与验收

- [x] 6.1 扩展 `session-recovery-regressions` 浏览器用例：三域卡内就地操作、修订冲突呈现、折叠态可见性。验证：相关 e2e 通过。
- [x] 6.2 全量检查：TypeScript、Biome、宿主测试（确认零 diff 或仅测试）、OpenSpec 严格验证。验证：命令输出记录进验证文档；宿主代码零改动。
- [ ] 6.3 桌面真窗口验收：三个专业任务各跑一轮真实流程（批准试听→卡内采用；分章→卡内采用；分析→卡内采用候选→检查器精修），覆盖中英、亮暗、窄窗口；结果记录进 validation.md 并同步 README 状态与知识库索引。
