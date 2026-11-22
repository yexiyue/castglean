import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  DownloadIcon,
  HeadphonesIcon,
  LocateFixedIcon,
  type LucideIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SquareIcon,
  StepBackIcon,
  StepForwardIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import type { ChapterAudioRunView_Serialize as ChapterAudioRunView } from "@/lib/bindings";
import { chapterAudioActive, hasCompleteAudio } from "@/lib/chapter-audio";
import { formatClock } from "@/lib/chapter-playback";

function AudioIconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size={primary ? "icon" : "icon-sm"}
            variant={primary ? "default" : "ghost"}
            className={primary ? "rounded-full" : undefined}
            aria-label={label}
            disabled={disabled}
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

function GenerationProgress({
  run,
  elsewhere,
  onCancel,
  onViewRun,
}: {
  run: ChapterAudioRunView;
  elsewhere: boolean;
  onCancel: () => void;
  onViewRun: () => void;
}) {
  const { t } = useLingui();
  const cancelling = run.status === "cancelling";
  const counted = run.unitCount > 0 && run.stage === "generating";
  const ratio = counted
    ? Math.min(1, run.completedUnits / run.unitCount)
    : null;
  let label = t`生成中 ${run.completedUnits}/${run.unitCount}`;
  if (cancelling)
    label =
      ratio == null
        ? t`停止中`
        : t`停止中 ${run.completedUnits}/${run.unitCount}`;
  else if (run.stage === "concatenating") label = t`拼接中`;
  else if (run.stage === "loading") label = t`加载模型中`;
  else if (run.stage === "queued") label = t`等待引擎`;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <svg
        role="progressbar"
        aria-label={
          elsewhere ? t`「${run.chapterTitle}」的生成进度` : t`生成进度`
        }
        aria-valuenow={ratio == null ? undefined : Math.round(ratio * 100)}
        aria-valuetext={label}
        viewBox="0 0 24 24"
        className={
          ratio == null
            ? "size-5 shrink-0 fill-none motion-safe:animate-spin"
            : "size-5 shrink-0 -rotate-90 fill-none"
        }
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="9" className="stroke-border" />
        <circle
          cx="12"
          cy="12"
          r="9"
          pathLength="100"
          strokeLinecap="round"
          strokeDasharray={`${ratio == null ? 22 : ratio * 100} 100`}
          className="stroke-muted-foreground"
        />
      </svg>
      <span className="shrink-0 font-medium whitespace-nowrap text-foreground">
        {label}
      </span>
      {elsewhere && (
        <span className="min-w-0 truncate" title={run.chapterTitle}>
          {run.chapterTitle}
        </span>
      )}
      {elsewhere ? (
        <Button variant="ghost" size="xs" onClick={onViewRun}>{t`查看`}</Button>
      ) : (
        !cancelling && (
          <AudioIconButton
            icon={SquareIcon}
            label={t`停止生成`}
            onClick={onCancel}
          />
        )
      )}
    </div>
  );
}

function useGenerationRecovery({
  audio,
  onStart,
  onLocate,
}: {
  audio: ChapterAudio;
  onStart: (restart?: boolean) => void;
  onLocate: (range: { start: number; end: number }) => void;
}) {
  const { t } = useLingui();
  const status = audio.status;
  const run = status?.run;
  const unavailable = audio.restartRequired;
  const pending = audio.starting || audio.preflight !== "ready";
  if (run && !chapterAudioActive(run.status) && run.status !== "succeeded") {
    const failed = run.status === "failed";
    const failedUnit = status.units.find(
      (unit) => unit.index === run.failedIndex,
    );
    const reasons: Record<string, string> = {
      preparing_resources: t`模型资源正在准备`,
      source_unavailable: t`无法读取原文`,
      engine_load_failed: t`模型加载失败`,
      audio_format_changed: t`音频格式不一致`,
      audio_write_failed: t`音频写入失败`,
      concat_failed: t`整章拼接失败`,
      no_speakable_text: t`没有可朗读的内容`,
    };
    let message = t`${run.completedUnits}/${run.unitCount}`;
    if (unavailable) message = t`原文范围、声音或模型已变更`;
    else if (audio.failure === "busy") message = t`引擎正在忙`;
    else if (audio.failure === "failed") message = t`未能开始生成`;
    else if (failed) message = (run.error && reasons[run.error]) || t`生成失败`;

    let action = t`继续生成`;
    if (unavailable) action = t`生成新版本`;
    else if (failed) action = t`重试`;
    return {
      action: (
        <Button
          size="sm"
          data-action="chapter-audio-primary"
          disabled={pending}
          onClick={() => onStart(unavailable)}
        >
          {action}
        </Button>
      ),
      status:
        failed && failedUnit && !unavailable ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onLocate(failedUnit.range)}
            title={message}
          >
            <Trans>第 {failedUnit.index + 1} 段失败</Trans>
          </Button>
        ) : (
          <span className="truncate" title={message}>
            {message}
          </span>
        ),
    };
  }
  if (audio.failure === "busy" || audio.failure === "failed") {
    return {
      status: (
        <span role="alert" className="truncate">
          {audio.failure === "busy" ? t`引擎正在忙` : t`未能开始生成`}
        </span>
      ),
    };
  }
  return {};
}

