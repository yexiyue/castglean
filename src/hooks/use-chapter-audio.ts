import { isTauri } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  type Arrangement,
  type ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
  type ChapterAudioInput,
  type ChapterAudioRunView_Serialize as ChapterAudioRunView,
  type ChapterAudioStatusView_Serialize as ChapterAudioStatusView,
  commands,
  events,
  type VoiceRef,
} from "@/lib/bindings";
import {
  blockersOf,
  chapterAudioActive,
  hasCompleteAudio,
} from "@/lib/chapter-audio";
import { sameVoice } from "@/lib/voice-audition";
import { useWorkspaceReader } from "@/lib/workspace/reader";

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
export function useChapterAudio(
  projectId: string,
  chapterId: string,
  input: ChapterAudioInput,
  {
    visible = true,
    analysisVersion,
    workflowRevision,
  }: {
    visible?: boolean;
    analysisVersion?: string | null;
    workflowRevision?: string;
  } = {},
) {
  const mode = input.mode;
  const key = JSON.stringify([projectId, chapterId, mode]);
  const inputKey = JSON.stringify([key, input, analysisVersion]);
  const { readOnly } = useWorkspaceReader();
  const desktop = isTauri() && !readOnly;
  const [status, setStatus] = useState<ChapterAudioStatusView | null>(null);
  const [priorComplete, setPriorComplete] =
    useState<ChapterAudioStatusView | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [settledScope, setSettledScope] = useState<string | null>(null);
  const [active, setActive] = useState<ChapterAudioRunView | null>(null);
  const [failure, setFailure] = useState<"busy" | "failed" | "changed" | null>(
    null,
  );
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState<{
    key: string;
    state: "checking" | "ready" | "blocked" | "failed";
    blockers?: ChapterAudioBlocker[];
  } | null>(null);
  const checkSerial = useRef(0);
  const generation = useRef(0);
  const scope = useRef(key);
  scope.current = key;
  const pendingStart = useRef(false);
  const observed = useRef(new Map<string, ChapterAudioRunView>());
  const shown = useRef<string | null>(null);
  shown.current = status?.run.id ?? null;

  const refresh = useCallback(async () => {
    if (!desktop || scope.current !== key) return;
    const current = ++generation.current;
    const stillCurrent = () =>
      current === generation.current && scope.current === key;
    const [next, running] = await Promise.all([
      commands.chapterAudioStatus(projectId, chapterId, mode, null, false),
      commands.chapterAudioActive(projectId),
    ]).catch((error) => {
      if (stillCurrent()) {
        setSettledScope(key);
        setReadState("failed");
      }
      throw error;
    });
    if (!stillCurrent()) return;
    setSettledScope(key);
    setReadState("ready");
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
    let activeView = running;
    if (known && running && known.revision > running.revision)
      activeView = chapterAudioActive(known.status) ? known : null;
    setActive((previous) =>
      previous && activeView && previous.id === activeView.id
        ? aheadRun(previous, activeView)
        : activeView,
    );
    if (next && !hasCompleteAudio(next)) {
      const complete = await commands
        .chapterAudioStatus(projectId, chapterId, mode, null, true)
        .catch(() => null);
      if (stillCurrent())
        setPriorComplete(
          complete && hasCompleteAudio(complete) ? complete : null,
        );
    } else {
      setPriorComplete(null);
    }
  }, [desktop, projectId, chapterId, key, mode]);

  useEffect(() => {
    if (!desktop) return;
    setStatus(null);
    setPriorComplete(null);
    setSettledScope(null);
    setReadState("loading");
    setFailure(null);
    let stop: (() => void) | undefined;
    let alive = true;
    void events.chapterAudioUpdate
      .listen(({ payload }) => {
        if (!alive || payload.projectId !== projectId) return;
        const known = observed.current.get(payload.id);
        if (known && known.revision > payload.revision) return;
        observed.current.set(payload.id, payload);
        const running = chapterAudioActive(payload.status);
        setActive((current) => {
          const sameRun = current?.id === payload.id;
          if (sameRun && current.revision > payload.revision) return current;
          if (running) return payload;
          return sameRun ? null : current;
        });
        if (payload.chapterId !== chapterId || payload.mode !== mode) return;
        if (running && shown.current === payload.id) {
          setStatus((current) =>
            current?.run.id === payload.id
              ? { ...current, run: aheadRun(current.run, payload) }
              : current,
          );
        }
        // 单元产物身份只随快照到达，生成中也需刷新才可试听新片段。
        void refresh().catch(() => {});
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
  }, [desktop, projectId, chapterId, mode, refresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Preflight errors belong to the previous input.
  useEffect(() => {
    setFailure(null);
  }, [inputKey]);

  const frozenSource =
    settledScope === key && input.mode === "narrator" ? status : null;
  const unit = frozenSource?.units.find((item) => item.status !== "empty");
  const frozenNarrator: VoiceRef | null =
    frozenSource && unit
      ? {
          kind: "preset",
          backend: frozenSource.run.backend,
          model: frozenSource.run.model,
          voice: unit.voice,
        }
      : null;
  const planInput: ChapterAudioInput =
    input.mode === "narrator" && !input.voice && frozenNarrator
      ? { mode: "narrator", voice: frozenNarrator }
      : input;
  const validationKey = JSON.stringify([inputKey, planInput, workflowRevision]);
  const validationScope = useRef(validationKey);
  validationScope.current = validationKey;
  const start = useCallback(
    async (restart = false) => {
      if (
        !desktop ||
        pendingStart.current ||
        validationScope.current !== validationKey
      )
        return;
      pendingStart.current = true;
      setStarting(true);
      setFailure(null);
      try {
        const next = await commands.chapterAudioStart(
          projectId,
          chapterId,
          restart,
          planInput,
          !restart &&
            settledScope === key &&
            status &&
            ["failed", "cancelled", "interrupted"].includes(status.run.status)
            ? status.run.id
            : null,
        );
        if (scope.current !== key) return;
        generation.current++;
        setSettledScope(key);
        setReadState("ready");
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
        if (validationScope.current !== validationKey) return;
        const blocked = blockersOf(cause);
        if (blocked?.length) {
          checkSerial.current++;
          setChecking(false);
          setPreflight({
            key: validationKey,
            state: "blocked",
            blockers: blocked,
          });
          return "blocked";
        }
        setFailure(
          cause === "busy"
            ? "busy"
            : cause === "conflict"
              ? "changed"
              : "failed",
        );
      } finally {
        pendingStart.current = false;
        setStarting(false);
      }
    },
    [
      desktop,
      projectId,
      chapterId,
      key,
      planInput,
      settledScope,
      status,
      validationKey,
    ],
  );

  const check = async () => {
    if (!desktop || validationScope.current !== validationKey) return;
    const request = ++checkSerial.current;
    const current = () =>
      checkSerial.current === request &&
      validationScope.current === validationKey;
    setChecking(true);
    setPreflight({ key: validationKey, state: "checking" });
    try {
      const next = await commands.chapterAudioCheck(
        projectId,
        chapterId,
        planInput,
      );
      if (current()) {
        setPreflight({
          key: validationKey,
          state: next.ready ? "ready" : "blocked",
          blockers: next.blockers.length ? next.blockers : undefined,
        });
      }
    } catch (error) {
      if (current()) setPreflight({ key: validationKey, state: "failed" });
      throw error;
    } finally {
      if (checkSerial.current === request) setChecking(false);
    }
  };
  const checkSelection = useEffectEvent(() => void check().catch(() => {}));
  const canCheck =
    desktop &&
    visible &&
    !active &&
    (planInput.mode === "narrator" ? !!planInput.voice : !!analysisVersion);
  const preflightKey = canCheck ? validationKey : null;
  useEffect(() => {
    if (preflightKey !== null) checkSelection();
    else setChecking(false);
    return () => {
      checkSerial.current++;
    };
  }, [preflightKey]);

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
    status: settledScope === key ? status : null,
    priorComplete: settledScope === key ? priorComplete : null,
    readState: settledScope === key ? readState : "loading",
    mode,
    frozenNarrator,
    restartRequired:
      failure === "changed" ||
      (settledScope === key && !!status?.arrangement.stale) ||
      (input.mode === "narrator" &&
        !!input.voice &&
        !!frozenNarrator &&
        !sameVoice(input.voice, frozenNarrator)),
    check,
    active,
    blockers:
      preflight?.key === validationKey ? (preflight.blockers ?? null) : null,
    applyArrangement,
    failure,
    starting,
    checking,
    preflight: preflight?.key === validationKey ? preflight.state : "unchecked",
    start,
    cancel,
  };
}

export type ChapterAudio = ReturnType<typeof useChapterAudio>;
