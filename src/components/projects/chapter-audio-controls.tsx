import { useLingui } from "@lingui/react/macro";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
  DownloadIcon,
  HeadphonesIcon,
  LocateFixedIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  StepBackIcon,
  StepForwardIcon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import { hasCompleteAudio } from "@/lib/chapter-audio";
import { formatClock } from "@/lib/chapter-playback";

export function AudioIconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
  draggable,
  onDragStart,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
} & Pick<ComponentProps<typeof Button>, "draggable" | "onDragStart">) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant={primary ? "default" : "ghost"}
            className={primary ? "rounded-full" : undefined}
            aria-label={label}
            disabled={disabled}
            draggable={draggable}
            onDragStart={onDragStart}
            onClick={onClick}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ChapterAudioControls({
  audio,
  player,
  open,
  narratorSelected,
  analysisReady,
  exportable,
  exportFeedback,
  onOptions,
  onStart,
  onExport,
  onReturn,
}: {
  audio: ChapterAudio;
  player: ChapterPlayerSession;
  open: boolean;
  narratorSelected: boolean;
  analysisReady: boolean;
  exportable: boolean;
  exportFeedback?: string;
  onOptions: () => void;
  onStart: () => void;
  onExport: () => void;
  onReturn: () => void;
}) {
  const { t } = useLingui();
  const status = audio.status;
  const { state } = player;
  const current = audio.priorComplete ?? status;
  const first = current?.units.find((unit) => unit.mediaId);
  const elsewhere = state.target && state.target.runId !== status?.run.id;
  const target = state.target;
  const fullTitle = target && `${target.projectTitle} · ${target.chapterTitle}`;
  const playbackTitle =
    target?.projectId === audio.projectId ? target.chapterTitle : fullTitle;
  const canControl = state.active || !!first;
  const toggleLabel = open ? t`收起轨道` : t`展开轨道`;
  let idleLabel = t`暂无音频`;
  if (!audio.desktop) idleLabel = t`请在桌面应用中制作音频`;
  else if (audio.readState === "loading") idleLabel = t`正在读取章节音频…`;
  else if (audio.readState === "failed") idleLabel = t`章节音频读取失败`;
  const needsNarrator = audio.mode === "narrator" && !narratorSelected;
  const needsAnalysis = audio.mode === "multi_role" && !analysisReady;
  const duration = state.active
    ? state.duration
    : (current?.run.finalDurationMs ?? 0) / 1000;
  let playbackLabel = t`试听已生成片段`;
  if (state.playing) playbackLabel = t`暂停`;
  else if (state.active) playbackLabel = t`继续播放`;
  else if (current?.run.id !== status?.run.id) playbackLabel = t`播放旧版本`;
  else if (current && hasCompleteAudio(current)) playbackLabel = t`播放整章`;

  let startLabel = t`生成本章音频`;
  if (needsNarrator) startLabel = t`选择旁白音色`;
  else if (needsAnalysis) startLabel = t`制作本章音频`;
  else if (audio.mode === "narrator") startLabel = t`生成旁白音频`;
  const needsSettings = needsNarrator || needsAnalysis;
  return (
    <section
      aria-label={t`章节播放控制`}
      data-slot="chapter-playback-bar"
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 p-2"
    >
      <div className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground tabular-nums">
        {elsewhere && state.active && fullTitle && (
          <span className="min-w-0 truncate" title={fullTitle}>
            {playbackTitle}
          </span>
        )}
        {duration > 0 ? (
          <span className="shrink-0 whitespace-nowrap">
            {formatClock(state.active ? state.time : 0)} /{" "}
            {formatClock(duration)}
          </span>
        ) : (
          !status && (
            <span role={audio.readState === "failed" ? "alert" : "status"}>
              {idleLabel}
            </span>
          )
        )}
      </div>
      {canControl ? (
        <div className="flex shrink-0 items-center gap-1">
          <AudioIconButton
            icon={SkipBackIcon}
            label={t`回到播放起点`}
            disabled={!state.active}
            onClick={() => player.jump("first")}
          />
          <AudioIconButton
            icon={StepBackIcon}
            label={t`上一片段`}
            disabled={!state.active}
            onClick={() => player.jump("previous")}
          />
          <AudioIconButton
            primary
            icon={state.playing ? PauseIcon : PlayIcon}
            label={playbackLabel}
            onClick={() => {
              if (state.active) player.toggle();
              else if (first && current)
                void player.start(first.index, current);
            }}
          />
          <AudioIconButton
            icon={StepForwardIcon}
            label={t`下一片段`}
            disabled={!state.active}
            onClick={() => player.jump("next")}
          />
          <AudioIconButton
            icon={SkipForwardIcon}
            label={t`跳到末段`}
            disabled={!state.active}
            onClick={() => player.jump("last")}
          />
        </div>
      ) : (
        <span />
      )}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
        {elsewhere && state.active && (
          <AudioIconButton
            icon={LocateFixedIcon}
            label={t`返回播放位置`}
            disabled={!state.unit}
            onClick={onReturn}
          />
        )}
        {audio.desktop && (
          <AudioIconButton
            icon={HeadphonesIcon}
            label={t`本章音频设置`}
            onClick={onOptions}
          />
        )}
        {audio.desktop && !status && audio.readState === "ready" && (
          <Button
            size="sm"
            disabled={
              !!audio.active ||
              audio.starting ||
              (!needsSettings && (audio.checking || !!audio.blockers))
            }
            onClick={needsSettings ? onOptions : onStart}
          >
            {startLabel}
          </Button>
        )}
        {audio.desktop && audio.readState === "failed" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void audio.refresh().catch(() => {})}
          >{t`重新读取`}</Button>
        )}
        {status && (
          <>
            <AudioIconButton
              icon={exportFeedback ? CheckIcon : DownloadIcon}
              label={t`导出 WAV`}
              disabled={!exportable}
              onClick={onExport}
            />
            <span role="status" className="sr-only">
              {exportFeedback}
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <CollapsibleTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={toggleLabel}
                      />
                    }
                  />
                }
              >
                {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
              </TooltipTrigger>
              <TooltipContent>{toggleLabel}</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </section>
  );
}
