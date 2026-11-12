# Design: attribution-review-and-playback

调研依据见 `docs/research/segment-review-and-playback-patterns.md`（形态选择的主流背书）。
本文件记录实现决策与架构约束。

## D1 审阅口径：异常驱动，数据模型不动

- 待检查 = `review = 'unreviewed'` **且** 归属 `state ∈ {unknown, ambiguous}`。
  宿主两处 SQL 同步收窄：`chapter_analysis/query.rs` 的 issues 查询与
  `unreviewed_count` 聚合。前端正文提示条件与之一致。
- `review` 字段、人工确认命令、候选冲突审阅（CandidateReview）全部保留——
  确认仍是可用动作，只是不再是全量义务。检查器内仍如实显示"未确认"。
- 生成闸门（`chapter_audio/plan.rs` blockers）已只看归属状态，不动。
- 不引入置信分数：三态归属即置信分层（调研结论，LLM 自报分数不可靠）。

## D2 正文段首说话人标注

- `AnnotatedLine` 为段的**首行**（段起点落在该行）渲染说话人标注：
  resolved → 角色名（narrator → "旁白"）；unknown/ambiguous 且未人工确认 →
  警示态（"未知"/"歧义"）。后续行不重复。
- 标注与播放按钮均为装饰层，不进入正文选择与复制（沿用现有
  "Decorations never contribute characters" 约定，标注置于文本流之外）。
- 点击段正文或标注仍打开检查器（审阅主任务不变）。

## D3 播放会话：独立 hook，两种队列载体

新增 `useChapterPlayer` 播放会话，职责单一：把"从单元 i 起播"变成可持续
控制的播放状态；不持有宿主状态投影（那是 `useChapterAudio` 的职责），
只消费它的快照（units + mediaIds）。

- **载体模式**（对用户无感）：整章 `finalMediaId` 存在 → 单文件播放，
  起点seek 到该单元的时间偏移（按已完成单元 `duration_ms` 累加，复用
  `unitTimeline`）；否则 → 单元文件顺序串播（`onended` 推进，跳过无音频
  的空白单元），从所选单元重新计时，起播时冻结已生成队列，播到其末尾停止。
  后续生成只更新可发起播放的入口，不向当前会话追加单元。
- **跟读高亮**：播放时间 → 当前单元 → 所属 segment，正文高亮该段；控制
  条同步显示说话人与行号。第一版不自动滚动（避免劫持阅读位置），控制条
  保留"定位"按钮主动跳转。
- **单音源互斥**：复用 `chapter-playback.ts` 的 claim 机制，与音色试听、
  整章播放互斥收敛到同一会话。
- 队列推进、时间↔单元映射、载体选择全部为纯函数，抽到
  `src/lib/chapter-playback.ts` 扩展，node 可测（沿用 `tests/` 惯例）。

## D4 生成中渐进可听

`useChapterAudio` 事件处理扩展：run 进行中的事件在 patch run 视图之外，
再触发一次全量快照 `refresh()`（生成是逐单元分钟级节奏，天然节流；不做
定时轮询）。单元 `media_id` 本就随快照返回且仅在文件存在时非空，前端
拿到即可播——宿主无改动。

## D5 控制条瘦身与装配

- `ChapterPlayer` 重构为播放会话的纯视图：暂停/继续、进度、当前片段
  说话人与定位；生成信息 Popover 保留。不再自建 audio 元素。
- 生成中：`ActiveRun` 行与播放控制同条并存、互不伪装；取消生成不中断
  正在进行的播放（播放只依赖已落盘文件）。
- 装配：`imported-workspace.tsx` 创建播放会话，经 props 下发
  `ChapterAudioBar`（控制条）与 `AnnotatedLine`（段旁播放按钮 + 跟读）。
- 不做播放列表/队列 UI（调研与用户拍板：空间有限，冗余）。

## D6 架构原则落点

- **单一职责**：宿主状态投影（`useChapterAudio`）、播放会话
  （`useChapterPlayer`）、正文标注渲染（`AnnotatedLine`）分离。
- **依赖倒置**：播放会话只依赖单元快照数据结构与媒体 id，不 import
  宿主命令；标注组件只依赖传入的播放状态回调，不感知播放实现。
- **开闭**：队列载体（单文件/串播）在会话内部选择，未来新增载体
  （如流式）不动视图层。
- **封装**：播放状态机（idle/playing/paused、当前单元推进、音源切换）
  内聚于 hook，视图只读状态与发意图。

## D7 兼容与重构边界

- 不做旧界面兼容层；`ChapterPlayer` 旧实现直接替换。
- 片段 `review` 字段与既有持久化不变；仅"待检查"统计口径变化，
  无数据迁移。
- 单元与片段是一对多（长片段切分）：段旁按钮从该段**首个单元**起播；
  跟读高亮按单元映射回所属片段。纯空白片段无单元音频，不提供入口。
