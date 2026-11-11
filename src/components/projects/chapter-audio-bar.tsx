import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AudioLines,
  CircleAlert,
  InfoIcon,
  Loader2Icon,
  Pause,
  Play,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
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
import { useVoicePlayer } from "@/components/voices/voice-player";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type {
  ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
  ChapterAudioRunView_Serialize as ChapterAudioRunView,
  ChapterAudioStatusView_Serialize as ChapterAudioStatusView,
} from "@/lib/bindings";
import {
  claimChapterPlayback,
  formatClock,
  releaseChapterPlayback,
  unitTimeline,
} from "@/lib/chapter-playback";

type Range = { start: number; end: number };
type Units = ChapterAudioStatusView["units"];

const ROW = "flex items-center gap-2 border-b px-3 py-2 text-xs";

/**
 * 章节音频状态条：阻塞、真实进度、中断/失败位置与整章播放。
 * 只呈现宿主事实；任务由宿主持有，切章后在原章节仍可见。
 */
export function ChapterAudioBar({
  audio,
  chapterId,
  onLocate,
  onCharacters,
  onChapter,
}: {
  audio: ChapterAudio;
  chapterId: string;
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
      {run && !running && run.status === "succeeded" && (
        <ChapterPlayer run={run} units={units} onLocate={onLocate} />
      )}
      {run && !running && run.status !== "succeeded" && (
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
  const kept = run.completedUnits > 0 && run.completedUnits < run.unitCount;
  return (
    <div role="status" className={ROW}>
      <CircleAlert className="text-muted-foreground size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {message}
        {kept &&
          ` · ${t`已保留 ${run.completedUnits} / ${run.unitCount} 个单元的音频`}`}
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

function ChapterPlayer({
  run,
  units,
  onLocate,
}: {
  run: ChapterAudioRunView;
  units: Units;
  onLocate: (range: Range) => void;
}) {
  const { t } = useLingui();
  const voicePlayer = useVoicePlayer();
  const mediaId = run.finalMediaId;
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState((run.finalDurationMs ?? 0) / 1000);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!mediaId) return;
    const element = new Audio(convertFileSrc(mediaId, "chapter-audio"));
    element.preload = "metadata";
    const onTime = () => setTime(element.currentTime);
    const onDuration = () => {
      if (Number.isFinite(element.duration)) setDuration(element.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => setFailed(true);
    const listeners = [
      ["timeupdate", onTime],
      ["durationchange", onDuration],
      ["play", onPlay],
      ["pause", onPause],
      ["ended", onPause],
      ["error", onError],
    ] as const;
    for (const [name, listener] of listeners)
      element.addEventListener(name, listener);
    setAudio(element);
    setFailed(false);
    setTime(0);
    return () => {
      for (const [name, listener] of listeners)
        element.removeEventListener(name, listener);
      element.pause();
      releaseChapterPlayback(element);
      element.removeAttribute("src");
      element.load();
      setAudio(null);
      setPlaying(false);
    };
  }, [mediaId]);

  const timeline = useMemo(() => unitTimeline(units), [units]);
  const current =
    timeline.find((entry) => time < entry.end) ?? timeline[timeline.length - 1];
  const voices = useMemo(() => {
    const used = new Map<string, string>();
    for (const { unit } of timeline)
      used.set(unit.characterName ?? unit.characterId ?? "", unit.voice);
    return [...used];
  }, [timeline]);

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
  const toggle = async () => {
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // 同一时间至多一个音源：先停止音色试听，再登记整章播放。
    await voicePlayer.stop().catch(() => {});
    claimChapterPlayback(audio);
    await audio.play().catch(() => setFailed(true));
  };
  const seek = (value: number | readonly number[]) => {
    const next = typeof value === "number" ? value : value[0];
    if (audio && Number.isFinite(next)) {
      audio.currentTime = next;
      setTime(next);
    }
  };
  return (
    <div className={ROW}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={playing ? t`暂停整章播放` : t`播放整章音频`}
        disabled={!audio || failed}
        onClick={() => void toggle()}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <span className="text-muted-foreground shrink-0 tabular-nums">
        {formatClock(time)} / {formatClock(duration)}
      </span>
      <Slider
        className="min-w-16 flex-1"
        aria-label={t`整章播放进度`}
        value={[Math.min(time, duration)]}
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.1}
        disabled={!audio || failed}
        onValueChange={seek}
      />
      {failed ? (
        <span className="text-destructive shrink-0">
          <Trans>音频无法播放</Trans>
        </span>
      ) : (
        current && (
          <span className="hidden min-w-0 items-center gap-1 lg:flex">
            <span className="text-muted-foreground truncate">
              {t`第 ${current.unit.line + 1} 行 · ${
                current.unit.characterName ??
                current.unit.characterId ??
                t`旁白`
              } · ${current.unit.voice}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onLocate(current.unit.range)}
            >
              <Trans>定位</Trans>
            </Button>
          </span>
        )
      )}
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
              {run.backend} / {run.model} · {run.device.toUpperCase()}
            </dd>
            <dt className="text-muted-foreground">
              <Trans>时长</Trans>
            </dt>
            <dd className="tabular-nums">{formatClock(duration)}</dd>
            <dt className="text-muted-foreground">
              <Trans>合成单元</Trans>
            </dt>
            <dd className="tabular-nums">{run.unitCount}</dd>
            {voices.map(([label, voice]) => (
              <Fragment key={label}>
                <dt className="text-muted-foreground">{label || t`旁白`}</dt>
                <dd>{voice}</dd>
              </Fragment>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </div>
  );
}
