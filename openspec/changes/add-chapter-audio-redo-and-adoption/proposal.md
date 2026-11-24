# Proposal

## Why

章节音频只能在冻结输入完全一致时续跑。用户修正一处归属或换一个音色后，原任务不能再续，只能整章从头合成；失败任务在中途修改声音时同样要全部重做。听感满意的部分无法保留，也没有办法回到修正前的版本。[整章生成优先决定](../../../docs/knowledge/decisions/chapter-generation-first.md)把「修正后按安全单元重做、保留旧结果、显式采用」列为紧接补齐的单章闭环，本变更交付这一段。

## What Changes

- 增加「沿用一致单元」的派生任务：以已有任务为沿用来源，按当前计划建立新任务。原文范围、实际声音和执行配置完全一致的单元直接沿用已落盘音频，只合成其余单元。旧任务、其单元音频和停顿编排不删除、不改写。
- 修正后的重做在成功时成为本章当前采用版本；失败或取消时当前采用版本不变，可按既有续跑规则继续。
- 增加「同输入重录」：对当前采用版本中指定的单元重新合成，结果保存为待采用版本，由用户试听后显式采用或放弃。
- 增加版本采用状态（当前采用、待采用、已放弃）及幂等的采用、放弃命令。每章每种制作方式至多一个当前采用版本；与当前归属或声音不一致的版本可以查看和试听，但不能被采用或导出。
- 派生任务继承可以按原文边界精确锚定的停顿；锚点边界已不存在的停顿不转移，并如实报告。
- WAV 导出只允许当前采用且与当前计划一致的完整版本。
- 工作台：计划变化后的下一步由「生成新版本」变为「重做 N 处」，进度只显示实际重做的单元；片段检查器提供「重做此段」；底部播放栏提供版本列表和待采用决定。
- 数据库结构升到 v13，为章节音频任务增加沿用来源、沿用数量、任务种类和采用状态。
- **BREAKING**：`chapter_audio_start` 的入参改为按意图区分的请求（续跑 / 新版本 / 重录），不保留旧的 `restart` 与 `resume_run_id` 参数兼容。

本变更只提供单章内的最小版本采用：当前版本、待采用决定和回到先前版本。版本对比视图、版本清理与磁盘预算、整书音频列表仍属后续工程侧「音频制作」页，不在此实现。沿用粒度是合成单元，不提供字级对齐或任意选区替换。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `chapter-audio`：在活动变更 `chapter-audio-generation` 与 `refine-chapter-audio-workbench` 已定义的生成、续跑契约上，加入沿用一致单元的局部重做、同输入重录和重做范围预检。
- `chapter-audio-editing`：在活动变更 `chapter-audio-workbench` 与 `refine-chapter-audio-workbench` 已定义的停顿和导出契约上，加入版本采用状态、派生时的停顿继承，以及导出对当前采用版本的要求。
- `chapter-production-workspace`：加入重做入口、重录入口、版本列表与待采用决定的工作台行为。

## Impact

- Rust 宿主：`src-tauri/src/chapter_audio/{store,plan,execution,commands,types}.rs` 及其测试，`src-tauri/src/database/{schema,tests}.rs` 与 `entity/chapter_audio_run.rs`；新增数据库迁移和两个幂等命令。
- 前端：`src/hooks/use-chapter-audio.ts`、`src/components/projects/{chapter-audio-controls,chapter-audio-track,segment-inspector,imported-workspace}.tsx`、`src/lib/chapter-audio.ts`，中英文案与 Specta 绑定。
- 数据格式：`docs/data-format.md` 的章节音频任务字段与停顿继承说明。
- `chapter-audio`、`chapter-audio-editing` 的主规格尚未建立。本变更沿用相同能力标识，规格同步顺序为基线变更、`refine-chapter-audio-workbench`、本变更。
- 不改变引擎线程、推理闸门、全局单活动任务和媒体身份协议；不提供版本删除，不自动清理任何音频文件。
