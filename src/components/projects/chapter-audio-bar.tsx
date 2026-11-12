import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  AudioLines,
  CircleAlert,
  InfoIcon,
  Loader2Icon,
  Pause,
  Play,
} from "lucide-react";
import { Fragment, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import type {
  ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
  ChapterAudioRunView_Serialize as ChapterAudioRunView,
  ChapterAudioStatusView_Serialize as ChapterAudioStatusView,
} from "@/lib/bindings";
import { formatClock } from "@/lib/chapter-playback";

type Range = { start: number; end: number };
type Units = ChapterAudioStatusView["units"];

const ROW = "flex items-center gap-2 border-b px-3 py-2 text-xs";

/**
 * 章节音频状态条：阻塞、真实进度、中断/失败位置与共享播放会话控制。
 * 只呈现宿主事实与播放会话状态；任务由宿主持有，播放与生成互不阻塞。
 */
export function ChapterAudioBar({
  audio,
  chapterId,
  player,
  onLocate,
  onCharacters,
  onChapter,
}: {
  audio: ChapterAudio;
  chapterId: string;
  player: ChapterPlayerSession;
  onLocate: (range: Range) => void;
  onCharacters: () => void;
  onChapter: (chapterId: string) => void;
}) {
  if (!audio.desktop) return null;
  const run = audio.status?.run ?? null;
  const units = audio.status?.units ?? [];
  const running = run && audio.active?.id === run.id ? audio.active : null;
  const elsewhere =
    audio.active && audio.active.chapterId !== chapterId ? audio.active : null;
  return (
    <>
      {audio.failure && <StartFailure audio={audio} />}
      {audio.blockers && (
        <BlockerList
          audio={audio}
          blockers={audio.blockers}
          onLocate={onLocate}
          onCharacters={onCharacters}
        />
      )}
      {elsewhere && <OtherChapterRun run={elsewhere} onChapter={onChapter} />}
      {running && <ActiveRun run={running} cancel={audio.cancel} />}
      {player.state.active && (
        <PlayerRow
          run={run}
          units={units}
          player={player}
          onLocate={onLocate}
        />
      )}
      {!running &&
        run &&
        run.status === "succeeded" &&
        !player.state.active && (
          <IdleChapterPlayer run={run} units={units} player={player} />
        )}
      {!running && run && run.status !== "succeeded" && (
        <EndedRun run={run} units={units} onLocate={onLocate} />
      )}
    </>
  );
}

function StartFailure({ audio }: { audio: ChapterAudio }) {
  const { t } = useLingui();
  return (
    <div role="alert" className={`${ROW} text-destructive`}>
      <CircleAlert className="size-3.5 shrink-0" />
      <span className="flex-1">
        {audio.failure === "busy"
          ? t`引擎正被其他任务占用，请稍后再试。`
          : t`未能开始生成，请重试。`}
      </span>
      <Button variant="ghost" size="sm" onClick={audio.dismiss}>
        <Trans>关闭</Trans>
      </Button>
    </div>
  );
}

function ActiveRun({
  run,
  cancel,
}: {
  run: ChapterAudioRunView;
  cancel: (runId: string) => void;
}) {
  const { t } = useLingui();
  const stages: Record<string, string> = {
    queued: t`等待引擎`,
    loading: t`正在加载模型`,
    generating: t`正在合成`,
    concatenating: t`正在拼接整章`,
  };
  const total = run.unitCount;
  const done = run.completedUnits;
  // 只有开始合成后才有可靠的单元计数；加载阶段不显示比例。
  const counted = run.stage === "generating" || run.stage === "concatenating";
  return (
    <div role="status" className={`${ROW} gap-3`}>
      <Loader2Icon className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
      <span className="shrink-0">{stages[run.stage] ?? run.stage}</span>
      <Progress
        className="min-w-16 flex-1"
        aria-label={t`生成进度`}
        value={counted && total > 0 ? (done / total) * 100 : null}
      />
      {counted && (
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {t`${done} / ${total} 单元`}
        </span>
      )}
      {run.status === "cancelling" ? (
        <span className="text-muted-foreground shrink-0">
          <Trans>正在取消，等待当前单元收尾</Trans>
        </span>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => cancel(run.id)}>
          <Trans>取消</Trans>
        </Button>
      )}
    </div>
  );
}

function OtherChapterRun({
  run,
  onChapter,
}: {
  run: ChapterAudioRunView;
  onChapter: (chapterId: string) => void;
}) {
  const { t } = useLingui();
  return (
    <div role="status" className={ROW}>
      <AudioLines className="text-muted-foreground size-3.5 shrink-0" />
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {t`「${run.chapterTitle}」正在生成音频：${run.completedUnits} / ${run.unitCount} 单元`}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChapter(run.chapterId)}
      >
        <Trans>查看</Trans>
      </Button>
    </div>
  );
}

