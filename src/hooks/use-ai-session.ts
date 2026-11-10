import { useChat } from "@ai-sdk/react";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeRun, aiMessages } from "@/lib/ai/stream";
import {
  AiRequestError,
  AiTransport,
  type ModelBinding,
} from "@/lib/ai/transport";
import type { HistoryPage, SessionCursor, SessionInfo } from "@/lib/bindings";
import { commands } from "@/lib/bindings";

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
  const scope = JSON.stringify([projectId, taskKind, chapterId]);
  const initial = useMemo(
    () => ({ scope, id: crypto.randomUUID(), known: false }),
    [scope],
  );
  const initialId = initial.id;
  const [selected, setSelected] = useState<{
    scope: string;
    id: string;
    known: boolean;
  }>(initial);
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
  const latest = useRef({ binding, failureText, title, prepareRevision });
  latest.current = { binding, failureText, title, prepareRevision };
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
          await commands.aiSessionCreate({
            id: selection.id,
            projectId,
            taskKind,
            chapterId,
            title:
              [...text.replace(/\s+/g, " ").trim()].slice(0, 80).join("") ||
              latest.current.title,
          });
          return commands.aiHistory(selection.id, null, 20);
        },
        (request, analyze) =>
          taskKind === "chapter_analysis" && analyze
            ? commands.chapterAnalysisStart(request)
            : commands.aiStart(request),
        taskKind === "chapter_analysis" || taskKind === "project_assistant"
          ? async () =>
              latest.current.prepareRevision
                ? latest.current.prepareRevision()
                : (latest.current.binding()?.expectedProjectRevision ?? 0)
          : undefined,
      ),
    [selection.id, projectId, taskKind, chapterId],
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
    if (!isTauri()) {
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
            id: page.sessions.find(inScope)?.id ?? initialId,
            known: page.sessions.some(inScope),
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
  ]);

  useEffect(() => {
    let mounted = true;
    transport.activate();
    clearError();
    if (selection.known && isTauri()) {
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
  ]);

  async function loadOlder() {
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
    if (!sessionCursor) return;
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
    try {
      await chat.resumeStream();
    } catch (error) {
      reportFailure(error);
    }
  }
  async function stop() {
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
    send: async (text: string, analyze: boolean | "split" = false) => {
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
