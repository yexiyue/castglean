import { useChat } from "@ai-sdk/react";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeRun, aiMessages } from "@/lib/ai/stream";
import { PendingAiStarts } from "@/lib/ai/pending-starts";
import {
  AiRequestError,
  AiTransport,
  type ModelBinding,
} from "@/lib/ai/transport";
import type { HistoryPage, SessionCursor, SessionInfo } from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import { useWorkspaceReader } from "@/lib/workspace/reader";

type SessionSelection = { scope: string; id: string; known: boolean };

type Options = {
  projectId: string;
  taskKind: string;
  chapterId?: string | null;
  title: string;
  binding: () => ModelBinding | null;
  failureText: string;
  prepareRevision?: () => Promise<number>;
};

/** Scope discovery, transient message projection, and subscription lifetime only. */
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
  const scope = JSON.stringify([projectId, taskKind, chapterId]);
  const selectionKey = `aiSession:${scope}`;
  const { workspace } = useDesktopSession();
  const pendingStarts = useMemo(() => {
    const values = workspace(projectId);
    if (!(values.aiPendingStarts instanceof PendingAiStarts))
      values.aiPendingStarts = new PendingAiStarts();
    return values.aiPendingStarts as PendingAiStarts;
  }, [workspace, projectId]);
  const retained = useMemo(
    () => workspace(projectId)[selectionKey] as SessionSelection | undefined,
    [workspace, projectId, selectionKey],
  );
  const initial = useMemo(
    () => retained ?? { scope, id: crypto.randomUUID(), known: false },
    [scope, retained],
  );
  const initialId = initial.id;
  const [selected, setSelected] = useWorkspaceState<SessionSelection>(
    projectId,
    selectionKey,
    initial,
  );
  const selection = selected.scope === scope ? selected : initial;
  const view = useRef({ scope, id: selection.id });
  view.current = { scope, id: selection.id };
  const inScope = useCallback(
    (session: SessionInfo) =>
      session.projectId === projectId &&
      session.taskKind === taskKind &&
      (session.chapterId ?? null) === chapterId,
    [projectId, taskKind, chapterId],
  );
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionCursor, setSessionCursor] = useState<SessionCursor | null>(
    null,
  );
  const [snapshot, setSnapshot] = useState<HistoryPage | null>(null);
  const [listing, setListing] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [failure, setFailure] = useState<AiRequestError | null>(null);
  const [pendingStatus, setPendingStatus] = useState<{
    id: string;
    requestId?: string;
    status: "unknown" | "missing";
  }>({ id: selection.id, status: "unknown" });
  const [checkingPending, setCheckingPending] = useState(false);
  const pendingCheckVersion = useRef(0);
  const [, refreshRecovery] = useState(0);
  const latest = useRef({
    binding,
    failureText,
    title,
    prepareRevision,
    readOnly,
  });
  latest.current = { binding, failureText, title, prepareRevision, readOnly };
  const received = useRef<(page: HistoryPage) => void>(() => {});
  const choosing = useRef(0);
  const sendFailed = useRef(false);
  const receivedPage = useRef<HistoryPage | null>(null);
  const reportFailure = useCallback((error: unknown) => {
    sendFailed.current = true;
    setFailure(
      error instanceof AiRequestError
        ? error
        : new AiRequestError(latest.current.failureText, error),
    );
  }, []);
  const transport = useMemo(
    () =>
      new AiTransport(
        selection.id,
        () => latest.current.binding(),
        (page) => received.current(page),
        latest.current.failureText,
        async (text) => {
          if (latest.current.readOnly) throw new Error("sample_read_only");
          const created = await commands.aiSessionCreate({
            id: selection.id,
            projectId,
            taskKind,
            chapterId,
            title:
              [...text.replace(/\s+/g, " ").trim()].slice(0, 80).join("") ||
              latest.current.title,
          });
          if (view.current.scope === scope)
            setSessions((current) =>
              current.some((item) => item.id === created.id)
                ? current
                : [created, ...current],
            );
          return commands.aiHistory(selection.id, null, 20);
        },
        (request, analyze) => {
          if (latest.current.readOnly)
            return Promise.reject(new Error("sample_read_only"));
          return taskKind === "chapter_analysis" && analyze
            ? commands.chapterAnalysisStart(request)
            : commands.aiStart(request);
        },
        taskKind === "chapter_analysis" || taskKind === "project_assistant"
          ? async () =>
              latest.current.prepareRevision
                ? latest.current.prepareRevision()
                : (latest.current.binding()?.expectedProjectRevision ?? 0)
          : undefined,
        pendingStarts,
      ),
    [selection.id, projectId, taskKind, chapterId, pendingStarts, scope],
  );
  transport.setFailureText(failureText);
  const chat = useChat({ id: selection.id, transport, onError: reportFailure });
  const { setMessages, resumeStream, clearError } = chat;
  received.current = (page) => {
    if (page.session.id !== selection.id || !inScope(page.session)) return;
    receivedPage.current = page;
    setSnapshot(page);
    setSessions((current) =>
      current.some((session) => session.id === page.session.id)
        ? current.map((session) =>
            session.id === page.session.id ? page.session : session,
          )
        : [page.session, ...current],
    );
    // Restore host identities too: SDK regenerate locally removes its last reply.
    setMessages(aiMessages(page.messages, latest.current.failureText));
  };

  useEffect(() => {
    let mounted = true;
    const choice = choosing.current;
    if (!isTauri() || readOnly) {
      setListing(false);
      return;
    }
    setListing(true);
    setSelected((current) => (current.scope === scope ? current : initial));
    setSessions([]);
    setSessionCursor(null);
    setOlderLoading(false);
    setFailure(null);
    void commands
      .aiSessions(projectId, taskKind, chapterId, null)
      .then((page) => {
        if (!mounted) return;
        setSessions(page.sessions);
        setSessionCursor(page.before ?? null);
        if (choice === choosing.current)
          setSelected({
            scope,
            id: retained?.id ?? page.sessions.find(inScope)?.id ?? initialId,
            known: retained
              ? retained.known ||
                page.sessions.some((s) => s.id === retained.id)
              : page.sessions.some(inScope),
          });
      })
      .catch((error) => {
        if (mounted) reportFailure(error);
      })
      .finally(() => {
        if (mounted) setListing(false);
      });
    return () => {
      mounted = false;
    };
  }, [
    projectId,
    taskKind,
    chapterId,
    scope,
    initialId,
    reportFailure,
    initial,
    inScope,
    retained,
    setSelected,
    readOnly,
  ]);

  useEffect(() => {
    let mounted = true;
    transport.activate();
    clearError();
    if (selection.known && isTauri() && !readOnly) {
      setRestoring(true);
      setSnapshot(null);
      setMessages([]);
      void commands
        .aiHistory(selection.id, null, 20)
        .then((page) => {
          if (!mounted) return;
          transport.restore(page);
          received.current(page);
          setFailure(null);
          if (activeRun(page.run)) void resumeStream().catch(reportFailure);
        })
        .catch((error) => {
          if (mounted) reportFailure(error);
        })
        .finally(() => {
          if (mounted) setRestoring(false);
        });
    } else {
      setSnapshot(null);
      setMessages([]);
      setRestoring(false);
    }
    return () => {
      mounted = false;
      transport.dispose();
    };
  }, [
    transport,
    selection.id,
    selection.known,
    clearError,
    reportFailure,
    resumeStream,
    setMessages,
    readOnly,
  ]);

  async function loadOlder() {
    if (readOnly) return false;
    const currentView = view.current;
    setOlderLoading(true);
    let loaded = false;
    try {
      await transport.loadOlder();
      loaded = true;
    } catch (error) {
      if (
        view.current.scope === currentView.scope &&
        view.current.id === currentView.id
      )
        reportFailure(error);
    } finally {
      if (
        view.current.scope === currentView.scope &&
        view.current.id === currentView.id
      )
        setOlderLoading(false);
    }
    return loaded;
  }
  async function loadSessions() {
    if (readOnly || !sessionCursor) return;
    const currentScope = scope;
    try {
      const page = await commands.aiSessions(
        projectId,
        taskKind,
        chapterId,
        sessionCursor,
      );
      if (view.current.scope !== currentScope) return;
      setSessions((current) => [
        ...current,
        ...page.sessions.filter(
          (session) => !current.some((old) => old.id === session.id),
        ),
      ]);
      setSessionCursor(page.before ?? null);
    } catch (error) {
      if (view.current.scope === currentScope) reportFailure(error);
    }
  }
  function selectSession(id: string) {
    if (sessions.some((session) => session.id === id)) {
      choosing.current += 1;
      setFailure(null);
      setSelected({ scope, id, known: true });
    }
  }
  function newSession() {
    choosing.current += 1;
    setFailure(null);
    setSelected({ scope, id: crypto.randomUUID(), known: false });
  }
  async function refresh() {
    if (readOnly) return;
    try {
      await chat.resumeStream();
    } catch (error) {
      reportFailure(error);
    }
  }
  async function stop() {
    if (readOnly) return;
    try {
      await transport.stop();
    } catch (error) {
      reportFailure(error);
    }
  }
  const visibleSnapshot =
    snapshot?.session.id === selection.id && inScope(snapshot.session)
      ? snapshot
      : null;
  return {
    chat,
    pendingStart: !!transport.pendingStart(),
    recoveredStart: pendingStarts.wasRecovered(selection.id),
    acknowledgeRecoveredStart: () => {
      pendingStarts.acknowledge(selection.id);
      refreshRecovery((value) => value + 1);
    },
    pendingStatus:
      pendingStatus.id === selection.id &&
      pendingStatus.requestId === transport.pendingStart()?.requestId
        ? pendingStatus.status
        : "unknown",
    checkingPending,
    checkPendingStart: async () => {
      const version = ++pendingCheckVersion.current;
      setCheckingPending(true);
      const requestId = transport.pendingStart()?.requestId;
      try {
        const status = await transport.checkPendingStart();
        if (view.current.id !== selection.id || view.current.scope !== scope)
          return;
        setPendingStatus({
          id: selection.id,
          requestId,
          status: status === "missing" ? "missing" : "unknown",
        });
        if (status === "accepted") {
          refreshRecovery((value) => value + 1);
          setFailure(null);
          await chat.resumeStream();
        }
      } catch (error) {
        if (view.current.id === selection.id && view.current.scope === scope)
          reportFailure(error);
      } finally {
        if (pendingCheckVersion.current === version) setCheckingPending(false);
      }
    },
    retryPendingStart: async () => {
      if (
        pendingStatus.id !== selection.id ||
        pendingStatus.requestId !== transport.pendingStart()?.requestId ||
        pendingStatus.status !== "missing"
      )
        return;
      const version = ++pendingCheckVersion.current;
      setCheckingPending(true);
      try {
        await transport.retryPendingStart();
        if (view.current.id !== selection.id || view.current.scope !== scope)
          return;
        setPendingStatus({ id: selection.id, status: "unknown" });
        refreshRecovery((value) => value + 1);
        setFailure(null);
        await chat.resumeStream();
      } catch (error) {
        if (view.current.id === selection.id && view.current.scope === scope) {
          setPendingStatus({ id: selection.id, status: "unknown" });
          reportFailure(error);
        }
      } finally {
        if (pendingCheckVersion.current === version) setCheckingPending(false);
      }
    },
    stopPendingRecovery: async () => {
      if (
        pendingStatus.id !== selection.id ||
        pendingStatus.requestId !== transport.pendingStart()?.requestId ||
        pendingStatus.status !== "missing"
      )
        return;
      const version = ++pendingCheckVersion.current;
      setCheckingPending(true);
      try {
        const outcome = await transport.stopPendingRecovery();
        if (view.current.id !== selection.id || view.current.scope !== scope)
          return;
        setPendingStatus({ id: selection.id, status: "unknown" });
        refreshRecovery((value) => value + 1);
        setFailure(null);
        if (outcome === "accepted") await chat.resumeStream();
      } catch (error) {
        if (view.current.id === selection.id && view.current.scope === scope)
          reportFailure(error);
      } finally {
        if (pendingCheckVersion.current === version) setCheckingPending(false);
      }
    },
    send: async (text: string, analyze: boolean | "split" = false) => {
      if (readOnly) throw new Error("sample_read_only");
      const selectionVersion = choosing.current;
      sendFailed.current = false;
      setFailure(null);
      clearError();
      await chat.sendMessage(
        { text },
        {
          body: analyze
            ? {
                action: analyze === "split" ? "split" : "analyze",
              }
            : undefined,
        },
      );
      if (
        choosing.current !== selectionVersion ||
        view.current.id !== selection.id ||
        view.current.scope !== scope
      )
        throw new AiRequestError(latest.current.failureText, null);
      if (
        sendFailed.current ||
        (receivedPage.current?.session.id === selection.id &&
          ["failed", "interrupted"].includes(
            receivedPage.current.run?.status ?? "",
          ))
      )
        throw new AiRequestError(latest.current.failureText, null);
    },
    snapshot: visibleSnapshot,
    sessions:
      taskKind === "project_assistant" ? sessions : sessions.filter(inScope),
    sessionId: selection.id,
    failure,
    loading: listing || restoring,
    olderLoading,
    hasOlder: visibleSnapshot?.before != null,
    hasMoreSessions: sessionCursor != null,
    active:
      activeRun(visibleSnapshot?.run) ||
      chat.status === "submitted" ||
      chat.status === "streaming",
    loadOlder,
    loadSessions,
    selectSession,
    newSession,
    refresh,
    stop,
  };
}
