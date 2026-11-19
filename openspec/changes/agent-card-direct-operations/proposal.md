# Proposal: 助手结果卡就地领域操作

## Why

三个专业任务（分章、归属、选角）的结果在会话里仍是「索引卡」：状态徽标加跳转按钮，实际操作必须离开对话流去分章审阅弹窗、归属检查器或角色中心完成。用户已在选角上拍板推翻这一分层（AI 会话的价值是简化操作链路），现推广为统一决策：三个专业任务的结果卡都应承载就地领域操作。此方向与 `assistant-guided-production` 的 assistant-interactions 愿景一致，但本 change 只做前端卡片框架与既有领域命令的就地接线，不提前其宿主侧持久化中断协议。

## What Changes

- 统一卡片框架：专业任务卡按「展示行 / 进度 / 结果面」三段式重构，结果面由结果引用类型驱动，注册在 `agent-workspace` 既有卡片体系内；结果区在折叠态外可见，进度锚定在产生它的调用旁。
- 选角结果卡：逐目标候选试听、采用绑定、采用画像就地完成（吸收 `cast-review-in-agent-card` 的范围，作为本 change 的一部分交付）。
- 分章结果卡：候选方案的就地整套采用与放弃（沿用宿主过期校验与幂等命令），差异摘要卡内可读；细调（章节边界编辑）仍走既有审阅弹窗。
- 归属结果卡：候选级就地操作——采用候选（全部有效片段）为待确认初稿、放弃、重分析入口；段级精修仍属检查器（保持「检查器与助手职责分明」），卡内提供直达该候选的审阅入口。
- 所有就地操作走各域现有显式命令（期望修订 + 幂等），不新增写路径；修订冲突与读取失败如实呈现。
- **范围裁决**：宿主持久化的新交互请求（说话人分歧、异步任务卡等）不在本 change，仍归 `assistant-guided-production`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `agent-workspace`: 新增「结果卡就地领域操作」需求——结果面由引用类型驱动、提供就地操作与真实业务状态，进度锚定、折叠态可见。
- `character-voice-binding`: 新增「会话内选角建议审阅」（自 `cast-review-in-agent-card` 移入，内容一致）。
- `chapter-splitting-workbench`: 新增「会话内候选方案采用」——结果卡承载整套采用/放弃，审阅弹窗仍是细调工作面。
- `chapter-analysis-review`: 新增「会话内候选结果操作」——结果卡承载候选级采用/放弃/重分析，段级修正仍在检查器。

## Impact

- 前端：`delegated-tool-card.tsx`（三段式重构）、`agent-result.tsx`（引用类型驱动分发）、新增各域结果面组件；复用 `CastingSuggestionPanel`、`SplitProposal` 摘要、候选操作注册表（`candidate-operations.ts`）。
- 宿主：预计零改动；分章采用与归属候选采用命令已存在（幂等 + 期望修订校验）。
- 浏览器回归（会话恢复 fixture）扩展三域就地操作用例；中英、亮暗、窄窗口验证。
- 吸收 `cast-review-in-agent-card`（0/12 未实施）后该 change 移除，知识库索引同步。
