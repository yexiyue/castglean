# Tasks

状态（2026-11-11）：宿主口径、播放会话、正文标注与控制条重构、生成中刷新、i18n 均已实现；自动化门禁全绿。**真实窗口验收（4.3）与文档收尾未做**。

## 1. 宿主：审阅口径异常驱动

- [x] 1.1 `chapter_analysis/query.rs`：issues 查询与目录聚合同步收窄为 `review='unreviewed' AND attribution.state IN ('unknown','ambiguous')`，字段更名 `unreviewed_count → pending_count`（语义已变，不做兼容）；`Attribution::is_pending` 谓词入 types.rs。测试更新：纯旁白章零待检查（issues 与目录聚合双断言）、大分页夹具改 Speech/Unknown、角色确认≠片段确认改为直接断言 review 状态；`chapter_analysis` 62 项通过
- [x] 1.2 前端消费方核对：目录待检查总数改读 `pendingCount`；正文待处理提示条件改 `segmentPending`（lib 纯函数，node 测试覆盖）；"没有问题不代表所有归属已确认"文案语义仍准确，保留

## 2. 前端：播放会话

- [x] 2.1 `src/lib/chapter-playback.ts` 扩展纯函数：`timelineTotal`/`timelineAt`（播完返回 null）/`firstPlayableFrom`（未生成起点顺延）/`playableStart`；`chapter-audio.test.mjs` 新增 3 组测试（8/8 通过）
- [x] 2.2 新增 `src/hooks/use-chapter-player.ts` 播放会话：file（整章单文件按单元偏移定位）/units（顺序串播、ended 推进、起播时冻结已生成队列并从所选单元计时）双载体；跟读单元、单音源互斥（claim）、换章/产物失效终止会话；`aheadRun` 防快照竞态回退进度
- [x] 2.3 `use-chapter-audio.ts`：进行中事件在 patch run 视图外重读全量快照，单元 `mediaId` 到达即可播

## 3. 前端：正文与控制条

- [x] 3.1 `AnnotatedLine` 重构：段首说话人标注（角色名/旁白/未知/歧义警示态，显式排除标注子树，不入正文复制与坐标计算）、待处理虚线仅限 `segmentPending`、标注与正文点击均进检查器
- [x] 3.2 段旁 hover 播放按钮（可播片段首行，group-hover 显示；再次点击暂停/继续）；跟读高亮 `bg-primary/10` 与选中态并存
- [x] 3.3 `ChapterPlayer` 拆为 `PlayerRow`（会话控制条：暂停/进度/当前片段定位/生成信息）与 `IdleChapterPlayer`（成功后入口行）；`EndedRun` 失败信息与播放控制并存显示；移除组件内自建 audio 元素
- [x] 3.4 `imported-workspace.tsx` 装配：`useChapterPlayer` + `segmentPlayback` 投影（可播集合/首单元索引/toggle）下发正文与状态条；**小窗口/键盘可达性的真实窗口检查未做**（并入 4.3）

## 4. 验收与文档

- [x] 4.1 i18n：新增 8 条中英文案（en 0 missing）
- [x] 4.2 门禁：cargo fmt/clippy/test、rustdoc、tsc、Biome（0 警告）、node 测试、构建、`openspec validate`（本变更与被修订的 `chapter-audio-generation`）全绿；bindings 经 specta 测试再生成（`pendingCount`）
- [ ] 4.3 真实窗口验收：分析一章 → 无异常不催确认；生成中点段起播与跟读；失败后验货保留单元；试听与章节播放互斥；小窗口与亮暗主题。**未执行**
- [x] 4.4 同步 README 状态、知识库索引与调研文档实施状态；记忆更新（旧讨论记忆已并入实现记忆）

2026-11-12 双轴复审：修复串播跨文件定位后的播放状态、末端定位、起点与冻结队列；补充真实浏览器 hook/媒体事件回归。原生窗口与人工听感仍按 4.3 待验，不以媒体夹具替代。
