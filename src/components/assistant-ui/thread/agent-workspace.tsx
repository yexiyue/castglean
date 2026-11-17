import {
  AssistantRuntimeProvider,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  Thread,
  ThreadAssistantMessage,
} from "@/components/assistant-ui/elements/thread.aui";
import { AgentQuestionGroup } from "@/components/assistant-ui/tools/agent-question-group";
import { AgentResult } from "@/components/assistant-ui/tools/agent-result";
import { AgentToolUI } from "@/components/assistant-ui/tools/agent-tool-ui";
import {
  DelegatedToolContext,
  type DelegatedToolContextValue,
  DelegatedToolProvider,
} from "@/components/assistant-ui/tools/delegated-tool-card";
import {
  StartRecovered,
  StartRecovery,
} from "@/components/assistant-ui/tools/start-recovery";
import { Button } from "@/components/ui/button";
import type { useAiSession } from "@/hooks/use-ai-session";
import type { ResultReference, WorkspaceContext } from "@/lib/bindings";

type Ai = ReturnType<typeof useAiSession>;

type WorkspaceValue = {
  ai: Ai;
  projectId: string;
  retryDisabled?: boolean;
  contextLabel?: (context: WorkspaceContext) => string;
  onScopeSelect?: (chapterId: string) => void;
};

/**
 * Thread slot components take no props, so live session state reaches them
 * through this context instead of prop drilling.
 */
const AgentWorkspaceContext = createContext<WorkspaceValue | null>(null);

function useWorkspace(): WorkspaceValue {
  const value = useContext(AgentWorkspaceContext);
  if (!value) throw new Error("AgentWorkspaceContext is missing");
  return value;
}

type Props = {
  ai: Ai;
  projectId: string;
  /** Bump to revalidate mutable adoption state after workspace returns. */
  resultVersion?: string;
  retryDisabled?: boolean;
  onReview?: (reference: ResultReference) => void;
  /** Labels each message's frozen run context; omitting hides the chip. */
  contextLabel?: (context: WorkspaceContext) => string;
  /** Clicking a chapter-scoped chip navigates there. */
  onScopeSelect?: (chapterId: string) => void;
  /** Empty-thread content (guidance, quick actions) replacing the default welcome. */
  welcome?: ReactNode;
};

/**
 * Mount layer for one AG-UI agent conversation: runtime provider, compact
 * session list, and the assistant-ui Thread. Message rendering — tool cards,
 * reasoning, subagent nesting — lives in the Thread and its tool slots; this
 * module only wires host state into them. The composer stays hidden: the
 * host mounts its own input bar below this component.
 */
export function AgentWorkspace({
  ai,
  projectId,
  resultVersion,
  retryDisabled,
  onReview,
  contextLabel,
  onScopeSelect,
  welcome,
}: Props) {
  const workspace = useMemo<WorkspaceValue>(
    () => ({ ai, projectId, retryDisabled, contextLabel, onScopeSelect }),
    [ai, projectId, retryDisabled, contextLabel, onScopeSelect],
  );
  const toolContext: DelegatedToolContextValue = useMemo(
    () => ({ projectId, version: resultVersion, onReview }),
    [projectId, resultVersion, onReview],
  );
  return (
    <AssistantRuntimeProvider runtime={ai.runtime}>
      <AgentWorkspaceContext.Provider value={workspace}>
        <DelegatedToolProvider value={toolContext}>
          <div className="flex min-h-0 flex-1 flex-col">
            <SessionList />
            <Thread
              autoFocus={false}
              components={{
                ToolFallback: AgentToolUI,
                AssistantMessage: AssistantMessageWithResults,
                EarlierLoader: ThreadEarlierLoader,
                Trailing: ThreadTrailing,
                Composer: null,
                ...(welcome !== undefined ? { Welcome: welcome } : {}),
              }}
            />
          </div>
        </DelegatedToolProvider>
      </AgentWorkspaceContext.Provider>
    </AssistantRuntimeProvider>
  );
}

/**
 * Default assistant message plus the typed result references and the run
 * context chip the host record carries for that message. Quick-entry
 * professional tasks start without a delegated tool call, so their results
 * surface here rather than in a tool card.
 */
