# Proposal

## Why

当前章节生成虽有计数和片段播放能力，但主要以顶部状态条呈现，用户难以直观看到全章生成位置、已完成音频和失败缺口。分析后的行内角色标签打断阅读，需要按归属片段组织正文，并将其与底部音频制作轨道关联。

## What Changes

- 未分析时保持紧凑阅读；有效分析发布后按归属片段分块，固定左侧角色列，正文不再插入角色标签。
- 增加底部可收放、可调整高度的音频轨道：全章占位、逐单元状态、已完成播放、失败定位、取消与明确续跑。
- 建立正文片段、合成单元与播放位置的双向关联；生成跟随和播放跟随分别控制，用户浏览时不强抢滚动。
- 在安全单元边界插入、拖动调整、精确输入、删除和撤销额外停顿；宿主持久化独立编排，不修改来源或重复合成。
- 已知完整时长后提供真实时间比例；未生成部分按顺序占位，不伪造总时长或波形。
- 提供冻结编排的完整 WAV 导出；缺口、失效和导出失败不报告成功。

## Capabilities

### New Capabilities

- `chapter-audio-editing`: 章节音频轨道、单元状态、片段播放联动、停顿编排与一致的 WAV 导出。

### Modified Capabilities

- `chapter-analysis-review`: 有效分析后的角色列与归属片段展示，检查器随选中对象变化。
- `continuous-source-reading`: 分析前后两种显示投影的有界读取、精确选择与稳定定位。

## Impact

涉及 `src/components/projects/imported-workspace.tsx`、`chapter-audio-bar.tsx`、`src/components/analysis/`、正文虚拟阅读组件、`use-chapter-audio` / `use-chapter-player` 及宿主 `chapter_audio`、数据库迁移、typed IPC 和媒体/导出用例。新增持久编排与修订，不迁移或删除用户来源和历史音频。

本变更接续 `chapter-audio-generation` 和 `attribution-review-and-playback` 的当前实现：取代后者的行内段首标注与“无队列展示”限制，但保留异常驱动审阅、声音互斥和人工保护。相关活动规格在实施时协调，不能以本提案勾选旧变更未验收任务。

不包含云 TTS 接入、自由重排原文、片内裁剪/拉伸、多轨配乐、情绪标签或任意位置切分；修正音色后局部重合成与候选采用保留为后续独立工作。本轮仅规划，不宣称交互已经交付。
