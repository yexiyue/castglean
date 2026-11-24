import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  DownloadIcon,
  HeadphonesIcon,
  HistoryIcon,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import type {
  ChapterAudioRedo,
  ChapterAudioRunView_Serialize as ChapterAudioRunView,
  ChapterAudioStatusView_Serialize as ChapterAudioStatusView,
} from "@/lib/bindings";
import {
  chapterAudioActive,
  derivedProgress,
  hasCompleteAudio,
  versionRole,
} from "@/lib/chapter-audio";
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
  // 派生任务只统计实际处理的单元：沿用的音频在建立时即为已定，不进入进度。
  const derived = derivedProgress(run);
  const counted =
    run.unitCount > 0 &&
    run.stage === "generating" &&
    (derived.total > 0 || run.inheritedUnits === 0);
  const ratio = counted
    ? Math.min(
        (run.inheritedUnits > 0 ? derived.done : run.completedUnits) /
          (run.inheritedUnits > 0 ? derived.total : run.unitCount),
        1,
      )
    : null;
  const redoing = run.inheritedUnits > 0;
  let label = redoing
    ? t`重做中 ${derived.done}/${derived.total}`
    : t`生成中 ${run.completedUnits}/${run.unitCount}`;
  if (cancelling)
    label =
      ratio == null
        ? t`停止中`
        : redoing
          ? t`停止中 ${derived.done}/${derived.total}`
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

/** 重做范围的文案：有可沿用的音频时显示重做数量，否则是完整生成。 */
function RedoLabel({ redo }: { redo: ChapterAudioRedo | null }) {
  const { t } = useLingui();
  if (!redo || redo.inheritableUnits === 0) return t`生成新版本`;
  if (redo.redoUnits === 0) return t`生成新版本`;
  return <Plural value={redo.redoUnits} one="重做 # 段" other="重做 # 段" />;
}

function DecisionFailure({ failure }: { failure: "failed" | "conflict" }) {
  return (
    <span role="alert" className="text-destructive">
      {failure === "conflict" ? (
        <Trans>此版本与当前归属或声音不一致，无法采用</Trans>
      ) : (
        <Trans>未能完成，请重试</Trans>
      )}
    </span>
  );
}

/** 重录完成后的就地决定：试听、采用、放弃。不弹窗，不自动采用。 */
function PendingDecision({
  audio,
  pending,
  player,
}: {
  audio: ChapterAudio;
  pending: ChapterAudioStatusView;
  player: ChapterPlayerSession;
}) {
  const retaken = pending.units.find(
    (unit) => unit.index === pending.run.redoIndexes[0] && unit.mediaId,
  );
  const original = audio.priorComplete;
  const originalUnit =
    retaken &&
    original?.units.find(
      (unit) =>
        unit.mediaId &&
        unit.range.start === retaken.range.start &&
        unit.range.end === retaken.range.end,
    );
  return (
    <div
      data-slot="chapter-audio-pending"
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      <span role="status" className="truncate">
        <Plural
          value={pending.run.redoIndexes.length}
          one="已重录 # 段，等待决定"
          other="已重录 # 段，等待决定"
        />
      </span>
      {original && originalUnit && (
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void player.start(originalUnit.index, original, { clipOnly: true })
          }
        >
          <Trans>试听当前片段</Trans>
        </Button>
      )}
      <Button
        size="xs"
        variant="ghost"
        disabled={!retaken}
        onClick={() => {
          if (retaken)
            void player.start(retaken.index, pending, { clipOnly: true });
        }}
      >
        <Trans>试听重录片段</Trans>
      </Button>
      <Button
        size="xs"
        data-action="chapter-audio-adopt"
        disabled={audio.deciding}
        onClick={() => void audio.decide(pending.run.id, "adopt")}
      >
        <Trans>采用</Trans>
      </Button>
      <Button
        size="xs"
        variant="ghost"
        data-action="chapter-audio-reject"
        disabled={audio.deciding}
        onClick={() => {
          // 放弃正在试听的重录版本时停止播放，不让已丢弃的音频继续播放。
          if (player.state.target?.runId === pending.run.id) player.stop();
          void audio.decide(pending.run.id, "reject");
        }}
      >
        <Trans>放弃</Trans>
      </Button>
      {audio.viewing && (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => audio.viewVersion(null)}
        >
          <Trans>返回章节状态</Trans>
        </Button>
      )}
      {audio.decision && <DecisionFailure failure={audio.decision} />}
    </div>
  );
}

