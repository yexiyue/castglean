# Tasks

## 1. 前置核实

- [ ] 1.1 用 2026-11-18 截图对应的会话复现「run 已结束但无结果区无最终答复」：读取该会话 run 状态与 records，定性是结果区折叠不可见还是恢复链路缺陷；结论写入验证记录（缺陷另行开 change，不在本 change 修）。
- [ ] 1.2 确认 `imported-workspace` 向 `CharacterCenter` 传入的 `projectRevision` 来源可在 `DelegatedToolProvider` 组装处取得（同一 hook/props 通道），不成立则在 design.md 记录替代方案后再动手。

## 2. 卡内审阅容器与数据接线

- [ ] 2.1 新建选角审阅容器组件：拉取 `voiceBindingSuggestion`/`voiceBindingBindings`/`voiceBindingProfiles` 与 `useModelResources`/`useVoiceStudio`，按目标复用 `CastingSuggestionPanel`；读取失败如实显示并支持重试。验证：浏览器回归 fixture 渲染候选与理由，断网/命令失败路径显示失败态。
- [ ] 2.2 `DelegatedToolContextValue` 注入 `projectRevision` 与 `onDesignInCenter`；`onAdopted` 后容器重取建议与绑定并触发既有 `version` 复读。验证：卡内采用绑定后，卡片与角色中心读取到一致的绑定与来源。
- [ ] 2.3 实现 `onDesignInCenter` 的外部预填通道：`imported-workspace` 定位角色中心目标并打开设计草稿（复用 `reviewResult` casting 分支定位逻辑）。验证：卡内选择设计草稿后跳转角色中心，草稿内容一致。

## 3. 结果区与进度位置

- [ ] 3.1 `DelegatedToolCard` 将 `casting_suggestion` 结果区外提到工具卡片折叠态之外（与分章卡同层级），子代理消息保留折叠区。验证：折叠态下建议摘要/审阅可见；展开仍见子代理嵌套消息。
- [ ] 3.2 `DelegatedToolContextValue` 注入 `castingProgress`，卡片内渲染「已处理/总数/失败计数」与「正在生成试听/正在整理选角建议」过渡；`ThreadTrailing` 移除独立进度条。验证：批准后进度随帧推进更新，完成后切换到审阅面板，同屏无两份进度。

## 4. i18n 与状态

- [ ] 4.1 新增文案补齐 zh/en（进度、失败、跳转入口），`pnpm lingui` 提取无遗漏。验证：构建通过，en 无占位残留。
- [ ] 4.2 卡内采用命令失败（修订冲突/目录缺失）走面板既有错误文案，不暴露 IPC 原始错误。验证：模拟修订冲突后界面如实提示且可重试。

## 5. 回归与验收

- [ ] 5.1 扩展 `session-recovery-regressions` 浏览器用例：卡内部分批准后的审阅、采用绑定、进度位置与折叠态可见性。验证：`pnpm test:e2e` 相关用例通过。
- [ ] 5.2 全量检查：TypeScript、Biome、宿主 clippy/test（若宿主无改动则确认零 diff）、OpenSpec 严格验证。验证：命令输出记录进验证文档。
- [ ] 5.3 桌面真窗口验收：批准试听 → 卡内进度 → 卡内试听并采用 → 角色中心一致性 → 设计草稿跳转；覆盖中英、亮暗、窄窗口；结果记录进 validation.md 并同步 README 状态与知识库索引（含 2026-11-18「聊天卡只做索引」分层结论被替代的标注）。
