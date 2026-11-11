# Proposal

## Why

章节归属分析与角色声音绑定主链已交付（`chapter-attribution-analysis`、`bind-character-voices`），但生成的分析与绑定只能通过 ≤500 字短试听逐段验证，无法产出可以连续收听的一章音频。用户已确定整章生成优先（见[决定](../../../docs/knowledge/decisions/chapter-generation-first.md)）：复用已有分析与绑定，先打通"生成本章 → 真实进度 → 连续播放"的确定性链路，不先重构助手或全站界面。

## What Changes

- 新增章节音频域（宿主 `chapter_audio` 模块）：以当前采用的分析版本和不可变来源为输入，把整章标注切分为带原文字节范围的合成单元，顺序调用现有 TaleChime 引擎线程合成，逐单元落盘并持久化任务与产物映射。
- 生成前检查集中在宿主：未知归属、歧义、缺失/解绑声音、库音色与多后端绑定（第一阶段不兼容）、音色不在就绪目录、资源未就绪、章节无分析等列为明确阻塞，带行号与目标定位信息；不静默回退旁白、不跳过正文、不自动重新分析。
- 第一阶段仅支持单一就绪的预置音色模型组合（优先 Kokoro 中文）：所有目标（旁白与角色）必须绑定到同一 `(backend, model)` 的预置音色且该组合资源就绪。
- 章节工作台增加直接"生成本章"入口与任务状态展示：真实阶段、已完成/总单元、取消；失败说明单元位置并保留已完成音频；任务与产物持久化，重启将运行中的任务标记为中断且不自动重新生成。
- 全部必要单元成功后拼接整章 WAV，通过受控媒体协议按章连续播放；可查看实际模型、声音、单元时长与来源信息；与现有声音播放器互斥，不同时播放多个音源。

## Capabilities

### New Capabilities

- `chapter-audio`：合成单元构建、生成前检查、顺序生成任务、持久化与恢复、整章连续播放。

### Modified Capabilities

- 无。助手工具卡、单章重做/采用/导出、整书批量、多后端混用与读音演绎保留为后续独立变更（见[路线](../../../docs/desktop-studio/execution-and-roadmap.md)），本变更不为它们增加抽象。

## Impact

- 宿主：新增 `src-tauri/src/chapter_audio/`（计划构建、执行、存储、媒体协议、命令）、`database/entity/chapter_audio_{run,unit}.rs` 与 schema v5 迁移；`engine/resources.rs` 与 `voices/studio/commands.rs` 增加与章节生成的互斥检查；复用引擎专用线程、`Engine::load/synthesize`、watch 取消与 Tauri 事件模式。
- 前端：`imported-workspace.tsx` 增加"生成本章"入口与状态条，新增 `use-chapter-audio.ts` 与章节音频面板组件、`chapter-audio` 媒体协议播放；复用现有播放互斥与主题组件。
- 数据格式：`docs/data-format.md` 增加 `chapter_audio_runs` / `chapter_audio_units` 表与应用数据目录下 `chapter-audio/` 产物布局说明。
- 验收：单元切分与阻塞检查的自动化测试、持久化/中断恢复测试、类型检查与构建；真实原生窗口用隔离工程与公开样章完成"生成 → 进度 → 连续播放"验收（自动化测试不替代真实合成验收）。
