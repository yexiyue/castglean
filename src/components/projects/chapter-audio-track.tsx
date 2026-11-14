import { ph } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
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
import { Slider } from "@/components/ui/slider";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import {
  type ChapterExportView,
  type ChapterPauseEdit,
  commands,
} from "@/lib/bindings";
import { appHotkeys } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { ChapterPauseEditor } from "./chapter-pause-editor";

interface PauseOperation {
  projectId: string;
  chapterTitle: string;
  runId: string;
  revision: number;
  id: string;
  change: ChapterPauseEdit;
}

/** 拖拽独占作用域内的取消手势宿主；由父级 HotkeysProvider exclusive 挂载生效。 */
function DragCancelHotkey({ onCancel }: { onCancel: () => void }) {
  useHotkey(appHotkeys["audio.dragCancel"], onCancel);
  return null;
}

export function ChapterAudioTrack({
  audio,
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
}: {
  audio: ChapterAudio;
  player: ChapterPlayerSession;
  selectedSegmentId: string | null;
  pauseContainer: HTMLElement | null;
  requestedPause: number | null;
  pauseExitGuard?: React.RefObject<(() => Promise<boolean>) | null>;
  pauseOperationGuard?: React.RefObject<(() => boolean) | null>;
  pauseDirtyGuard?: React.RefObject<(() => boolean) | null>;
  onStart: (restart?: boolean) => void;
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
  const [open, setOpen] = useState(true);
  const [height, setHeight] = useState(210);
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
  const [exported, setExported] = useState<ChapterExportView | null>(null);
  const [exportStarting, setExportStarting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [heightDrag, setHeightDrag] = useState<{
    y: number;
    height: number;
  } | null>(null);
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
  const [zoom, setZoom] = useState(100);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [summaries, setSummaries] = useState<Record<number, string>>({});
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
    setSummaries({});
  }, [runId]);
  useEffect(() => {
    if (audio.starting) {
      setOpen(true);
      setFollow(true);
    }
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
  }, [open]);
  const units = status?.units ?? [];
  const complete =
    units.some((u) => u.mediaId != null && (u.durationMs ?? 0) > 0) &&
    units.every(
      (u) => u.status === "empty" || (u.mediaId && u.durationMs != null),
    );
  const layout = useMemo(() => {
    let left = 0;
    return units
      .filter((u) => u.status !== "empty")
      .map((unit) => {
        const duration =
          preview?.index === unit.index
            ? preview.ms
            : (status?.arrangement.pauses.find(
                (p) => p.afterIndex === unit.index,
              )?.durationMs ?? 0);
        const width = complete
          ? Math.max(0, ((unit.durationMs ?? 0) / 1000) * zoom)
          : 170;
        const gap = complete ? (duration / 1000) * zoom : duration ? 42 : 10;
        const result = { unit, left, width, gap, duration };
        left += width + gap;
        return result;
      });
  }, [units, status?.arrangement, complete, zoom, preview]);
  const previousLayout = useRef(layout);
  useLayoutEffect(() => {
    const node = viewport.current;
    const previous = previousLayout.current;
    previousLayout.current = layout;
    if (!node || !previous.length) return;
    const anchor = previous.find((i) => i.left + i.width >= node.scrollLeft);
    const next = layout.find((i) => i.unit.index === anchor?.unit.index);
    if (anchor && next) node.scrollLeft += next.left - anchor.left;
  }, [layout]);
  const visible = layout.filter(
    (item) =>
      item.left + item.width + item.gap >= view.left - 180 &&
      item.left <= view.left + view.width + 180,
  );
  const from = visible[0]?.unit.index,
    to = visible[visible.length - 1]?.unit.index;
  useEffect(() => {
    if (!runId || from == null || to == null) return;
    let alive = true;
    void commands
      .chapterAudioSummaries(
        audio.projectId,
        runId,
        from,
        Math.min(128, to - from + 1),
      )
      .then((items) => {
        if (alive)
          setSummaries(Object.fromEntries(items.map((i) => [i.index, i.text])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [audio.projectId, runId, from, to]);
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
    if (follow)
      reveal(
        playingHere
          ? (player.state.unit?.index ?? null)
          : (status?.run.currentIndex ?? null),
      );
  }, [
    follow,
    reveal,
    playingHere,
    player.state.unit?.index,
    status?.run.currentIndex,
  ]);
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
            (drag.ms + ((x - drag.x) / (complete ? zoom : 100)) * 1000) / 10,
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
  }, [drag, complete, zoom, cancelDrag]);
  useEffect(() => {
    if (!heightDrag) return;
    const move = (e: PointerEvent) =>
      setHeight(
        Math.max(
          140,
          Math.min(360, heightDrag.height + heightDrag.y - e.clientY),
        ),
      );
    const up = () => setHeightDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [heightDrag]);
  const exportId = exported?.status === "running" ? exported.id : null;
  useEffect(() => {
    if (!exportId) return;
    let alive = true;
    const poll = window.setInterval(() => {
      void commands
        .chapterAudioExportStatus(exportId)
        .then((value) => {
          if (alive) setExported(value);
        })
        .catch(() => {
          if (alive) setExportFailed(true);
        });
    }, 500);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [exportId]);
  const startExport = async () => {
    if (!runId || exportStarting) return;
    setExportStarting(true);
    setExportFailed(false);
    try {
      setExported(await commands.chapterAudioExport(audio.projectId, runId));
    } catch {
      setExportFailed(true);
    } finally {
      setExportStarting(false);
    }
  };
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
    <p role="alert" className="text-destructive px-3 py-2 text-xs">
      <Trans>
        “{failedPrevious}”之前的停顿修改未能完成，请返回原章节检查。
      </Trans>
    </p>
  );
  const total = layout.length
    ? layout[layout.length - 1].left +
      layout[layout.length - 1].width +
      layout[layout.length - 1].gap
    : 0;
  const boundary = layout.findIndex((i) => i.unit.index === selected);
  const hasBoundary = boundary >= 0 && boundary < layout.length - 1;
  const current = status?.run.currentIndex ?? null;
  const track = status && (
    <section
      data-slot="chapter-audio-track"
      data-run-id={status.run.id}
      aria-label={t`章节音频轨道`}
      className="bg-card shrink-0 border-t"
    >
      {drag ? (
        <HotkeysProvider scope="audio-drag" exclusive>
          <DragCancelHotkey onCancel={cancelDrag} />
        </HotkeysProvider>
      ) : null}
      {/* biome-ignore lint/a11y/useSemanticElements: Interactive resizer needs keyboard and pointer input, unlike a decorative hr. */}
      <div
        role="separator"
        aria-label={t`调整音频轨道高度`}
        aria-orientation="horizontal"
        aria-valuemin={140}
        aria-valuemax={360}
        aria-valuenow={height}
        tabIndex={0}
        className="flex h-2 cursor-row-resize touch-none items-center justify-center"
        onPointerDown={(e) => {
          e.preventDefault();
          setHeightDrag({ y: e.clientY, height });
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setHeight((h) =>
              Math.max(
                140,
                Math.min(360, h + (e.key === "ArrowUp" ? 10 : -10)),
              ),
            );
          }
        }}
      >
        <span className="bg-border h-1 w-8 rounded-sm" />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-1 text-xs">
        <Button size="xs" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? t`收起轨道` : t`展开轨道`}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={
            status.arrangement.stale ||
            (selected != null
              ? !units.find((u) => u.index === selected)?.mediaId
              : !units.some((u) => u.mediaId))
          }
          onClick={() =>
            void player.start(
              selected ?? units.find((u) => u.mediaId)?.index ?? 0,
            )
          }
        >
          <Trans>从所选片段播放</Trans>
        </Button>
        {[-1, 1].map((direction) => {
          const at = layout.findIndex(
            (item) =>
              item.unit.index ===
              (playingHere ? player.state.unit?.index : selected),
          );
          const next = at >= 0 ? layout[at + direction]?.unit : null;
          return (
            <Button
              key={direction}
              size="xs"
              variant="ghost"
              disabled={status.arrangement.stale || !next?.mediaId}
              onClick={() => {
                if (next) {
                  setSelected(next.index);
                  onLocate(next.range);
                  void player.start(next.index);
                }
              }}
            >
              {direction < 0 ? t`上一片段` : t`下一片段`}
            </Button>
          );
        })}
        <span className="text-muted-foreground tabular-nums">
          <Trans>
            音频 {units.filter((u) => u.mediaId).length} / {layout.length}
          </Trans>
        </span>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setFollow(true);
            if (playingHere && player.state.unit && !status.arrangement.stale)
              onLocate(player.state.unit.range);
            reveal(playingHere ? (player.state.unit?.index ?? null) : current);
          }}
        >
          {playingHere ? t`回到播放位置` : t`回到生成位置`}
        </Button>
        <Button
          size="xs"
          variant="outline"
          draggable
          onDragStart={(e) =>
            e.dataTransfer.setData("application/x-castglean-pause", "new")
          }
          disabled={
            !hasBoundary ||
            busy ||
            pauseOperation.current !== null ||
            status.arrangement.stale
          }
          onClick={() => {
            if (selected != null) {
              const target = selected;
              const existing = status.arrangement.pauses.find(
                (p) => p.afterIndex === target,
              );
              void Promise.resolve(setPause(target)).then((ready) => {
                if (ready === false || existing) return;
                void editRef.current({
                  kind: "set",
                  after_index: target,
                  duration_ms: 500,
                });
              });
            }
          }}
        >
          <Trans>添加停顿</Trans>
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={
            !status.arrangement.canUndo ||
            busy ||
            pauseOperation.current !== null
          }
          onClick={() => void edit({ kind: "undo" })}
        >
          <Trans>撤销停顿修改</Trans>
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={
            !complete ||
            status.arrangement.stale ||
            exportStarting ||
            exported?.status === "running"
          }
          onClick={() => void startExport()}
        >
          <Trans>导出 WAV</Trans>
        </Button>
        {exported?.status === "running" && (
          <>
            <span role="status">
              {exported.completed} / {exported.total}
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void commands
                  .chapterAudioExportCancel(exported.id)
                  .catch(() => setExportFailed(true))
              }
            >
              <Trans>取消导出</Trans>
            </Button>
          </>
        )}
        {complete && (
          <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap">
            <Trans>缩放</Trans>
            <div className="w-28 shrink-0">
              <Slider
                aria-label={t`时间轴缩放`}
                min={24}
                max={400}
                step={1}
                value={[zoom]}
                getAriaValueText={(_, value) => t`${value} 像素每秒`}
                onValueChange={(value) =>
                  setZoom(typeof value === "number" ? value : value[0])
                }
              />
            </div>
          </div>
        )}
      </div>
      {audio.failure === "changed" && (
        <div className="flex items-center gap-2 p-2 text-xs">
          <Trans>当前配置与旧任务不同，已完成音频将保留。</Trans>
          <Button size="xs" onClick={() => onStart(true)}>
            <Trans>生成新版本</Trans>
          </Button>
        </div>
      )}
      {!status.arrangement.stale &&
        ["cancelled", "failed", "interrupted"].includes(status.run.status) && (
          <Button
            className="mx-3"
            size="xs"
            variant="outline"
            disabled={audio.starting}
            onClick={() => onStart()}
          >
            <Trans>继续生成</Trans>
          </Button>
        )}
      {status.arrangement.stale && (
        <p role="status" className="px-3 text-xs">
          <Trans>
            当前声音或分析已变化，旧音频保留；重新生成后可编辑和导出。
          </Trans>
        </p>
      )}
      {exportFailed || exported?.status === "failed" ? (
        <p role="alert" className="text-destructive px-3 text-xs">
          <Trans>导出未完成，请检查目标位置和音频文件。</Trans>
        </p>
      ) : exported?.status === "succeeded" ? (
        <p role="status" className="px-3 text-xs">
          {exported.filename} ·{" "}
          {exported.revision === status.arrangement.revision
            ? t`已导出`
            : t`已导出旧版本`}
        </p>
      ) : null}
      {error && !pauseOperation.current && !failedPrevious && (
        <p role="alert" className="text-destructive px-3 text-xs">
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
      {playingHere &&
        player.state.gapIndex != null &&
        !player.state.playing && (
          <p role="status" className="px-3 text-xs">
            <Trans>后续片段尚未生成。</Trans>
          </p>
        )}
      {open && (
        <div
          style={{ height: Math.min(height, 280), maxHeight: "30vh" }}
          className="flex min-h-0 flex-col"
        >
          <div
            ref={viewport}
            data-slot="audio-track-scroll"
            className="relative min-h-20 flex-1 overflow-x-auto overflow-y-hidden"
            onWheel={() => setFollow(false)}
            onPointerDown={() => setFollow(false)}
            onScroll={(e) =>
              setView({
                left: e.currentTarget.scrollLeft,
                width: e.currentTarget.clientWidth,
              })
            }
          >
            <div
              style={{
                width: Math.max(total, view.width),
                height: "100%",
                position: "relative",
              }}
            >
              {complete &&
                Array.from(
                  { length: Math.ceil(view.width / 80) + 2 },
                  (_, n) => {
                    const step = Math.max(1, Math.ceil(80 / zoom));
                    const seconds =
                      (Math.floor(view.left / zoom / step) + n) * step;
                    if (seconds * zoom > total) return null;
                    return (
                      <span
                        key={seconds}
                        className="text-muted-foreground absolute top-0 border-l px-1 text-xs tabular-nums select-none"
                        style={{ left: seconds * zoom }}
                      >
                        {seconds}s
                      </span>
                    );
                  },
                )}
              {visible.map(({ unit, left, width, gap, duration }) => (
                <div
                  key={unit.index}
                  style={{
                    position: "absolute",
                    left,
                    width: width + gap,
                    top: complete ? 24 : 4,
                    bottom: 8,
                  }}
                  className="flex"
                >
                  <button
                    type="button"
                    data-unit-index={unit.index}
                    aria-pressed={selected === unit.index}
                    style={{ width, minWidth: 1 }}
                    className={cn(
                      "flex min-w-0 shrink-0 flex-col gap-1 overflow-hidden rounded-sm border p-2 text-left text-xs",
                      unit.mediaId ? "bg-success/10" : "bg-muted/40",
                      unit.status === "failed" && "border-destructive",
                      selected === unit.index && "ring-primary ring-2",
                      player.state.unit?.index === unit.index &&
                        playingHere &&
                        "bg-primary/15",
                    )}
                    onClick={() => {
                      lastSelectedSegment.current = unit.segmentId;
                      setSelected(unit.index);
                      setPause(null);
                      onLocate(unit.range);
                    }}
                    onDoubleClick={() => {
                      if (unit.mediaId && !status.arrangement.stale)
                        void player.start(unit.index);
                    }}
                  >
                    <span className="w-full truncate font-medium">
                      {unit.characterName ?? t`旁白`}
                    </span>
                    <span className="w-full truncate">
                      {summaries[unit.index] ?? `${t`片段`} ${unit.index + 1}`}
                    </span>
                    <span className="text-muted-foreground">
                      {current === unit.index && status.run.status === "running"
                        ? t`正在生成…`
                        : unit.status === "failed"
                          ? t`生成失败`
                          : unit.mediaId
                            ? `${((unit.durationMs ?? 0) / 1000).toFixed(1)}s`
                            : t`等待生成`}
                    </span>
                  </button>
                  {unit.mediaId && width > 60 && (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="absolute right-3 bottom-1"
                      aria-label={t`播放片段 ${unit.index + 1}`}
                      disabled={status.arrangement.stale}
                      onClick={() => void player.start(unit.index)}
                    >
                      ▶
                    </Button>
                  )}
                  {layout[layout.length - 1].unit.index !== unit.index && (
                    <button
                      type="button"
                      aria-label={t`片段 ${unit.index + 1} 后的停顿`}
                      draggable={duration > 0}
                      style={{ width: Math.max(10, gap) }}
                      className={cn(
                        "z-10 shrink-0 overflow-hidden border-x text-xs select-none",
                        duration > 0 && "bg-warning/15",
                      )}
                      onDragStart={(e) =>
                        e.dataTransfer.setData(
                          "application/x-castglean-pause",
                          String(unit.index),
                        )
                      }
                      onDragOver={(e) => {
                        if (
                          e.dataTransfer.types.includes(
                            "application/x-castglean-pause",
                          )
                        )
                          e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const source = e.dataTransfer.getData(
                          "application/x-castglean-pause",
                        );
                        if (source !== "new" && !/^\d+$/.test(source)) return;
                        if (source === "new" && duration > 0) {
                          setPause(unit.index);
                          return;
                        }
                        void edit(
                          source === "new"
                            ? {
                                kind: "set",
                                after_index: unit.index,
                                duration_ms: 500,
                              }
                            : {
                                kind: "move",
                                after_index: Number(source),
                                to_index: unit.index,
                              },
                        );
                      }}
                      onClick={() => {
                        setPause(unit.index);
                      }}
                    >
                      {duration > 0 ? `${duration / 1000}s` : "+"}
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
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
  const target = editorTarget.current?.status;
  if (!audio.desktop) return null;
  return (
    <>
      {track ??
        ((pendingRecovery || previousNotice || previousFailure) && (
          <section>
            {pendingRecovery}
            {previousNotice}
            {previousFailure}
          </section>
        ))}
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
            busy={
              busy ||
              target.arrangement.stale ||
              pauseOperation.current !== null
            }
            targetChanged={target.run.id !== status?.run.id}
            onSeconds={setSeconds}
            onEdit={(change) => edit(change, target, true)}
            onSelect={onPauseCommitted}
            onClose={() => onPauseCommitted(null)}
            exitGuard={pauseExitGuard}
            dirtyGuard={pauseDirtyGuard}
            canLeave={() =>
              !editLock.current &&
              pauseOperation.current === null &&
              !target.arrangement.stale
            }
          />,
          pauseContainer,
        )}
    </>
  );
}
