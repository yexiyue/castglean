import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Arrangement,
  type ChapterAudioInput,
  type ChapterAudioRunView_Serialize as ChapterAudioRunView,
  type ChapterAudioStart_Deserialize as ChapterAudioStart,
  type ChapterAudioStatusView_Serialize as ChapterAudioStatusView,
  commands,
  events,
  type VoiceRef,
} from "@/lib/bindings";
import {
  blockersOf,
  chapterAudioActive,
  hasCompleteAudio,
  pendingVersion,
} from "@/lib/chapter-audio";
import { sameVoice } from "@/lib/voice-audition";
import { useWorkspaceReader } from "@/lib/workspace/reader";
import { useChapterAudioPreflight } from "./use-chapter-audio-preflight";

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

const INTERRUPTED: ChapterAudioRunView["status"][] = [
  "failed",
  "cancelled",
  "interrupted",
];

/**
 * 当前章节的生成状态投影。事件只做增量提示，快照查询是权威：
 * 事件丢失或乱序时由下一次查询纠正；任务本身由宿主持有，切章不改变其目标。
 *
 * 版本：`status` 是章节状态（最近一个未放弃的任务）；用户查看历史版本时改为
 * 所查看的版本。`priorComplete` 始终是当前采用版本，供播放、沿用与返回使用。
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
  const [decision, setDecision] = useState<"failed" | "conflict" | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [versions, setVersions] = useState<ChapterAudioRunView[] | null>(null);
  const [viewing, setViewing] = useState(false);
  const generation = useRef(0);
  const scope = useRef(key);
  scope.current = key;
  const pendingStart = useRef(false);
  const pendingDecision = useRef(false);
  const unconfirmedDecisions = useRef(new Map<string, string>());
  const view = useRef<string | null>(null);
  const observed = useRef(new Map<string, ChapterAudioRunView>());
  const shown = useRef<string | null>(null);
  shown.current = status?.run.id ?? null;

  const leaveVersion = useCallback(() => {
    view.current = null;
    setViewing(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!desktop || scope.current !== key) return;
    const current = ++generation.current;
    const stillCurrent = () =>
      current === generation.current && scope.current === key;
    const selectedVersion = view.current;
    const readStatus = async () => {
      const result = await commands.chapterAudioStatus(
        projectId,
        chapterId,
        mode,
        selectedVersion,
        false,
      );
      if (result || !selectedVersion || !stillCurrent()) return result;
      const latest = await commands.chapterAudioStatus(
        projectId,
        chapterId,
        mode,
        null,
        false,
      );
      if (stillCurrent()) leaveVersion();
      return latest;
    };
    const [next, running, listed] = await Promise.all([
      readStatus(),
      commands.chapterAudioActive(projectId),
      commands
        .chapterAudioVersions(projectId, chapterId, mode)
        .catch(() => null),
    ]).catch((error) => {
      if (stillCurrent()) {
        setSettledScope(key);
        setReadState("failed");
      }
      throw error;
    });
    if (!stillCurrent()) return;
    setVersions(listed);
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
    // 待采用结果即使完整，默认播放仍然指向当前采用版本。
    if (
      view.current ||
      !next ||
      next.run.adoption !== "adopted" ||
      !hasCompleteAudio(next)
    ) {
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
  }, [desktop, projectId, chapterId, key, mode, leaveVersion]);

  useEffect(() => {
    if (!desktop) return;
    setStatus(null);
    setPriorComplete(null);
    setSettledScope(null);
    setReadState("loading");
    setFailure(null);
    setDecision(null);
    setVersions(null);
    view.current = null;
    setViewing(false);
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
  const restartRequired =
    failure === "changed" ||
    (settledScope === key && !!status?.arrangement.stale) ||
    (input.mode === "narrator" &&
      !!input.voice &&
      !!frozenNarrator &&
      !sameVoice(input.voice, frozenNarrator));
  const visibleRun = settledScope === key && !viewing ? status?.run : null;
  const resumableRun =
    visibleRun && INTERRUPTED.includes(visibleRun.status) ? visibleRun : null;
  // 失败任务可能已有更多可沿用的单元，待采用版本只用于试听和决定。
  const inheritFrom =
    resumableRun?.id ??
    (settledScope === key ? priorComplete?.run.id : null) ??
    (visibleRun?.status === "succeeded" && visibleRun.adoption !== "pending"
      ? visibleRun.id
      : null);
  // 只有计划变化后才需要重做范围；查看历史版本时不预检重做。
  const redoKey = restartRequired && !viewing ? inheritFrom : null;
  const validationKey = JSON.stringify([
    inputKey,
    planInput,
    workflowRevision,
    redoKey,
  ]);
  const { validationScope, check, checking, preflight, block } =
    useChapterAudioPreflight({
      desktop,
      visible,
      active: !!active,
      projectId,
      chapterId,
      planInput,
      redoKey,
      analysisVersion,
      validationKey,
    });

  const launch = useCallback(
    async (request: ChapterAudioStart) => {
      if (
        !desktop ||
        pendingStart.current ||
        validationScope.current !== validationKey
      )
        return undefined;
      pendingStart.current = true;
      setStarting(true);
      setFailure(null);
      setDecision(null);
      try {
        const next = await commands.chapterAudioStart(
          projectId,
          chapterId,
          planInput,
          request,
        );
        if (scope.current !== key) return undefined;
        // 发起任何任务都回到章节状态，不留在历史版本视图里。
        leaveVersion();
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
        return "started" as const;
      } catch (cause) {
        if (validationScope.current !== validationKey) return undefined;
        const blocked = blockersOf(cause);
        if (blocked?.length) {
          block(blocked);
          return "blocked" as const;
        }
        setFailure(
          cause === "busy"
            ? "busy"
            : cause === "conflict"
              ? "changed"
              : "failed",
        );
        return undefined;
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
      leaveVersion,
      validationKey,
      validationScope,
      block,
    ],
  );

  const start = useCallback(
    (restart = false) => {
      if (restart) return launch({ kind: "fresh", inherit_from: inheritFrom });
      if (resumableRun)
        return launch({ kind: "resume", run_id: resumableRun.id });
      return launch({ kind: "fresh", inherit_from: null });
    },
    [launch, inheritFrom, resumableRun],
  );

  /** 同输入重录当前采用版本中的指定单元；结果等待用户采用或放弃。 */
  const retake = useCallback(
    async (runId: string, units: number[]) =>
      launch({ kind: "retake", run_id: runId, units }),
    [launch],
  );

  const decide = useCallback(
    async (runId: string, choice: "adopt" | "reject") => {
      if (!desktop || scope.current !== key || pendingDecision.current) return;
      const operation = JSON.stringify([key, runId, choice]);
      const unconfirmed = unconfirmedDecisions.current;
      const id = unconfirmed.get(operation) ?? crypto.randomUUID();
      unconfirmed.set(operation, id);
      pendingDecision.current = true;
      setDeciding(true);
      setDecision(null);
      try {
        const command =
          choice === "adopt"
            ? commands.chapterAudioAdopt
            : commands.chapterAudioReject;
        const run = await command(projectId, runId, id);
        unconfirmed.delete(operation);
        if (scope.current !== key) return;
        generation.current++;
        leaveVersion();
        setStatus((current) => {
          if (current?.run.id !== run.id) return current;
          if (run.adoption === "rejected") return priorComplete;
          return { ...current, run: aheadRun(current.run, run) };
        });
        if (run.adoption === "adopted") setPriorComplete(null);
        // 回读失败由章节读取状态报告，已收到的决定回执仍有效。
        void refresh().catch(() => {});
      } catch (cause) {
        if (
          cause === "conflict" ||
          cause === "not_found" ||
          cause === "invalid_data"
        ) {
          unconfirmed.delete(operation);
        }
        if (scope.current === key)
          setDecision(cause === "conflict" ? "conflict" : "failed");
      } finally {
        pendingDecision.current = false;
        setDeciding(false);
      }
    },
    [desktop, key, projectId, leaveVersion, priorComplete, refresh],
  );

  /** 查看某个历史版本；传入 null 回到章节状态。 */
  const viewVersion = useCallback(
    (runId: string | null) => {
      view.current = runId;
      setViewing(runId !== null);
      void refresh().catch(() => {});
    },
    [refresh],
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

  const settled = settledScope === key;
  return {
    desktop,
    projectId,
    refresh,
    status: settled ? status : null,
    priorComplete: settled ? priorComplete : null,
    readState: settled ? readState : "loading",
    mode,
    frozenNarrator,
    restartRequired,
    redo: preflight?.redo ?? null,
    inheritFrom,
    /** 最新任务是否为等待决定的待采用版本。 */
    pending: settled ? pendingVersion(status) : null,
    viewing,
    viewVersion,
    versions: settled ? versions : null,
    decide,
    deciding,
    decision,
    check,
    active,
    blockers: preflight?.blockers ?? null,
    applyArrangement,
    failure,
    starting,
    checking,
    preflight: preflight?.state ?? "unchecked",
    start,
    retake,
    cancel,
  };
}

export type ChapterAudio = ReturnType<typeof useChapterAudio>;
