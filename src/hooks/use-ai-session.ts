import type { Message } from "@ag-ui/core";
import { fromAgUiMessages, useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { isTauri } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type AgentStart,
  AiRequestError,
  activeRun,
  DesktopAgent,
  type ModelBinding,
  PendingAiStarts,
} from "@/lib/ai";
import {
  type AgentPage,
  commands,
  type SessionCursor,
  type SessionInfo,
} from "@/lib/bindings";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import { useWorkspaceReader } from "@/lib/workspace/reader";

type Selection = { scope: string; id: string; known: boolean };
type Options = {
  projectId: string;
  taskKind: string;
  chapterId?: string | null;
  title: string;
  binding: () => ModelBinding | null;
  failureText: string;
  prepareRevision?: () => Promise<number>;
};

/** Host-owned sessions with one AG-UI runtime; no AI SDK projection or transport. */
export function useAiSession({
  projectId,
  taskKind,
  chapterId = null,
  title,
  binding,
  failureText,
  prepareRevision,
}: Options) {
  const { readOnly } = useWorkspaceReader();
  const { workspace } = useDesktopSession();
  const scope = JSON.stringify([projectId, taskKind, chapterId]);
  const discoverExisting = useRef(
    !(`agentSession:${scope}` in workspace(projectId)),
  );
  const initial = useMemo<Selection>(
    () =>
      (workspace(projectId)[`agentSession:${scope}`] as Selection) ?? {
        scope,
        id: crypto.randomUUID(),
        known: false,
      },
    [scope, workspace, projectId],
  );
  const [selection, setSelection] = useWorkspaceState<Selection>(
    projectId,
    `agentSession:${scope}`,
    initial,
  );
  const selected = selection.scope === scope ? selection : initial;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [snapshot, setSnapshot] = useState<AgentPage | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionCursor, setSessionCursor] = useState<SessionCursor | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [failure, setFailure] = useState<AiRequestError | null>(null);
  const [readFailure, setReadFailure] = useState(false);
  const runtimeSession = useRef<string | null>(null);
  const following = useRef(true);
  const [checkingPending, setCheckingPending] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<"unknown" | "missing">(
    "unknown",
  );
  const [reconnect, setReconnect] = useState(0);
  const [, updatePending] = useState(0);
  const latest = useRef({
    binding,
    failureText,
    title,
    prepareRevision,
    readOnly,
  });
  latest.current = { binding, failureText, title, prepareRevision, readOnly };
  const view = useRef(selected.id);
  view.current = selected.id;
  const pending = useMemo(() => {
    const state = workspace(projectId);
    if (!(state.agentPendingStarts instanceof PendingAiStarts))
      state.agentPendingStarts = new PendingAiStarts();
    return state.agentPendingStarts as PendingAiStarts;
  }, [workspace, projectId]);
  const inScope = useCallback(
    (session: SessionInfo) =>
      session.projectId === projectId &&
      session.taskKind === taskKind &&
      (session.chapterId ?? null) === chapterId,
    [projectId, taskKind, chapterId],
  );
  const received = useRef<(page: AgentPage) => void>(() => {});
  received.current = (page) => {
    if (page.session.id !== view.current || !inScope(page.session)) return;
    const state = workspace(projectId);
    const answerKey = `agentAnswers:${page.session.id}`;
    const answerDrafts = state[answerKey] as Record<string, string> | undefined;
    if (answerDrafts) {
      const open = new Set(
        page.interrupts.map((value) => (value as { id: string }).id),
      );
      state[answerKey] = Object.fromEntries(
        Object.entries(answerDrafts).filter(([id]) => open.has(id)),
      );
    }
    setSnapshot(page);
    if (readFailure) setFailure(null);
    setReadFailure(false);
    setSelection((current) =>
      current.id === page.session.id && !current.known
        ? { ...current, known: true }
        : current,
    );
    setSessions((current) =>
      current.some((session) => session.id === page.session.id)
        ? current.map((session) =>
            session.id === page.session.id ? page.session : session,
          )
        : [page.session, ...current],
    );
  };
  const reportFailure = useCallback((error: unknown) => {
    setFailure(
      error instanceof AiRequestError
        ? error
        : new AiRequestError(latest.current.failureText, error),
    );
  }, []);
  const reportReadFailure = useCallback(
    (error: unknown) => {
      setReadFailure(true);
      reportFailure(error);
    },
    [reportFailure],
  );
  const agent: DesktopAgent = useMemo(
    () =>
      new DesktopAgent({
        sessionId: selected.id,
        binding: () => latest.current.binding(),
        revision: async () =>
          latest.current.prepareRevision
            ? latest.current.prepareRevision()
            : (latest.current.binding()?.expectedProjectRevision ?? 0),
        failureText: () => latest.current.failureText,
        onPage: (page) => received.current(page),
        onStopError: (error) => {
          if (view.current === selected.id) reportFailure(error);
        },
        onResync: () => {
          setTimeout(() => {
            if (view.current === selected.id)
              setReconnect((value) => value + 1);
          }, 0);
        },
        pending,
        ensureSession: async (text) => {
          if (latest.current.readOnly) throw new Error("sample_read_only");
          if (!agent.snapshot()) {
            const created = await commands.agentSessionCreate({
              id: selected.id,
              projectId,
              taskKind,
              chapterId,
              title:
                [...text.replace(/\s+/g, " ").trim()].slice(0, 80).join("") ||
                latest.current.title,
            });
            if (view.current === selected.id) {
              setSelection((current) => ({ ...current, known: true }));
              setSessions((current) =>
                current.some((session) => session.id === created.id)
                  ? current
                  : [created, ...current],
              );
            }
          }
        },
        start: (request) =>
          taskKind === "chapter_analysis"
            ? commands.chapterAnalysisStart(request)
            : commands.agentStart(request),
      }),
    [
      selected.id,
      projectId,
      taskKind,
      chapterId,
      pending,
      setSelection,
      reportFailure,
    ],
  );
  // The thread-list adapter must be referentially stable between renders:
  // the runtime treats a changed `threads` array as new data and notifies,
  // which would otherwise loop with every render.
  const threadListAdapter = useMemo(
    () => ({
      threadId: selected.id,
      threads: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        status: "regular" as const,
      })),
      onSwitchToThread: async (id: string) => {
        if (sessions.some((session) => session.id === id))
          setSelection({ scope, id, known: true });
        // History arrives through the restore effect after the switch; the
        // empty result matches the `thread.reset([])` the switch performs.
        return { messages: [] };
      },
      onSwitchToNewThread: async () => {
        setSelection({ scope, id: crypto.randomUUID(), known: false });
      },
    }),
    [selected.id, sessions, scope, setSelection],
  );
  const adapters = useMemo(
    () => ({ threadList: threadListAdapter }),
    [threadListAdapter],
  );
  const runtime = useAgUiRuntime({
    agent,
    adapters,
    onError: (error) => {
      if (
        !(error instanceof AiRequestError) ||
        !error.sessionId ||
        error.sessionId === view.current
      )
        reportFailure(error);
    },
    autoCancelPendingToolCalls: false,
  });
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const restoreRuntime = useCallback((page: AgentPage) => {
    following.current = true;
    const thread = runtimeRef.current.thread;
    thread.reset(page.run ? [] : fromAgUiMessages(page.messages as Message[]));
    if (page.run) thread.resumeRun({ parentId: null });
  }, []);
  const thread = runtime.thread;
  const threadState = useSyncExternalStore(
    useCallback((listener) => thread.subscribe(listener), [thread]),
    useCallback(() => thread.getState(), [thread]),
    useCallback(() => thread.getState(), [thread]),
  );

  useEffect(() => {
    setSelection((current) => (current.scope === scope ? current : initial));
    if (!isTauri() || readOnly) return;
    let mounted = true;
    void commands
      .agentSessions(projectId, taskKind, chapterId, null)
      .then((page) => {
        if (!mounted) return;
        setSessions(page.sessions);
        setSessionCursor(page.before);
        if (
          discoverExisting.current &&
          !selectedRef.current.known &&
          !pending.get(selectedRef.current.id) &&
          page.sessions[0]
        )
          setSelection({ scope, id: page.sessions[0].id, known: true });
        discoverExisting.current = false;
      })
      .catch((error) => {
        if (mounted) reportReadFailure(error);
      });
    return () => {
      mounted = false;
    };
    // Session discovery runs once per project scope. An explicit new session stays empty.
  }, [
    projectId,
    taskKind,
    chapterId,
    scope,
    readOnly,
    pending,
    reportReadFailure,
    initial,
    setSelection,
  ]);

  useEffect(() => {
    let mounted = true;
    setSnapshot((current) =>
      current?.session.id === selected.id ? current : null,
    );
    setFailure(null);
    setReadFailure(false);
    setPendingStatus("unknown");
    setCheckingPending(false);
    const thread = runtimeRef.current.thread;
    following.current = true;
    if (runtimeSession.current !== selected.id) {
      thread.reset([]);
      setOlderLoading(false);
      runtimeSession.current = selected.id;
    }
    if (
      isTauri() &&
      !readOnly &&
      (selectedRef.current.known || reconnect > 0)
    ) {
      setLoading(true);
      void commands
        .agentHistory(selected.id, null, 20)
        .then((page) => {
          if (!mounted) return;
          agent.restore(page);
          restoreRuntime(page);
        })
        .catch((error) => {
          if (mounted) reportReadFailure(error);
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
    } else setLoading(false);
    return () => {
      mounted = false;
      agent.close();
    };
  }, [
    agent,
    selected.id,
    readOnly,
    reconnect,
    reportReadFailure,
    restoreRuntime,
  ]);

  async function refresh() {
    if (readOnly) return;
    setLoading(true);
    try {
      const page = await commands.agentHistory(selected.id, null, 20);
      if (view.current !== selected.id) return;
      agent.close();
      agent.restore(page);
      restoreRuntime(page);
    } catch (error) {
      if (view.current === selected.id) reportReadFailure(error);
    } finally {
      if (view.current === selected.id) setLoading(false);
    }
  }
  async function loadOlder() {
    setOlderLoading(true);
    try {
      const loaded = await agent.loadOlder();
      if (view.current !== selected.id) return false;
      if (loaded) {
        const page = agent.snapshot();
        if (page) restoreRuntime(page);
      }
      return loaded;
    } catch (error) {
      if (view.current === selected.id) reportReadFailure(error);
      return false;
    } finally {
      if (view.current === selected.id) setOlderLoading(false);
    }
  }
  const visible = snapshot?.session.id === selected.id ? snapshot : null;
  const active =
    activeRun(visible?.run) ||
    (runtimeSession.current === selected.id &&
      !following.current &&
      threadState.isRunning);
  async function send(text: string, action: boolean | "split" = false) {
    if (readOnly) throw new Error("sample_read_only");
    following.current = false;
    setFailure(null);
    agent.setIntent(
      action === "split" ? "split" : action ? "analyze" : "message",
    );
    try {
      await agent.submit(() =>
        runtimeRef.current.thread.append({
          role: "user",
          content: [{ type: "text", text }],
        }),
      );
    } catch (error) {
      if (view.current === selected.id) reportFailure(error);
      throw error;
    }
  }
  async function compactContext() {
    const binding = latest.current.binding();
    if (
      readOnly ||
      taskKind !== "project_assistant" ||
      !visible ||
      active ||
      !binding
    )
      return;
    setFailure(null);
    try {
      const request: AgentStart = {
        ...binding,
        expectedProjectRevision: await (latest.current.prepareRevision?.() ??
          Promise.resolve(binding.expectedProjectRevision)),
        workspaceContext: { action: "compact", chapterId: null },
        input: {
          threadId: selected.id,
          runId: crypto.randomUUID(),
          state: {},
          messages: [],
          tools: [],
          context: [],
          forwardedProps: { compact: true },
          protocolVersion: "1.0",
        },
      };
      if (view.current !== selected.id) return;
      if (!pending.begin(request))
        throw new AiRequestError(latest.current.failureText, "busy");
      try {
        await commands.agentStart(request);
      } catch (error) {
        if (!(await commands.agentRequestStatus(request).catch(() => null)))
          throw error;
      }
      pending.resolve(request);
      if (view.current === selected.id) await refresh();
    } catch (error) {
      if (view.current === selected.id) {
        updatePending((value) => value + 1);
        reportFailure(error);
      }
    }
  }
  async function regenerate() {
    if (readOnly) return;
    following.current = false;
    agent.setIntent("retry");
    const last = [...(agent.snapshot()?.messages ?? [])]
      .reverse()
      .find((value) => (value as Message).role === "user") as
      | Message
      | undefined;
    await agent.submit(() =>
      runtimeRef.current.thread.append({
        role: "user",
        content: [
          {
            type: "text",
            text:
              last?.role === "user" && typeof last.content === "string"
                ? last.content
                : "",
          },
        ],
      }),
    );
  }
  async function recover(retry: boolean, abandon = false) {
    const request = pending.get(selected.id);
    if (!request) return;
    setCheckingPending(true);
    try {
      const accepted = await commands.agentRequestStatus(request);
      if (view.current !== selected.id) return;
      if (!accepted && !retry && !abandon) {
        setPendingStatus("missing");
        return;
      }
      if (!accepted && retry) {
        if (pendingStatus !== "missing") return;
        await (taskKind === "chapter_analysis"
          ? commands.chapterAnalysisStart(request)
          : commands.agentStart(request));
      }
      pending.resolve(request);
      pending.markRecovered(
        selected.id,
        accepted || retry ? "accepted" : "abandoned",
      );
      setPendingStatus("unknown");
      updatePending((value) => value + 1);
      // Answer submission clears the runtime's interrupt state before acceptance.
      // Even an abandoned request must restore the host's still-open questions.
      await refresh();
    } catch (error) {
      if (view.current === selected.id) {
        setPendingStatus("unknown");
        reportFailure(error);
      }
    } finally {
      if (view.current === selected.id) setCheckingPending(false);
    }
  }
  return {
    runtime,
    acceptAnswers: async (submit: () => Promise<void>) => {
      if (readOnly) throw new Error("sample_read_only");
      following.current = false;
      setFailure(null);
      agent.setIntent("message");
      try {
        await agent.submit(submit);
      } catch (error) {
        if (view.current === selected.id) reportFailure(error);
        throw error;
      }
    },
    chat: { error: failure, regenerate },
    snapshot: visible,
    sessionId: selected.id,
    sessions,
    active,
    failure,
    readFailure,
    loading,
    olderLoading,
    hasOlder: visible?.before != null,
    hasMoreSessions: sessionCursor != null,
    send,
    compactContext,
    refresh,
    loadOlder,
    stop: async () => {
      try {
        await agent.stop();
      } catch (error) {
        if (view.current === selected.id) reportFailure(error);
      }
    },
    newSession: () =>
      setSelection({ scope, id: crypto.randomUUID(), known: false }),
    selectSession: (id: string) => {
      if (sessions.some((session) => session.id === id))
        setSelection({ scope, id, known: true });
    },
    loadSessions: async () => {
      if (!sessionCursor) return;
      try {
        const page = await commands.agentSessions(
          projectId,
          taskKind,
          chapterId,
          sessionCursor,
        );
        if (view.current !== selected.id) return;
        setSessionCursor(page.before);
        setSessions((current) => [
          ...current,
          ...page.sessions.filter(
            (session) => !current.some((old) => old.id === session.id),
          ),
        ]);
      } catch (error) {
        if (view.current === selected.id) reportReadFailure(error);
      }
    },
    pendingStart: !!pending.get(selected.id),
    pendingStatus,
    checkingPending,
    recoveredStart: pending.wasRecovered(selected.id),
    acknowledgeRecoveredStart: () => {
      pending.acknowledge(selected.id);
      updatePending((value) => value + 1);
    },
    checkPendingStart: () => recover(false),
    retryPendingStart: () => recover(true),
    stopPendingRecovery: () =>
      pendingStatus === "missing" ? recover(false, true) : Promise.resolve(),
  };
}