/** 查看历史版本：标明可否采用，并提供返回当前版本。 */
function HistoryView({
  audio,
  status,
  onAdopt,
}: {
  audio: ChapterAudio;
  status: ChapterAudioStatusView;
  onAdopt: () => void;
}) {
  const adoptable =
    status.run.status === "succeeded" &&
    !status.arrangement.stale &&
    status.run.adoption !== "adopted";
  return (
    <div
      role="status"
      data-slot="chapter-audio-history"
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      <span className="truncate">
        {status.run.adoption === "adopted" ? (
          <Trans>正在查看当前版本</Trans>
        ) : (
          <Trans>正在查看历史版本</Trans>
        )}
      </span>
      {status.run.adoption !== "adopted" &&
        (adoptable ? (
          <Button
            size="xs"
            data-action="chapter-audio-adopt"
            disabled={audio.deciding}
            onClick={onAdopt}
          >
            <Trans>采用此版本</Trans>
          </Button>
        ) : (
          status.run.status === "succeeded" && (
            <span className="truncate">
              <Trans>与当前归属或声音不一致，不可采用</Trans>
            </span>
          )
        ))}
      {audio.decision && <DecisionFailure failure={audio.decision} />}
      <Button size="xs" variant="ghost" onClick={() => audio.viewVersion(null)}>
        {status.run.adoption === "adopted" ? (
          <Trans>返回章节状态</Trans>
        ) : (
          <Trans>返回当前版本</Trans>
        )}
      </Button>
    </div>
  );
}

function versionTime(createdAt: string, locale: string): string | null {
  const seconds = Number(createdAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(seconds * 1000));
}

function VersionDescription({ run }: { run: ChapterAudioRunView }) {
  const { t } = useLingui();
  switch (versionRole(run)) {
    case "current":
      return <Trans>当前版本</Trans>;
    case "pending":
      return <Trans>待采用</Trans>;
    default:
      if (run.kind === "retake")
        return (
          <Plural
            value={run.redoIndexes.length}
            one="重录 # 段"
            other="重录 # 段"
          />
        );
      if (run.kind === "redo")
        return t`沿用 ${run.inheritedUnits} 段，重做 ${run.redoIndexes.length} 段`;
      return (
        <Trans comment="Version menu label for the initial full-chapter synthesis.">
          整章生成
        </Trans>
      );
  }
}

