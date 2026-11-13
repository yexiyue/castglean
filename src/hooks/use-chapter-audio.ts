import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Arrangement,
  type ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
  type ChapterAudioRunView_Serialize as ChapterAudioRunView,
  type ChapterAudioStatusView_Serialize as ChapterAudioStatusView,
  commands,
  events,
} from "@/lib/bindings";
import { blockersOf, chapterAudioActive } from "@/lib/chapter-audio";

/**
 * 快照与事件竞态时保留较新的 run 视图：事件刚推进的进度事实可能领先
 * 快照一步（同状态下 completedUnits 更大者新）；状态变化（如续跑重置）以快照为准。
 */
function aheadRun(
  current: ChapterAudioRunView,
  next: ChapterAudioRunView,
): ChapterAudioRunView {
  return current.revision > next.revision ? current : next;
}

/**
 * 当前章节的生成状态投影。事件只做增量提示，快照查询是权威：
 * 事件丢失或乱序时由下一次查询纠正；任务本身由宿主持有，切章不改变其目标。
 */
export function useChapterAudio(projectId: string, chapterId: string) {
  const desktop = isTauri();
  const [status, setStatus] = useState<ChapterAudioStatusView | null>(null);
  const [active, setActive] = useState<ChapterAudioRunView | null>(null);
  const [blockers, setBlockers] = useState<ChapterAudioBlocker[] | null>(null);
  const [failure, setFailure] = useState<"busy" | "failed" | "changed" | null>(
    null,
  );
  const [starting, setStarting] = useState(false);
  const generation = useRef(0);
  const scope = useRef(`${projectId}:${chapterId}`);
  scope.current = `${projectId}:${chapterId}`;
  const observed = useRef(new Map<string, ChapterAudioRunView>());
  const shown = useRef<string | null>(null);
  shown.current = status?.run.id ?? null;

  const refresh = useCallback(async () => {
    if (!desktop || scope.current !== `${projectId}:${chapterId}`) return;
    const requestedScope = scope.current;
    const current = ++generation.current;
    const [next, running] = await Promise.all([
      commands.chapterAudioStatus(projectId, chapterId),
      commands.chapterAudioActive(projectId),
    ]);
    if (current !== generation.current || requestedScope !== scope.current)
      return;
    setStatus((previous) => {
      if (!previous || !next || previous.run.id !== next.run.id) return next;
      if (previous.run.revision > next.run.revision) return previous;
      const arrangement =
        previous.arrangement.revision > next.arrangement.revision
          ? {
              ...previous.arrangement,
              stale: previous.arrangement.stale || next.arrangement.stale,
            }
          : next.arrangement;
      return { ...next, arrangement, run: aheadRun(previous.run, next.run) };
    });
    const known = running && observed.current.get(running.id);
    const activeView =
      known && running && known.revision > running.revision
        ? chapterAudioActive(known.status)
          ? known
          : null
        : running;
    setActive((previous) =>
      previous && activeView && previous.id === activeView.id
        ? aheadRun(previous, activeView)
        : activeView,
    );
  }, [desktop, projectId, chapterId]);

  useEffect(() => {
    if (!desktop) return;
    setStatus(null);
    setBlockers(null);
    setFailure(null);
    setStarting(false);
    let stop: (() => void) | undefined;
    let alive = true;
    void events.chapterAudioUpdate
      .listen(({ payload }) => {
        if (!alive || payload.projectId !== projectId) return;
        const known = observed.current.get(payload.id);
        if (known && known.revision > payload.revision) return;
        observed.current.set(payload.id, payload);
        const running = chapterAudioActive(payload.status);
        setActive((current) =>
          current?.id === payload.id && current.revision > payload.revision
            ? current
            : running
              ? payload
              : current?.id === payload.id
                ? null
                : current,
        );
        if (payload.chapterId !== chapterId) return;
        if (running && shown.current === payload.id) {
          setStatus((current) =>
            current?.run.id === payload.id
              ? { ...current, run: aheadRun(current.run, payload) }
              : current,
          );
          // 单元产物身份只随快照到达：进行中事件同样重读快照，
          // 让"生成中就近试听"及时拿到已完成单元的 mediaId。
          void refresh().catch(() => {});
        } else {
          // 终态或尚未显示的任务：读取含单元与产物的完整视图。
          void refresh().catch(() => {});
        }
      })
      .then((unlisten) => {
        if (!alive) {
          unlisten();
          return;
        }
        stop = unlisten;
        void refresh().catch(() => {});
      })
      .catch(() => {});
    const poll = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 2000);
    return () => {
      window.clearInterval(poll);
      alive = false;
      generation.current++;
      stop?.();
    };
  }, [desktop, projectId, chapterId, refresh]);

  const start = useCallback(
    async (restart = false) => {
      if (!desktop || starting) return;
      const startedScope = scope.current;
      setStarting(true);
      setBlockers(null);
      setFailure(null);
      try {
        const next = await commands.chapterAudioStart(
          projectId,
          chapterId,
          restart,
        );
        if (scope.current !== startedScope) return;
        generation.current++;
        setStatus((current) =>
          current?.run.id === next.run.id &&
          current.run.revision > next.run.revision
            ? current
            : next,
        );
        const known = observed.current.get(next.run.id);
        const latest = known ? aheadRun(known, next.run) : next.run;
        setActive(chapterAudioActive(latest.status) ? latest : null);
      } catch (cause) {
        if (scope.current !== startedScope) return;
        const blocked = blockersOf(cause);
        if (blocked) setBlockers(blocked);
        else
          setFailure(
            cause === "busy"
              ? "busy"
              : cause === "conflict"
                ? "changed"
                : "failed",
          );
      } finally {
        if (scope.current === startedScope) setStarting(false);
      }
    },
    [desktop, projectId, chapterId, starting],
  );

  const applyArrangement = useCallback((arrangement: Arrangement): void => {
    setStatus((current) => {
      if (
        !current ||
        current.run.id !== arrangement.runId ||
        current.arrangement.revision > arrangement.revision
      )
        return current;
      return {
        ...current,
        arrangement: {
          ...arrangement,
          stale: current.arrangement.stale || arrangement.stale,
        },
      };
    });
  }, []);

  const cancel = useCallback(
    async (runId: string) => {
      if (!desktop) return;
      // 取消结果以宿主快照为准；请求失败时同样重读，不在界面假定已取消。
      await commands.chapterAudioCancel(runId).catch(() => {});
      void refresh().catch(() => {});
    },
    [desktop, refresh],
  );

  return {
    desktop,
    projectId,
    refresh,
    status,
    active,
    blockers,
    updateBlockers: setBlockers,
    applyArrangement,
    failure,
    starting,
    start,
    cancel,
    dismiss: useCallback(() => {
      setBlockers(null);
      setFailure(null);
    }, []),
  };
}

export type ChapterAudio = ReturnType<typeof useChapterAudio>;
