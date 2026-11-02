# 文档导航

更新：2026-10-31。CastGlean 的产品是桌面有声书工作台，核心拆成独立包供辅助 CLI 和其他开发者复用。由实际制作流程驱动 CastGlean 分析包与 TaleChime 语音库补齐能力。

## 从这里开始

| 入口 | 用途 |
| --- | --- |
| [桌面工作台企划](desktop-studio/README.md) | 当前产品定位、范围、交互、调研与阶段验收 |
| [桌面技术选型](desktop-studio/technology-choice.md) | 已确定 Tauri 2，前后端边界、流畅性与音频组件验收 |
| [当前实施路线](implementation-roadmap.md) | 应用优先的实施顺序与库能力边界 |
| [工程说明](engineering.md) | 当前目录、依赖、运行时、模块约定与检查命令 |
| [数据格式](data-format.md) | 已有正文、身份、标注和校验契约 |
| [原独立库企划](project-plan.md) | 早期设计背景；其中交付顺序已由当前路线替代 |

## 已实现的基础能力

- [模型分析](model-analysis.md)、[MiniMax](minimax-model.md)、[本地模型](local-model.md)。
- [跨章状态与人工修正](cross-chapter.md)、[章节级恢复](run-recovery.md)。
- [整章消费](chapter-consumption.md)、[增量交接](incremental-delivery.md)。
- [标注政策](annotation-policy.md)、[归属评测](attribution-evaluation.md)、[连续章节验证](continuous-novel-verification.md)。

这些能力可由桌面宿主复用；已有库级恢复或交接不表示桌面工程和音频候选恢复已经实现。

## 研究参考

[相关先例调研](related-work.md)与[小模型训练规划](training-plan.md)保留独立研究内容；本地模型、训练或蒸馏不作为当前桌面闭环与线上朗读规划的前置。

## 历史记录

[TaleChime 联调原型退役记录](history/talechime-prototype/README.md)说明原型的移出范围、可复用结论和历史验收限制。其他评测文档保留当时的环境、结论与下一步描述，当前开发顺序以实施路线为准。
