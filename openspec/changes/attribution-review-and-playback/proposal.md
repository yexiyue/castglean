# Proposal

## Why

章节音频第一阶段落地后暴露两个工作流问题：

1. **归属审阅是全量义务**：分析出的片段全部初始 `unreviewed`，宿主待检查查询把所有未确认片段当"待检查项"——分析完一整章，满屏虚线、目录与章角标全在催确认。而生成音频的闸门其实只看归属 unknown/ambiguous。用户实际被 UI 绑架去做逐段确认。
2. **播放只能在整章成功后**：单元音频逐个落盘并保留（续跑依据），媒体协议也已按 id 服务单元产物，但界面只有整章 `succeeded` 后的播放条；生成中、失败、取消、中断后的已生成单元全都听不到，也没有"点哪段从哪听"的入口。

调研（`docs/research/segment-review-and-playback-patterns.md`）确认目标形态是三个成熟品类的标准惯例组合：TTS 阅读器的 Read-from-Cursor + 跟读高亮、转写产品的段首说话人标签、配音工作室（ElevenLabs）的逐段生成即试听；审阅改异常驱动与机器翻译行业 review-by-exception 同构。

## What Changes

- **待检查口径改异常驱动**：待检查项 = 归属 unknown/ambiguous 且未人工确认的片段；正文虚线、目录列表、章角标同口径。resolved 未确认的片段不再催确认，`review` 字段保留但不再是全量义务。
- **阅读区段首说话人标签**：每个片段第一行常显说话人（角色名/旁白/未知/歧义提示），点击标签或片段正文仍进入检查器修改归属。
- **片段就近播放**：已生成单元的片段首行 hover 出现播放按钮，点击从该单元起**顺序连播已生成单元**；未生成片段不显示按钮。播放中正文高亮当前片段（跟读），底部音频条瘦身为共享控制条（进度/暂停/当前片段定位），不引入播放列表 UI。
- **生成中可听**：生成任务的进度事件驱动前端重读快照，单元完成即获得可播身份；失败/取消/中断保留的单元同样可播（播放为纯文件服务，与引擎合成无冲突）。

## Capabilities

### New Capabilities
- `chapter-playback`: 章节音频的就近播放会话——从任意已生成单元起播、单文件/单元串播两种队列模式、跟读高亮与单音源互斥、生成中渐进可用。

### Modified Capabilities
- `chapter-analysis-review`: 待检查口径从"全部未确认片段"改为"归属未定（unknown/ambiguous）且未人工确认的片段"；正文标注从全量虚线改为仅异常段提示，段首常显说话人标签。
- `chapter-audio`（活动变更 `chapter-audio-generation` 尚未归档，其 delta 由本变更直接修订）："整章连续播放"要求扩展为任意已生成单元可起播、生成中渐进可听。

## Impact

- 宿主 `src-tauri`：`chapter_analysis/query.rs` 待检查与计数 SQL 口径、对应测试；`chapter_audio` 视图与事件不变（单元 `media_id` 已随快照返回）。
- 前端 `src/`：`analysis/annotated-line.tsx` 重构（说话人标签 + 异常态）、新 `hooks/use-chapter-player.ts` 播放会话、`components/projects/chapter-audio-bar.tsx` 播放条瘦身共享播放源、`hooks/use-chapter-audio.ts` 运行中事件触发快照重读、`imported-workspace.tsx` 装配。
- 不改数据格式与持久化（片段 `review` 字段、单元产物、媒体协议均保持）；不做旧界面兼容层。
- 非目标：播放列表/队列管理 UI、选区朗读、LLM 置信分数、倍速/音量控制、跨章连播、m4b 导出（属收听模式后续）。