function AssistantMessageWithResults() {
  const { ai, projectId, contextLabel, onScopeSelect } = useWorkspace();
  const messageId = useAuiState((s) => s.message.id);
  const record = ai.snapshot?.records.find((item) => item.id === messageId);
  const toolContext = useContext(DelegatedToolContext);
  const results = record?.results ?? [];
  const snapshot = ai.snapshot;
  const context =
    record && snapshot
      ? (snapshot.contexts?.[record.runId ?? ""] ??
        (snapshot.run && snapshot.run.id === record.runId
          ? snapshot.run.workspaceContext
          : null))
      : null;
  const label = context && contextLabel ? contextLabel(context) : null;
  const chapterId =
    context && context.action !== "split" ? context.chapterId : null;
  return (
    <>
      <ThreadAssistantMessage />
      {label != null ? (
        <div className="ps-2 pb-1">
          {chapterId && onScopeSelect ? (
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0 text-xs"
              onClick={() => onScopeSelect(chapterId)}
            >
              {label}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{label}</p>
          )}
        </div>
      ) : null}
      {results.length > 0 ? (
        <div className="flex flex-col gap-1 ps-2 pb-1">
          {results.map((reference) => (
            <AgentResult
              key={reference.id}
              projectId={projectId}
              version={toolContext?.version}
              reference={reference}
              onReview={toolContext?.onReview}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Loads the page of messages before the restored window (host-side paging). */ function ThreadEarlierLoader() {
  const { ai } = useWorkspace();
  const { t } = useLingui();
  if (!ai.hasOlder) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      data-slot="agent-load-earlier"
      className="mb-6 self-center rounded-full text-muted-foreground"
      disabled={ai.olderLoading}
      onClick={() => void ai.loadOlder()}
    >
      {ai.olderLoading ? t`正在加载更早的消息…` : t`加载更早的消息`}
    </Button>
  );
}

/** End-of-flow zone: pending answers, recovery, failures, retry. */
function ThreadTrailing() {
  const { ai, projectId, retryDisabled } = useWorkspace();
  const [acting, setActing] = useState(false);
  const questions = ai.snapshot?.interrupts ?? [];
  const run = ai.snapshot?.run;
  const taskOwnsStop =
    ["queued", "running", "cancelling"].includes(run?.status ?? "") &&
    (ai.snapshot?.invocations ?? []).some(
      (invocation) => !invocation.parentId && invocation.runId === run?.id,
    );
  async function act(operation: () => Promise<void>) {
    setActing(true);
    try {
      await operation();
    } finally {
      setActing(false);
    }
  }
  const failed = ai.failure || ai.readFailure;
  return (
    <div className="flex flex-col gap-2">
      {taskOwnsStop ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          data-action="agent-stop"
          disabled={acting || run?.status === "cancelling"}
          onClick={() => void act(ai.stop)}
        >
          {run?.status === "cancelling" ? (
            <Trans>正在停止</Trans>
          ) : (
            <Trans>停止</Trans>
          )}
        </Button>
      ) : null}
      {questions.length > 0 ? (
        <AgentQuestionGroup
          key={ai.sessionId}
          projectId={projectId}
          sessionId={ai.sessionId}
          interrupts={questions}
          blocked={
            ai.pendingStart ||
            !!ai.recoveredStart ||
            ai.loading ||
            ai.readFailure ||
            !!retryDisabled
          }
          accept={ai.acceptAnswers}
        />
      ) : null}
      {ai.pendingStart ? (
        <StartRecovery
          busy={ai.checkingPending}
          missing={ai.pendingStatus === "missing"}
          onCheck={() => void ai.checkPendingStart()}
          onRetry={() => void ai.retryPendingStart()}
          onStop={() => void ai.stopPendingRecovery()}
        />
      ) : ai.recoveredStart ? (
        <StartRecovered
          outcome={ai.recoveredStart}
          onAcknowledge={ai.acknowledgeRecoveredStart}
        />
      ) : null}
      {failed ? (
        <div className="flex flex-col items-start gap-1.5">
          <p role="alert" className="text-xs text-destructive">
            {ai.readFailure ? (
              <Trans>会话读取未完成，已有内容可能过时。</Trans>
            ) : (
              (ai.failure?.message ?? "")
            )}
          </p>
          {ai.readFailure ? (
            <Button
              size="sm"
              variant="outline"
              disabled={acting}
              onClick={() => void act(() => ai.refresh())}
            >
              <Trans>重新读取会话</Trans>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={
                acting || retryDisabled || ai.pendingStart || ai.loading
              }
              onClick={() => void act(ai.chat.regenerate)}
            >
              <Trans>重试执行</Trans>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Keep saved conversations reachable while composing an unsaved session. */
function SessionList() {
  const { ai } = useWorkspace();
  const count = useAuiState((s) => s.threads.threadIds.length);
  const isLoading = useAuiState((s) => s.threads.isLoading);
  const selectedIsSaved = ai.sessions.some(
    (session) => session.id === ai.sessionId,
  );
  if (
    isLoading ||
    (!ai.hasMoreSessions && (count === 0 || (count === 1 && selectedIsSaved)))
  )
    return null;
  return (
    <div
      data-slot="agent-session-list"
      className="shrink-0 border-b px-2 py-1.5"
    >
      <p className="pb-1 text-xs font-medium text-muted-foreground">
        <Trans>会话</Trans>
      </p>
      <div className="max-h-44 overflow-y-auto overscroll-contain">
        <ThreadListPrimitive.Root asChild>
          <div className="flex flex-col">
            <ThreadListPrimitive.Items>
              {() => <SessionListItem />}
            </ThreadListPrimitive.Items>
          </div>
        </ThreadListPrimitive.Root>
        {ai.hasMoreSessions ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5 w-full justify-start text-xs text-muted-foreground"
            onClick={() => void ai.loadSessions()}
          >
            <Trans>读取更多会话</Trans>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SessionListItem() {
  const isRunning = useAuiState((s) => s.threadListItem.isRunning);
  return (
    <ThreadListItemPrimitive.Root asChild>
      <ThreadListItemPrimitive.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-start text-xs transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-current:bg-accent"
        >
          <span
            className={
              isRunning
                ? "size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
                : "size-1.5 shrink-0"
            }
          />
          <span className="min-w-0 flex-1 truncate wrap-anywhere">
            <ThreadListItemPrimitive.Title />
          </span>
        </button>
      </ThreadListItemPrimitive.Trigger>
    </ThreadListItemPrimitive.Root>
  );
}
