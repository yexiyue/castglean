# 归档说明

本目录保存 2026-11-02 仓库重启（迁移到 Tauri 2 应用）之前的记录。归档文档描述的代码、命令与数据随旧实现一并退役，完整可运行的历史实现位于 `legacy-main` 分支。

| 内容 | 说明 |
| --- | --- |
| [implementation-roadmap.md](implementation-roadmap.md) | 重启前的实施路线（桌面 P0–P3 与旧 A–F 阶段） |
| [project-plan.md](project-plan.md) | 早期独立库优先企划 |
| [design/](design/) | 旧三 crate 实现的设计与能力文档：模型分析、跨章状态、运行恢复、增量交接、本地/MiniMax 后端等 |
| [reports/](reports/) | 一次性评测与验证报告：归属评测、引文评测、压缩协议、连续章节、阶段基线等 |
| [talechime-prototype/](talechime-prototype/README.md) | TaleChime 联调原型的退役记录与验证 |

注意事项：

- 原 `docs/evaluations/` 下的原始评测数据（运行 JSON 与提示词）已在重启时删除，结论保留在 `reports/`，原始数据可从 `legacy-main` 分支找回。
- 归档文档之间的相对链接可能因移动而失效；失效时按文件名在仓库内检索，或查阅 `legacy-main` 分支的原始位置。
- 归档内容不构成当前实现状态；当前路线见[执行与路线图](../desktop-studio/execution-and-roadmap.md)。