function EndedRun({
  run,
  units,
  onLocate,
}: {
  run: ChapterAudioRunView;
  units: Units;
  onLocate: (range: Range) => void;
}) {
  const { t } = useLingui();
  const failedUnit =
    run.failedIndex == null ? null : (units[run.failedIndex] ?? null);
  const position = (run.failedIndex ?? 0) + 1;
  const reasons: Record<string, string> = {
    preparing_resources: t`模型资源正在准备，完成后可重新生成`,
    source_unavailable: t`原文暂不可读取，请重新打开工程后再试`,
    engine_load_failed: t`模型加载失败，可在模型中心检查资源`,
    unit_synthesis_failed: t`第 ${position} 个单元合成失败`,
    audio_format_changed: t`第 ${position} 个单元的音频格式与前面不一致`,
    audio_write_failed: t`音频写入失败，请检查磁盘空间`,
    concat_failed: t`整章拼接失败`,
    no_speakable_text: t`本章没有可朗读的内容`,
  };
  const message =
    run.status === "cancelled"
      ? t`已取消生成`
      : run.status === "interrupted"
        ? t`应用退出时生成中断，未自动继续`
        : ((run.error && reasons[run.error]) ?? t`生成未完成`);
  const kept = run.completedUnits > 0;
  return (
    <div role="status" className={ROW}>
      <CircleAlert className="text-muted-foreground size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {message}
        {kept &&
          ` · ${t`已保留 ${run.completedUnits} / ${run.unitCount} 个单元的音频，正文片段旁可试听`}`}
      </span>
      {failedUnit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onLocate(failedUnit.range)}
        >
          <Trans>定位失败位置</Trans>
        </Button>
      )}
    </div>
  );
}

