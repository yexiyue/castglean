import { ph } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { CircleAlertIcon, ClockIcon, LoaderCircleIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import {
  type ChapterAudioRunView_Serialize as ChapterAudioRunView,
  type ChapterPauseEdit,
  commands,
} from "@/lib/bindings";
import {
  chapterTrackMarks,
  formatTrackTime,
  layoutChapterTrack,
} from "@/lib/chapter-track-layout";
import { appHotkeys } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { ChapterAudioControls } from "./chapter-audio-controls";
import { ChapterPauseEditor } from "./chapter-pause-editor";
import { ChapterPlaybackNotice } from "./chapter-playback-bar";
import { useChapterAudioExport } from "./use-chapter-audio-export";
import { useChapterTrackMedia } from "./use-chapter-track-media";

interface PauseOperation {
  projectId: string;
  chapterTitle: string;
  runId: string;
  revision: number;
  id: string;
  change: ChapterPauseEdit;
}

const PAUSE_DRAG_PIXELS_PER_SECOND = 100;
const NO_UNITS: NonNullable<ChapterAudio["status"]>["units"] = [];
const NO_PAUSES: NonNullable<ChapterAudio["status"]>["arrangement"]["pauses"] =
  [];
const PAUSE_DRAG_TYPE = "application/x-castglean-pause";

/** 拖拽独占作用域内的取消手势宿主；由父级 HotkeysProvider exclusive 挂载生效。 */
function DragCancelHotkey({ onCancel }: { onCancel: () => void }) {
  useHotkey(appHotkeys["audio.dragCancel"], onCancel);
  return null;
}

export function ChapterAudioTrack({
  audio,
  chapterId,
  onViewRun,
  nextAction,
  narratorSelected,
  analysisReady,
  onOptions,
  onReturn,
  player,
  selectedSegmentId,
  onLocate,
  pauseContainer,
  onPauseSelect,
  onPauseCommitted,
  requestedPause,
  pauseExitGuard,
  pauseOperationGuard,
  pauseDirtyGuard,
  onStart,
  onCheck,
  onAnalyze,
  analyzeDisabled,
  modeLabel,
  checkOpen,
}: {
  audio: ChapterAudio;
  chapterId: string;
  onViewRun: (run: ChapterAudioRunView) => void;
  nextAction?: React.ReactNode;
  narratorSelected: boolean;
  analysisReady: boolean;
  onOptions: () => void;
  onReturn: () => void;
  player: ChapterPlayerSession;
  selectedSegmentId: string | null;
  pauseContainer: HTMLElement | null;
  requestedPause: number | null;
  pauseExitGuard?: React.RefObject<(() => Promise<boolean>) | null>;
  pauseOperationGuard?: React.RefObject<(() => boolean) | null>;
  pauseDirtyGuard?: React.RefObject<(() => boolean) | null>;
  onStart: (restart?: boolean) => void;
  onCheck?: () => void;
  checkOpen?: boolean;
  onAnalyze?: () => void;
  analyzeDisabled?: boolean;
  modeLabel?: string;
  onPauseSelect: (index: number | null) => Promise<boolean>;
  onPauseCommitted: (index: number | null) => void;
  onLocate: (range: { start: number; end: number }) => void;
}) {
  const { t } = useLingui();
  const status = audio.status;
  const playingHere =
    player.state.active &&
    player.state.target?.projectId === audio.projectId &&
    player.state.target.runId === status?.run.id;
  const [open, setOpen] = useState(false);
  const scrollLeft = useRef(0);
  const [selected, setSelected] = useState<number | null>(null);
  const pause = requestedPause;
  const editorTarget = useRef<{
    boundary: number;
    status: NonNullable<ChapterAudio["status"]>;
  } | null>(null);
  if (pause == null) editorTarget.current = null;
  else if (
    status &&
    (!editorTarget.current ||
      editorTarget.current.boundary !== pause ||
      (editorTarget.current.status.run.id === status.run.id &&
        !pauseDirtyGuard?.current?.()))
  )
    editorTarget.current = { boundary: pause, status };
  const shownPause = useRef(pause);
  shownPause.current = pause;
  const setPause = onPauseSelect;
  const [seconds, setSeconds] = useState("0.5");
  const savedPauses = useRef(status?.arrangement.pauses);
  savedPauses.current = status?.arrangement.pauses;
  useEffect(() => {
    if (pause != null)
      setSeconds(
        String(
          (savedPauses.current?.find((p) => p.afterIndex === pause)
            ?.durationMs ?? 500) / 1000,
        ),
      );
  }, [pause]);
  const [drag, setDrag] = useState<{
    index: number;
    x: number;
    ms: number;
  } | null>(null);
  const [preview, setPreview] = useState<{ index: number; ms: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirmedPrevious, setConfirmedPrevious] = useState<string | null>(
    null,
  );
  const [failedPrevious, setFailedPrevious] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [view, setView] = useState({ left: 0, width: 800 });
  const viewport = useRef<HTMLDivElement>(null);
  const runId = status?.run.id;
  const shownRun = useRef(runId);
  shownRun.current = runId;
  const pauseOperation = useRef<PauseOperation | null>(null);
  const editLock = useRef(false);
  useEffect(() => {
    if (!pauseOperationGuard) return;
    const guard = () => !editLock.current && pauseOperation.current === null;
    pauseOperationGuard.current = guard;
    return () => {
      if (pauseOperationGuard.current === guard)
        pauseOperationGuard.current = null;
    };
  }, [pauseOperationGuard]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset only when the immutable run identity changes.
  useEffect(() => {
    setSelected(null);
    if (!pauseDirtyGuard?.current?.()) setPause(null);
    if (!pauseOperation.current) setError(false);
  }, [runId]);
  useEffect(() => {
    if (audio.starting) setFollow(true);
  }, [audio.starting]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The viewport remounts when expanded.
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setView({ left: node.scrollLeft, width: node.clientWidth }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, runId]);
  const units = status?.units ?? NO_UNITS;
  const pauses = status?.arrangement.pauses ?? NO_PAUSES;
  const complete =
    units.some((u) => u.mediaId != null && (u.durationMs ?? 0) > 0) &&
    units.every(
      (u) => u.status === "empty" || (u.mediaId && u.durationMs != null),
    );
  const finished = complete && status?.run.status === "succeeded";
  const geometry = useMemo(
    () => layoutChapterTrack(units, pauses, preview, view.width, finished),
    [units, pauses, preview, view.width, finished],
  );
  const { items: layout, total } = geometry;
  const previousLayout = useRef({ runId, layout });
  useLayoutEffect(() => {
    const node = viewport.current;
    const previous = previousLayout.current;
    previousLayout.current = { runId, layout };
    if (previous.runId !== runId) {
      scrollLeft.current = 0;
      if (node) node.scrollLeft = 0;
      return;
    }
    if (!previous.layout.length) return;
    const offset = scrollLeft.current;
    const anchor = previous.layout.find(
      (item) => item.left + item.width + item.gap > offset,
    );
    const next = layout.find((item) => item.unit.index === anchor?.unit.index);
    if (
      anchor &&
      next &&
      (anchor.left !== next.left ||
        anchor.width + anchor.gap !== next.width + next.gap)
    ) {
      const left =
        next.left + Math.min(offset - anchor.left, next.width + next.gap - 1);
      scrollLeft.current = Math.min(
        left,
        Math.max(0, total - (node?.clientWidth ?? view.width)),
      );
      if (node) node.scrollLeft = scrollLeft.current;
    }
  }, [layout, runId, total, view.width]);
  const visible = layout.filter(
    (item) =>
      item.left + item.width + item.gap >= view.left - 180 &&
      item.left <= view.left + view.width + 180,
  );
  const ticks = chapterTrackMarks(geometry, visible, view);
  const { summaries, waveforms } = useChapterTrackMedia(
    audio.projectId,
    runId,
    visible,
    open,
  );
  useLayoutEffect(() => {
    if (open && viewport.current)
      viewport.current.scrollLeft = scrollLeft.current;
  }, [open]);

  const reveal = useCallback(
    (index: number | null) => {
      const item = layout.find((i) => i.unit.index === index),
        node = viewport.current;
      if (
        item &&
        node &&
        (item.left < node.scrollLeft ||
          item.left + item.width > node.scrollLeft + node.clientWidth)
      )
        node.scrollLeft = Math.max(0, item.left - node.clientWidth / 3);
    },
    [layout],
  );
  useEffect(() => {
    if (follow && playingHere) reveal(player.state.unit?.index ?? null);
  }, [follow, reveal, playingHere, player.state.unit?.index]);
  const lastSelectedSegment = useRef<string | null>(null);
  useEffect(() => {
    if (lastSelectedSegment.current === selectedSegmentId) return;
    lastSelectedSegment.current = selectedSegmentId;
    const item = units.find((u) => u.segmentId === selectedSegmentId);
    if (item) {
      setSelected(item.index);
      reveal(item.index);
    }
  }, [selectedSegmentId, units, reveal]);
  const edit = async (
    change: ChapterPauseEdit,
    target = status,
    fromEditor = false,
  ): Promise<boolean> => {
    const pending = pauseOperation.current;
    if (!fromEditor && !pending && pauseDirtyGuard?.current?.()) {
      setError(true);
      return false;
    }
    if (editLock.current || (!target && !pending)) return false;
    if (target?.arrangement.stale && !pending) return false;
    if (pending && JSON.stringify(pending.change) !== JSON.stringify(change))
      return false;
    if (!pending) {
      setConfirmedPrevious(null);
      setFailedPrevious(null);
    }
    let operation = pending;
    if (!operation) {
      if (!target) return false;
      operation = {
        projectId: audio.projectId,
        chapterTitle: target.run.chapterTitle,
        runId: target.run.id,
        revision: target.arrangement.revision,
        id: crypto.randomUUID(),
        change: { ...change },
      };
    }
    pauseOperation.current = operation;
    editLock.current = true;
    setBusy(true);
    setError(false);
    try {
      const arrangement = await commands.chapterAudioArrangementEdit(
        operation.projectId,
        operation.runId,
        operation.revision,
        operation.id,
        operation.change,
      );
      pauseOperation.current = null;
      if (shownRun.current !== operation.runId) {
        onPauseCommitted(null);
        setFailedPrevious(null);
        setConfirmedPrevious(operation.chapterTitle);
        return true;
      }
      if (editorTarget.current?.status.run.id === operation.runId) {
        editorTarget.current = {
          ...editorTarget.current,
          status: { ...editorTarget.current.status, arrangement },
        };
      }
      audio.applyArrangement(arrangement);
      let boundary = shownPause.current;
      const affectsEditor =
        operation.change.kind === "undo" ||
        (boundary != null && operation.change.after_index === boundary);
      if (
        operation.change.kind === "move" &&
        boundary === operation.change.after_index
      ) {
        boundary = operation.change.to_index;
        onPauseCommitted(boundary);
      }
      if (boundary != null && affectsEditor) {
        const duration =
          arrangement.pauses.find((p) => p.afterIndex === boundary)
            ?.durationMs ?? 0;
        setSeconds(String(duration / 1000));
        if (
          operation.change.kind === "set" &&
          operation.change.duration_ms === 0 &&
          boundary === operation.change.after_index
        )
          onPauseCommitted(null);
      }
      // The command response is authoritative. A failed background refresh cannot
      // turn an acknowledged move into a failed edit at its original boundary.
      void audio.refresh().catch(() => {});
      return true;
    } catch (cause) {
      if (
        cause === "conflict" ||
        cause === "invalid_data" ||
        cause === "not_found"
      ) {
        pauseOperation.current = null;
        if (shownRun.current === operation.runId) {
          void audio.refresh().catch(() => {});
        } else {
          setFailedPrevious(operation.chapterTitle);
        }
      }
      setError(true);
      return false;
    } finally {
      editLock.current = false;
      setBusy(false);
    }
  };
  const editRef = useRef(edit);
  editRef.current = edit;
  const cancelDrag = useCallback(() => {
    setDrag(null);
    setPreview(null);
  }, []);
  useEffect(() => {
    if (!drag) return;
    const durationAt = (x: number) =>
      Math.max(
        0,
        Math.min(
          10000,
          Math.round(
            (drag.ms + ((x - drag.x) / PAUSE_DRAG_PIXELS_PER_SECOND) * 1000) /
              10,
          ) * 10,
        ),
      );
    const move = (e: PointerEvent) =>
      setPreview({ index: drag.index, ms: durationAt(e.clientX) });
    const up = (e: PointerEvent) => {
      cancelDrag();
      void editRef.current({
        kind: "set",
        after_index: drag.index,
        duration_ms: durationAt(e.clientX),
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, cancelDrag]);
  const {
    exported,
    exportStatus,
    exportable,
    exportFailed,
    startExport,
    cancelExport,
  } = useChapterAudioExport(audio);
  const pendingTitle = pauseOperation.current?.chapterTitle ?? "";
  const pendingRecovery = (error || busy) && pauseOperation.current && (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-xs",
        error && "text-destructive",
      )}
    >
      <span>
        {error ? (
          <Trans>“{pendingTitle}”的停顿修改结果尚未确认，请重试原操作。</Trans>
        ) : (
          <Trans>正在确认“{pendingTitle}”的停顿修改…</Trans>
        )}
      </span>
      {error && (
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const operation = pauseOperation.current;
            if (operation) void edit(operation.change);
          }}
        >
          <Trans>重试停顿操作</Trans>
        </Button>
      )}
    </div>
  );
  const previousNotice = confirmedPrevious && (
    <p role="status" className="px-3 py-2 text-xs">
      <Trans>“{confirmedPrevious}”之前的停顿修改已确认。</Trans>
    </p>
  );
  const previousFailure = failedPrevious && (
    <p role="alert" className="px-3 py-2 text-xs text-destructive">
      <Trans>
        “{failedPrevious}”之前的停顿修改未能完成，请返回原章节检查。
      </Trans>
    </p>
  );
  const current = status?.run.currentIndex ?? null;
  const controls = (
    <ChapterAudioControls
      audio={audio}
      chapterId={chapterId}
      onViewRun={onViewRun}
      nextAction={nextAction}
      player={player}
      open={open}
      narratorSelected={narratorSelected}
      analysisReady={analysisReady}
      exportable={exportable}
      exportFeedback={
        exported?.status === "succeeded" &&
        exported.runId === exportStatus?.run.id
          ? `${exported.filename} · ${exported.revision === exportStatus.arrangement.revision ? t`已导出` : t`已导出旧版本`}`
          : undefined
      }
      onOptions={onOptions}
      onStart={onStart}
      onCheck={onCheck}
      onAnalyze={onAnalyze}
      analyzeDisabled={analyzeDisabled}
      modeLabel={modeLabel}
      checkOpen={checkOpen}
      onLocate={onLocate}
      onExport={() => void startExport()}
      onReturn={onReturn}
    />
  );
  const track = status && (
    <section
      data-slot="chapter-audio-track"
      data-run-id={status.run.id}
      aria-label={t`章节音频轨道`}
      className="shrink-0 border-t bg-card"
    >
      <Collapsible
        open={open}
        onOpenChange={(value) => {
          if (value) setOpen(true);
          else
            void Promise.resolve(pauseExitGuard?.current?.() ?? true).then(
              (allowed) => {
                if (allowed) setOpen(false);
              },
            );
        }}
      >
        {controls}
        <CollapsibleContent>
          {drag ? (
            <HotkeysProvider scope="audio-drag" exclusive>
              <DragCancelHotkey onCancel={cancelDrag} />
            </HotkeysProvider>
          ) : null}
          {status.arrangement.stale && (
            <p role="status" className="px-3 text-xs">
              <Trans>
                当前声音或分析已变化，旧音频保留；重做后可编辑和导出。
              </Trans>
            </p>
          )}
          {error && !pauseOperation.current && !failedPrevious && (
            <p role="alert" className="px-3 text-xs text-destructive">
              <Trans>停顿修改未保存，请检查当前值后重试。</Trans>
            </p>
          )}
          {pendingRecovery}
          {previousNotice}
          {previousFailure}
          {playingHere &&
            player.state.revision != null &&
            player.state.revision !== status.arrangement.revision && (
              <p role="status" className="px-3 text-xs">
                <Trans>停顿已更新，重新播放后生效。</Trans>
              </p>
            )}
          {open && (
            <div
              ref={viewport}
              data-slot="audio-track-scroll"
              className="relative h-20 overflow-x-auto overflow-y-hidden border-t bg-muted/30"
              onWheel={() => setFollow(false)}
              onPointerDown={() => setFollow(false)}
              onScroll={(e) => {
                scrollLeft.current = e.currentTarget.scrollLeft;
                setView({
                  left: scrollLeft.current,
                  width: e.currentTarget.clientWidth,
                });
              }}
            >
              <div
                style={{
                  width: Math.max(total, view.width),
                  height: "100%",
                  position: "relative",
                }}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-5 overflow-hidden"
                >
                  {ticks.map(({ label, left }) => (
                    <span
                      key={left}
                      style={{ left }}
                      className="absolute bottom-0 border-l border-border px-1 text-xs leading-none text-muted-foreground tabular-nums"
                    >
                      {label}
                    </span>
                  ))}
                </div>
                {visible.map(({ unit, left, width, gap, duration }) => {
                  const clipDuration =
                    unit.mediaId && unit.durationMs != null
                      ? formatTrackTime(unit.durationMs)
                      : null;
                  const generating =
                    current === unit.index && status.run.status === "running";
                  const playing =
                    playingHere && player.state.unit?.index === unit.index;
                  const failed = unit.status === "failed";
                  const label = unit.mediaId
                    ? (unit.characterName ?? t`旁白`)
                    : failed
                      ? t`生成失败`
                      : generating
                        ? t`正在生成…`
                        : t`等待生成`;
                  const waveform = unit.mediaId
                    ? waveforms[unit.mediaId]
                    : undefined;
                  const waveformOnly = width < 84 && !!waveform?.length;
                  const StateIcon = failed
                    ? CircleAlertIcon
                    : generating
                      ? LoaderCircleIcon
                      : ClockIcon;
                  const tooltip = [
                    (!unit.mediaId || waveformOnly) && label,
                    summaries[unit.index],
                    clipDuration,
                  ]
                    .filter(Boolean)
                    .join("\n");
                  let appearance =
                    "border-dashed border-border bg-card text-muted-foreground";
                  if (failed)
                    appearance =
                      "border-destructive/35 bg-destructive/10 text-destructive";
                  else if (playing)
                    appearance = "border-primary/30 bg-primary/20";
                  else if (unit.mediaId)
                    appearance = "border-transparent bg-primary/10";
                  else if (generating)
                    appearance = "border-primary/25 bg-accent";
                  return (
                    <div
                      key={unit.index}
                      style={{
                        position: "absolute",
                        left,
                        width: width + gap,
                        top: 26,
                        height: 36,
                      }}
                      className="group/clip flex"
                    >
                      <Button
                        variant="ghost"
                        type="button"
                        data-unit-index={unit.index}
                        aria-pressed={selected === unit.index}
                        title={tooltip || undefined}
                        style={{ width, minWidth: 1 }}
                        className={cn(
                          "flex h-9 min-w-0 shrink-0 gap-1.5 overflow-hidden rounded-full border px-2 text-xs transition-colors",
                          !waveformOnly && "justify-start",
                          appearance,
                          selected === unit.index &&
                            "ring-1 ring-primary ring-inset",
                        )}
                        onClick={() => {
                          lastSelectedSegment.current = unit.segmentId;
                          setSelected(unit.index);
                          setPause(null);
                          onLocate(unit.range);
                        }}
                        aria-keyshortcuts={
                          unit.mediaId && !status.arrangement.stale
                            ? "Shift+Enter"
                            : undefined
                        }
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            event.shiftKey &&
                            unit.mediaId &&
                            !status.arrangement.stale
                          ) {
                            event.preventDefault();
                            void player.start(unit.index);
                          }
                        }}
                        onDoubleClick={() => {
                          if (unit.mediaId && !status.arrangement.stale)
                            void player.start(unit.index);
                        }}
                      >
                        {!unit.mediaId && (
                          <StateIcon
                            aria-hidden="true"
                            className={cn(
                              "size-3.5",
                              generating &&
                                !failed &&
                                "motion-safe:animate-spin",
                            )}
                          />
                        )}
                        <span
                          className={
                            waveformOnly
                              ? "sr-only"
                              : "min-w-0 truncate font-medium"
                          }
                        >
                          {label}
                        </span>
                        {!!waveform?.length && (
                          <svg
                            aria-hidden="true"
                            viewBox={`0 0 ${waveform.length} 24`}
                            preserveAspectRatio="none"
                            className="size-full max-h-5 min-w-0 flex-1 text-primary"
                          >
                            <path
                              d={waveform
                                .map(
                                  (peak, i) =>
                                    `M${i} ${12 - peak * 11}V${12 + peak * 11}`,
                                )
                                .join(" ")}
                              stroke="currentColor"
                              strokeWidth={0.42}
                            />
                          </svg>
                        )}
                      </Button>
                      {gap > 0 && (
                        <button
                          type="button"
                          aria-label={t`片段 ${unit.index + 1} 后的停顿`}
                          draggable={duration > 0}
                          style={{ width: gap }}
                          className={cn(
                            "z-10 shrink-0 overflow-hidden rounded-full text-xs text-muted-foreground select-none hover:bg-muted focus-visible:bg-muted focus-visible:outline-ring",
                            duration > 0 && "bg-muted tabular-nums",
                          )}
                          onDragStart={(e) =>
                            e.dataTransfer.setData(
                              PAUSE_DRAG_TYPE,
                              String(unit.index),
                            )
                          }
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes(PAUSE_DRAG_TYPE))
                              e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const source =
                              e.dataTransfer.getData(PAUSE_DRAG_TYPE);
                            if (
                              !/^\d+$/.test(source) ||
                              Number(source) === unit.index
                            )
                              return;
                            void edit({
                              kind: "move",
                              after_index: Number(source),
                              to_index: unit.index,
                            });
                          }}
                          onClick={() => {
                            setPause(unit.index);
                          }}
                        >
                          {duration > 0 ? (
                            `${duration / 1000}s`
                          ) : (
                            <span
                              aria-hidden="true"
                              className="opacity-0 group-focus-within/clip:opacity-100 group-hover/clip:opacity-100"
                            >
                              +
                            </span>
                          )}
                        </button>
                      )}
                      {duration > 0 && (
                        <button
                          type="button"
                          role="slider"
                          aria-label={t`片段 ${ph({ segment: unit.index + 1 })} 后的停顿时长`}
                          aria-valuemin={0}
                          aria-valuemax={10}
                          aria-valuenow={duration / 1000}
                          aria-valuetext={t`${ph({ seconds: (duration / 1000).toFixed(2) })} 秒，每次调整 0.01 秒`}
                          disabled={
                            busy ||
                            status.arrangement.stale ||
                            pauseOperation.current !== null
                          }
                          className="absolute top-0 right-0 z-20 h-full w-2 cursor-ew-resize touch-none"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            setDrag({
                              index: unit.index,
                              x: e.clientX,
                              ms: duration,
                            });
                            setPreview({ index: unit.index, ms: duration });
                          }}
                          onKeyDown={(e) => {
                            if (
                              [
                                "ArrowRight",
                                "ArrowUp",
                                "ArrowLeft",
                                "ArrowDown",
                                "Home",
                                "End",
                              ].includes(e.key)
                            ) {
                              e.preventDefault();
                              const next =
                                e.key === "Home"
                                  ? 0
                                  : e.key === "End"
                                    ? 10000
                                    : duration +
                                      (["ArrowRight", "ArrowUp"].includes(e.key)
                                        ? 10
                                        : -10);
                              void edit({
                                kind: "set",
                                after_index: unit.index,
                                duration_ms: Math.max(0, Math.min(10000, next)),
                              });
                            }
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
      {exported?.status === "running" && (
        <>
          <span role="status">
            {exported.completed} / {exported.total}
          </span>
          <Button size="xs" variant="ghost" onClick={() => void cancelExport()}>
            <Trans>取消导出</Trans>
          </Button>
        </>
      )}
      {exportFailed || exported?.status === "failed" ? (
        <p role="alert" className="px-3 text-xs text-destructive">
          <Trans>导出未完成，请检查目标位置和音频文件。</Trans>
        </p>
      ) : null}
    </section>
  );
  const target = editorTarget.current?.status;
  if (!audio.desktop) return null;
  return (
    <>
      {track ?? (
        <section className="min-w-0 shrink-0 border-t bg-card">
          {controls}
          {pendingRecovery}
          {previousNotice}
          {previousFailure}
        </section>
      )}
      <ChapterPlaybackNotice player={player} />
      {pause != null &&
        pauseContainer &&
        target &&
        createPortal(
          <ChapterPauseEditor
            key={`${target.run.id}:${pause}`}
            afterIndex={pause}
            seconds={seconds}
            savedDurationMs={
              target.arrangement.pauses.find((p) => p.afterIndex === pause)
                ?.durationMs ?? 0
            }
            boundaries={target.units.slice(0, -1).map((unit) => unit.index)}
            occupied={target.arrangement.pauses.map((p) => p.afterIndex)}
            busy={busy || pauseOperation.current !== null}
            stale={
              target.arrangement.stale ||
              (target.run.id === status?.run.id && status.arrangement.stale)
            }
            targetChanged={target.run.id !== status?.run.id}
            onSeconds={setSeconds}
            onEdit={(change) => edit(change, target, true)}
            onSelect={onPauseCommitted}
            onClose={() => onPauseCommitted(null)}
            canUndo={target.arrangement.canUndo}
            exitGuard={pauseExitGuard}
            dirtyGuard={pauseDirtyGuard}
            canLeave={() =>
              !editLock.current && pauseOperation.current === null
            }
          />,
          pauseContainer,
        )}
    </>
  );
}
