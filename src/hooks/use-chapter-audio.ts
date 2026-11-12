import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
  if (current.status !== next.status) return next;
  if (current.completedUnits > next.completedUnits) return current;
  return next;
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
  const [failure, setFailure] = useState<"busy" | "failed" | null>(null);
  const [starting, setStarting] = useState(false);
  const generation = useRef(0);
  const shown = useRef<string | null>(null);
  shown.current = status?.run.id ?? null;

  const refresh = useCallback(async () => {
    if (!desktop) return;
    const current = ++generation.current;
    const [next, running] = await Promise.all([
      commands.chapterAudioStatus(projectId, chapterId),
      commands.chapterAudioActive(projectId),
    ]);
    if (current !== generation.current) return;
    setStatus((previous) =>
      previous && next && previous.run.id === next.run.id
        ? { ...next, run: aheadRun(previous.run, next.run) }
        : next,
    );
    setActive(running);
  }, [desktop, projectId, chapterId]);

  useEffect(() => {
    if (!desktop) return;
    setStatus(null);
    setBlockers(null);
    setFailure(null);
    let stop: (() => void) | undefined;
    let alive = true;
    void events.chapterAudioUpdate
      .listen(({ payload }) => {
        if (!alive || payload.projectId !== projectId) return;
        const running = chapterAudioActive(payload.status);
        setActive((current) =>
          running ? payload : current?.id === payload.id ? null : current,
        );
        if (payload.chapterId !== chapterId) return;
        if (running && shown.current === payload.id) {
          setStatus((current) =>
            current?.run.id === payload.id
              ? { ...current, run: payload }
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
    return () => {
      alive = false;
      generation.current++;
      stop?.();
    };
  }, [desktop, projectId, chapterId, refresh]);

  const start = useCallback(async () => {
    if (!desktop || starting) return;
    setStarting(true);
    setBlockers(null);
    setFailure(null);
    try {
      const next = await commands.chapterAudioStart(projectId, chapterId);
      generation.current++;
      setStatus(next);
      setActive(chapterAudioActive(next.run.status) ? next.run : null);
    } catch (cause) {
      const blocked = blockersOf(cause);
      if (blocked) setBlockers(blocked);
      else setFailure(cause === "busy" ? "busy" : "failed");
    } finally {
      setStarting(false);
    }
  }, [desktop, projectId, chapterId, starting]);

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
    status,
    active,
    blockers,
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