function BlockerList({
  audio,
  blockers,
  onLocate,
  onCharacters,
}: {
  audio: ChapterAudio;
  blockers: ChapterAudioBlocker[];
  onLocate: (range: Range) => void;
  onCharacters: () => void;
}) {
  const { t } = useLingui();
  return (
    <section
      aria-label={t`生成前需要处理的问题`}
      className="border-b px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <CircleAlert className="text-destructive size-3.5 shrink-0" />
        <p className="flex-1 font-medium">
          <Trans>本章还不能生成，先处理以下问题</Trans>
        </p>
        <Button variant="ghost" size="sm" onClick={audio.dismiss}>
          <Trans>关闭</Trans>
        </Button>
      </div>
      <ul className="mt-1 flex flex-col">
        {blockers.map((blocker) => {
          const range = blocker.range;
          const binding =
            blocker.kind === "missing_binding" ||
            blocker.kind === "voice_not_preset" ||
            blocker.kind === "voice_missing" ||
            blocker.kind === "mixed_combos";
          return (
            <li
              key={`${blocker.kind}:${blocker.characterId ?? ""}:${blocker.segmentId ?? ""}`}
              className="flex items-center gap-2 border-t py-1"
            >
              <BlockerText blocker={blocker} />
              {range && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onLocate(range)}
                >
                  <Trans>定位</Trans>
                </Button>
              )}
              {binding && (
                <Button variant="ghost" size="sm" onClick={onCharacters}>
                  <Trans>角色中心</Trans>
                </Button>
              )}
              {blocker.kind === "resource_not_ready" && (
                <Button
                  variant="ghost"
                  size="sm"
                  render={<Link to="/models" />}
                >
                  <Trans>模型中心</Trans>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BlockerText({ blocker }: { blocker: ChapterAudioBlocker }) {
  const { t } = useLingui();
  const who = blocker.characterName ?? blocker.characterId ?? t`旁白`;
  const detail = blocker.detail ?? "";
  const text: Record<ChapterAudioBlocker["kind"], string> = {
    no_analysis: t`本章尚未分析，请先完成归属分析`,
    analysis_invalid: t`当前分析与章节范围不一致，需要重新分析`,
    unknown_attribution: t`${blocker.count} 处归属未知`,
    ambiguous_attribution: t`${blocker.count} 处归属存在歧义`,
    missing_binding: t`${who} 尚未绑定声音`,
    voice_not_preset: t`${who} 绑定的是音色库声音，本阶段仅支持同一模型的预置音色`,
    mixed_combos: t`声音绑定分布在多个模型（${detail}），本阶段仅支持单一模型`,
    voice_missing: t`${who} 的音色不在已就绪的音色目录中（${detail}）`,
    resource_not_ready: t`模型资源未就绪（${detail}）`,
  };
  return (
    <span className="text-muted-foreground min-w-0 flex-1">
      {text[blocker.kind]}
      {blocker.range && ` · ${t`第 ${blocker.line + 1} 行`}`}
    </span>
  );
}

/** 单元声音清单（生成信息弹层）：按出现顺序去重。 */
function unitVoices(units: Units) {
  const used = new Map<string, string>();
  for (const unit of units) {
    if (unit.durationMs == null) continue;
    used.set(unit.characterName ?? unit.characterId ?? "", unit.voice);
  }
  return [...used];
}

function GenerationInfo({
  run,
  units,
  duration,
}: {
  run: ChapterAudioRunView | null;
  units: Units;
  duration: number;
}) {
  const { t } = useLingui();
  const voices = useMemo(() => unitVoices(units), [units]);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t`生成信息`}
                />
              }
            />
          }
        >
          <InfoIcon />
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <Trans>生成信息</Trans>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">
            <Trans>模型</Trans>
          </dt>
          <dd>
            {run?.backend} / {run?.model} · {run?.device.toUpperCase()}
          </dd>
          <dt className="text-muted-foreground">
            <Trans>时长</Trans>
          </dt>
          <dd className="tabular-nums">{formatClock(duration)}</dd>
          <dt className="text-muted-foreground">
            <Trans>合成单元</Trans>
          </dt>
          <dd className="tabular-nums">{run?.unitCount}</dd>
          {voices.map(([label, voice]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label || t`旁白`}</dt>
              <dd>{voice}</dd>
            </Fragment>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** 播放会话进行中的共享控制条：暂停/进度/当前片段定位 + 生成信息。 */
function PlayerRow({
  run,
  units,
  player,
  onLocate,
}: {
  run: ChapterAudioRunView | null;
  units: Units;
  player: ChapterPlayerSession;
  onLocate: (range: Range) => void;
}) {
  const { t } = useLingui();
  const { state, toggle, seek } = player;
  const unit = state.unit;
  return (
    <div className={ROW}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={state.playing ? t`暂停播放` : t`继续播放`}
        disabled={state.failed}
        onClick={toggle}
      >
        {state.playing ? <Pause /> : <Play />}
      </Button>
      <span className="text-muted-foreground shrink-0 tabular-nums">
        {formatClock(state.time)} / {formatClock(state.duration)}
      </span>
      <Slider
        className="min-w-16 flex-1"
        aria-label={t`播放进度`}
        value={[Math.min(state.time, state.duration)]}
        min={0}
        max={Math.max(state.duration, 0.1)}
        step={0.1}
        disabled={state.failed}
        onValueChange={(value) => {
          const target = typeof value === "number" ? value : value[0];
          if (Number.isFinite(target)) seek(target);
        }}
      />
      {state.failed ? (
        <span className="text-destructive shrink-0">
          <Trans>音频无法播放</Trans>
        </span>
      ) : (
        unit && (
          <span className="hidden min-w-0 items-center gap-1 lg:flex">
            <span className="text-muted-foreground truncate">
              {t`第 ${unit.line + 1} 行 · ${
                unit.characterName ?? unit.characterId ?? t`旁白`
              } · ${unit.voice}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onLocate(unit.range)}
            >
              <Trans>定位</Trans>
            </Button>
          </span>
        )
      )}
      <GenerationInfo run={run} units={units} duration={state.duration} />
    </div>
  );
}

/** 无进行中会话且整章已成功的入口行：从整章开头起播。 */
function IdleChapterPlayer({
  run,
  units,
  player,
}: {
  run: ChapterAudioRunView;
  units: Units;
  player: ChapterPlayerSession;
}) {
  const { t } = useLingui();
  const mediaId = run.finalMediaId;
  if (!mediaId) {
    return (
      <div role="status" className={ROW}>
        <CircleAlert className="text-muted-foreground size-3.5 shrink-0" />
        <span className="flex-1">
          <Trans>整章音频文件已不可用，可重新生成</Trans>
        </span>
      </div>
    );
  }
  return (
    <div className={ROW}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t`播放整章音频`}
        onClick={() => player.start(0)}
      >
        <Play />
      </Button>
      <span className="text-muted-foreground shrink-0 tabular-nums">
        {formatClock((run.finalDurationMs ?? 0) / 1000)}
      </span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        <Trans>整章音频已就绪，正文片段旁可从任意位置起播。</Trans>
      </span>
      <GenerationInfo
        run={run}
        units={units}
        duration={(run.finalDurationMs ?? 0) / 1000}
      />
    </div>
  );
}