/** 版本列表：最近在前，标明当前采用与待采用；选择即查看该版本。 */
function VersionMenu({ audio }: { audio: ChapterAudio }) {
  const { i18n, t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t`版本`}
            data-slot="chapter-audio-versions"
          />
        }
      >
        <HistoryIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="data-[slot=dropdown-menu-content]:min-w-48">
        {audio.versions?.map((run) => {
          const time = versionTime(run.createdAt, i18n.locale);
          return (
            <DropdownMenuItem
              key={run.id}
              closeOnClick
              aria-current={versionRole(run) === "current" ? "true" : undefined}
              onClick={() => audio.viewVersion(run.id)}
            >
              <VersionDescription run={run} />
              {time && (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {time}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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

    let action: React.ReactNode = t`继续生成`;
    if (unavailable) action = <RedoLabel redo={audio.redo} />;
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
  const pending = audio.pending;
  const viewing = audio.viewing;
  // 查看历史版本时，播放控件针对所查看的版本；否则针对当前采用版本。
  const current = viewing
    ? status
    : (audio.priorComplete ?? (pending ? null : status));
  const recovery = useGenerationRecovery({ audio, onStart, onLocate });
  const first = current?.units.find((unit) => unit.mediaId);
  const elsewhere = state.target && state.target.runId !== status?.run.id;
  const target = state.target;
  const fullTitle = target && `${target.projectTitle} · ${target.chapterTitle}`;
  const playbackTitle =
    target?.projectId === audio.projectId ? target.chapterTitle : fullTitle;
  const controlsActive =
    state.active && (!viewing || target?.runId === current?.run.id);
  const controlsPlaying = controlsActive && state.playing;
  const canControl = controlsActive || !!first;
  const toggleLabel = open ? t`收起轨道` : t`展开轨道`;
  let idleLabel = t`暂无音频`;
  if (!audio.desktop) idleLabel = t`请在桌面应用中制作音频`;
  else if (audio.readState === "loading") idleLabel = t`正在读取章节音频…`;
  else if (audio.checking) idleLabel = t`正在检查制作条件`;
  else if (audio.preflight === "failed") idleLabel = t`生成前检查失败`;
  else if (audio.readState === "failed") idleLabel = t`章节音频读取失败`;
  const needsNarrator = audio.mode === "narrator" && !narratorSelected;
  const needsAnalysis = audio.mode === "multi_role" && !analysisReady;
  const duration = controlsActive
    ? state.duration
    : (current?.run.finalDurationMs ?? 0) / 1000;
  let playbackLabel = t`试听已生成片段`;
  if (controlsPlaying) playbackLabel = t`暂停`;
  else if (controlsActive) playbackLabel = t`继续播放`;
  else if (viewing) playbackLabel = t`播放此版本`;
  else if (pending && current) playbackLabel = t`播放当前版本`;
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
    !viewing &&
    !pending &&
    audio.restartRequired &&
    status?.run.status === "succeeded";
  const showStart =
    audio.desktop &&
    !showCheck &&
    !checkFailed &&
    !activeHere &&
    !viewing &&
    !pending &&
    (!status || showNewVersion) &&
    audio.readState === "ready";
  if (showNewVersion) startLabel = "";
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
  // 只有「已完成但未被采用」的版本才提示先采用；生成中或未完成的版本不谈采用。
  const awaitingAdoption =
    !!status &&
    status.run.status === "succeeded" &&
    status.run.adoption !== "adopted" &&
    (!pending || viewing);
  const exportLabel = awaitingAdoption ? t`采用后可导出 WAV` : t`导出 WAV`;
  const showVersions =
    audio.desktop &&
    !!status &&
    ((audio.versions?.length ?? 0) > 1 || viewing || !!pending);
  const droppedPauses = viewing ? 0 : (status?.run.droppedPauses ?? 0);
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
        ) : !showCheck && !checkFailed && !viewing && !pending ? (
          recovery.status
        ) : null}
        {pending && !activeHere && (
          <PendingDecision audio={audio} pending={pending} player={player} />
        )}
        {viewing && status && !pending && (
          <HistoryView
            audio={audio}
            status={status}
            onAdopt={() => void audio.decide(status.run.id, "adopt")}
          />
        )}
        {droppedPauses > 0 && (
          <span className="shrink-0">
            <Plural
              value={droppedPauses}
              one="# 处停顿因边界变化未沿用"
              other="# 处停顿因边界变化未沿用"
            />
          </span>
        )}
        {!state.active &&
          current &&
          hasCompleteAudio(current) &&
          (audio.restartRequired || current.run.id !== status?.run.id) && (
            <span className="shrink-0">
              {pending ? t`当前版本` : t`旧版音频`}
            </span>
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
              {formatClock(controlsActive ? state.time : 0)}
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
            disabled={!controlsActive}
            onClick={() => player.jump("first")}
          />
          <AudioIconButton
            icon={StepBackIcon}
            label={t`上一片段`}
            disabled={!controlsActive}
            onClick={() => player.jump("previous")}
          />
          <AudioIconButton
            primary
            icon={controlsPlaying ? PauseIcon : PlayIcon}
            label={playbackLabel}
            onClick={() => {
              if (controlsActive) player.toggle();
              else if (first && current)
                void player.start(first.index, current);
            }}
          />
          <AudioIconButton
            icon={StepForwardIcon}
            label={t`下一片段`}
            disabled={!controlsActive}
            onClick={() => player.jump("next")}
          />
          <AudioIconButton
            icon={SkipForwardIcon}
            label={t`跳到末段`}
            disabled={!controlsActive}
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
        {!activeHere &&
          !showCheck &&
          !checkFailed &&
          !viewing &&
          !pending &&
          recovery.action}
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
            {showNewVersion ? <RedoLabel redo={audio.redo} /> : startLabel}
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
            {showVersions && <VersionMenu audio={audio} />}
            <AudioIconButton
              icon={exportFeedback ? CheckIcon : DownloadIcon}
              label={exportLabel}
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