export function ChapterAudioControls({
  audio,
  chapterId,
  onViewRun,
  nextAction,
  player,
  open,
  narratorSelected,
  analysisReady,
  exportable,
  exportFeedback,
  onOptions,
  onStart,
  onCheck,
  checkOpen,
  onAnalyze,
  analyzeDisabled,
  modeLabel,
  onLocate,
  onExport,
  onReturn,
}: {
  audio: ChapterAudio;
  chapterId: string;
  onViewRun: (run: ChapterAudioRunView) => void;
  nextAction?: React.ReactNode;
  player: ChapterPlayerSession;
  open: boolean;
  narratorSelected: boolean;
  analysisReady: boolean;
  exportable: boolean;
  exportFeedback?: string;
  onOptions: () => void;
  onStart: (restart?: boolean) => void;
  onCheck?: () => void;
  checkOpen?: boolean;
  onAnalyze?: () => void;
  analyzeDisabled?: boolean;
  modeLabel?: string;
  onLocate: (range: { start: number; end: number }) => void;
  onExport: () => void;
  onReturn: () => void;
}) {
  const { t } = useLingui();
  const status = audio.status;
  const active = audio.active;
  const { state } = player;
  const recovery = useGenerationRecovery({ audio, onStart, onLocate });
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
  else if (audio.checking) idleLabel = t`正在检查制作条件`;
  else if (audio.preflight === "failed") idleLabel = t`生成前检查失败`;
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
  else if (needsAnalysis)
    startLabel = onAnalyze ? t`分析本章角色` : t`制作本章音频`;
  else if (audio.mode === "narrator") startLabel = t`生成旁白音频`;
  const needsPreparation = needsNarrator || needsAnalysis;
  const activeHere =
    active?.chapterId === chapterId && active.mode === audio.mode;
  const blockerCount = audio.blockers?.length ?? 0;
  const showCheck = !!onCheck && blockerCount > 0 && !activeHere;
  const checkFailed = !!onCheck && audio.preflight === "failed" && !activeHere;
  const showNewVersion =
    audio.restartRequired && status?.run.status === "succeeded";
  const showStart =
    audio.desktop &&
    !showCheck &&
    !checkFailed &&
    !activeHere &&
    (!status || showNewVersion) &&
    audio.readState === "ready";
  if (showNewVersion) startLabel = t`生成新版本`;
  const missingVoices = audio.blockers?.every(
    ({ kind }) => kind === "missing_binding",
  );
  const checkSummary = missingVoices ? (
    <Plural
      value={blockerCount}
      one="# 个配音对象缺少音色"
      other="# 个配音对象缺少音色"
    />
  ) : (
    <Plural
      value={blockerCount}
      one="# 项生成条件待处理"
      other="# 项生成条件待处理"
    />
  );
  return (
    <section
      aria-label={t`章节播放控制`}
      data-slot="chapter-playback-bar"
      className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_var(--chapter-inspector-width,0px)] items-center px-2 py-1.5"
    >
      <div className="mr-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        {nextAction}
        {active ? (
          <GenerationProgress
            run={active}
            elsewhere={
              active.chapterId !== chapterId || active.mode !== audio.mode
            }
            onCancel={() => void audio.cancel(active.id)}
            onViewRun={() => onViewRun(active)}
          />
        ) : !showCheck && !checkFailed ? (
          recovery.status
        ) : null}
        {!state.active &&
          current &&
          hasCompleteAudio(current) &&
          (audio.restartRequired || current.run.id !== status?.run.id) && (
            <span className="shrink-0">{t`旧版音频`}</span>
          )}
        {elsewhere && state.active && fullTitle && (
          <span className="min-w-0 truncate" title={fullTitle}>
            {playbackTitle}
          </span>
        )}
        <span role="status" className="sr-only">
          {showCheck && checkSummary}
        </span>
        {showCheck && (
          <span
            aria-hidden="true"
            className="flex min-w-0 items-center gap-1.5"
          >
            <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" />
            <span className="truncate">{checkSummary}</span>
          </span>
        )}
        {modeLabel && showStart && !needsPreparation && (
          <span className="truncate" title={modeLabel}>
            {modeLabel}
          </span>
        )}
        {duration > 0 ? (
          <span className="shrink-0 whitespace-nowrap">
            <span className="font-medium text-foreground">
              {formatClock(state.active ? state.time : 0)}
            </span>
            {" / "}
            {formatClock(duration)}
          </span>
        ) : (
          !showCheck &&
          (!showStart || audio.checking) &&
          !status &&
          !active &&
          !audio.failure && (
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
      <div className="col-span-2 ml-2 flex min-w-0 flex-wrap items-center justify-end gap-1">
        {elsewhere && state.active && (
          <AudioIconButton
            icon={LocateFixedIcon}
            label={t`返回播放位置`}
            disabled={!state.unit}
            onClick={onReturn}
          />
        )}
        {audio.desktop &&
          !(
            showStart &&
            !active &&
            (needsNarrator || (needsAnalysis && !onAnalyze))
          ) && (
            <AudioIconButton
              icon={HeadphonesIcon}
              label={t`本章音频设置`}
              onClick={onOptions}
            />
          )}
        {!activeHere && !showCheck && !checkFailed && recovery.action}
        {(showCheck || checkFailed) && (
          <Button
            size="sm"
            variant="outline"
            data-action="chapter-audio-primary"
            aria-haspopup="dialog"
            aria-expanded={checkOpen}
            onClick={onCheck}
          >
            {checkFailed ? (
              t`重新检查生成条件`
            ) : (
              <Plural
                value={blockerCount}
                one="处理 # 项生成问题"
                other="处理 # 项生成问题"
              />
            )}
          </Button>
        )}
        {showStart && (
          <Button
            size="sm"
            data-action="chapter-audio-primary"
            disabled={
              !!audio.active ||
              audio.starting ||
              (needsAnalysis && onAnalyze && analyzeDisabled) ||
              (!needsPreparation && audio.preflight !== "ready")
            }
            onClick={
              needsNarrator
                ? onOptions
                : needsAnalysis
                  ? (onAnalyze ?? onOptions)
                  : () => onStart(showNewVersion)
            }
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
