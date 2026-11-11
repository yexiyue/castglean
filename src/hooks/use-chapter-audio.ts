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
    setStatus(next);
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
