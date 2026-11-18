import {
  AssistantRuntimeProvider,
  AuiConfig,
  defineToolkit,
  type ThreadMessage,
  type ToolCallMessagePartProps,
  Tools,
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
import {
  AgentToolUI,
  SplitProposalTool,
} from "@/components/assistant-ui/tools/agent-tool-ui";
import { ChapterAnalysisTask } from "@/components/assistant-ui/tools/chapter-analysis-task";
import {
  DelegatedToolCard,
  DelegatedToolContext,
  type DelegatedToolContextValue,
  DelegatedToolProvider,
} from "@/components/assistant-ui/tools/delegated-tool-card";
import {
  StartRecovered,
  StartRecovery,
} from "@/components/assistant-ui/tools/start-recovery";
import { SubagentMessages } from "@/components/assistant-ui/tools/subagent-messages";
import { parseToolResult } from "@/components/assistant-ui/tools/tool-result";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import type { useAiSession } from "@/hooks/use-ai-session";
import type { Invocation, ResultReference } from "@/lib/bindings";

const toolConfig = AuiConfig({
  tools: Tools({
    toolkit: defineToolkit({
      finish_splitting: {
        type: "backend",
        render: SplitProposalTool,
        display: "standalone",
      },
      analyze_chapter: {
        type: "backend",
        render: ChapterAnalysisTool,
        display: "standalone",
      },
      check_splitting: {
        type: "backend",
        render: DelegatedToolCard,
        display: "standalone",
      },
    }),
  }),
});

type Ai = ReturnType<typeof useAiSession>;

type WorkspaceValue = {
  ai: Ai;
  projectId: string;
  retryDisabled?: boolean;
  chapterTitle?: (chapterId: string) => string | undefined;
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
  chapterTitle?: (chapterId: string) => string | undefined;
  /** Empty-thread content (guidance, quick actions) replacing the default welcome. */
  welcome?: ReactNode;
  composer?: ReactNode;
};

/**
 * Mount layer for one AG-UI agent conversation: runtime provider and
 * assistant-ui Thread. Message rendering — tool cards,
 * reasoning, subagent nesting — lives in the Thread and its tool slots; this
 * module wires host state and the host composer into the thread.
 */
export function AgentWorkspace({
  ai,
  projectId,
  resultVersion,
  retryDisabled,
  onReview,
  chapterTitle,
  welcome,
  composer,
}: Props) {
  const workspace = useMemo<WorkspaceValue>(
    () => ({
      ai,
      projectId,
      retryDisabled,
      chapterTitle,
    }),
    [ai, projectId, retryDisabled, chapterTitle],
  );
  const toolContext: DelegatedToolContextValue = useMemo(
    () => ({ projectId, version: resultVersion, onReview }),
    [projectId, resultVersion, onReview],
  );
  return (
    <AssistantRuntimeProvider runtime={ai.runtime} config={toolConfig}>
      <AgentWorkspaceContext.Provider value={workspace}>
        <DelegatedToolProvider value={toolContext}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Thread
              autoFocus={false}
              composer={composer}
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

function analysisContext(
  snapshot: Ai["snapshot"],
  runId: string | null | undefined,
) {
  if (!runId || !snapshot) return undefined;
  return (
    snapshot.contexts?.[runId] ??
    (snapshot.run?.id === runId ? snapshot.run.workspaceContext : undefined)
  );
}

type MessageRecord = NonNullable<Ai["snapshot"]>["records"][number];

function ownsAnalysisRecord(
  snapshot: NonNullable<Ai["snapshot"]>,
  task: Invocation,
  record: MessageRecord,
) {
  return (
    record.runId === task.runId &&
    (record.subagentRunId === task.id ||
      snapshot.invocations.some(
        (child) =>
          child.id === record.subagentRunId &&
          child.runId === task.runId &&
          child.parentId === task.id,
      ))
  );
}

function analysisTranscript(
  snapshot: NonNullable<Ai["snapshot"]>,
  task: Invocation,
  threadMessages: readonly ThreadMessage[],
  nested: readonly ThreadMessage[] = [],
) {
  const records = snapshot.records.filter((record) =>
    ownsAnalysisRecord(snapshot, task, record),
  );
  const byId = new Map(
    [...threadMessages, ...nested].map((message) => [message.id, message]),
  );
  return records.flatMap((record) => {
    const message = byId.get(record.id);
    return message ? [message] : [];
  });
}

function ChapterAnalysisTool(part: ToolCallMessagePartProps) {
  const { ai, chapterTitle } = useWorkspace();
  const messageId = useAuiState((state) => state.message.id);
  const threadMessages = useAuiState((state) => state.thread.messages);
  const snapshot = ai.snapshot;
  const record = snapshot?.records.find((item) => item.id === messageId);
  const task = snapshot?.invocations.find(
    (item) =>
      item.name === "chapter_analysis" &&
      item.runId === record?.runId &&
      item.messageId === messageId &&
      item.toolCallId === part.toolCallId,
  );
  const runId = task?.runId ?? record?.runId;
  const frozenChapter = analysisContext(snapshot, runId)?.chapterId;
  const toolRef = part.isError
    ? undefined
    : parseToolResult(part.result)?.reference;
  const reference =
    (toolRef?.kind === "chapter_analysis" ? toolRef : undefined) ??
    (task
      ? snapshot?.records
          .find(
            (item) =>
              item.runId === task.runId &&
              item.subagentRunId === task.id &&
              item.results.some((result) => result.kind === "chapter_analysis"),
          )
          ?.results.find((result) => result.kind === "chapter_analysis")
      : undefined);
  const run =
    snapshot?.run?.id === runId
      ? snapshot?.run
      : snapshot?.runs?.find((item) => item.id === runId);
  const transcript =
    snapshot && task
      ? analysisTranscript(snapshot, task, threadMessages, part.messages)
      : part.messages;
  return (
    <ChapterAnalysisTask
      key={task?.id ?? part.toolCallId}
      task={task}
      runId={runId ?? undefined}
      chapterTitle={frozenChapter ? chapterTitle?.(frozenChapter) : undefined}
      sequence={snapshot?.session.sequence}
      runStatus={part.isError ? "failed" : run?.status}
      reference={reference}
    >
      {transcript?.length ? <SubagentMessages messages={transcript} /> : null}
    </ChapterAnalysisTask>
  );
}

function DirectChapterAnalysis({
  task,
  children,
}: {
  task: Invocation;
  children?: ReactNode;
}) {
  const { ai, chapterTitle } = useWorkspace();
  const snapshot = ai.snapshot;
  const frozenChapter = analysisContext(snapshot, task.runId)?.chapterId;
  const reference = snapshot?.records
    .filter(
      (record) =>
        record.runId === task.runId && record.subagentRunId === task.id,
    )
    .flatMap((record) => record.results)
    .find((item) => item.kind === "chapter_analysis");
  return (
    <ChapterAnalysisTask
      task={task}
      runId={task.runId}
      chapterTitle={frozenChapter ? chapterTitle?.(frozenChapter) : undefined}
      sequence={snapshot?.session.sequence}
      runStatus={
        snapshot?.run?.id === task.runId ? snapshot.run.status : undefined
      }
      reference={reference}
    >
      {children}
    </ChapterAnalysisTask>
  );
}

// Snapshot replay can leave copies of the same tool call in a top-level
// message. Exclude only IDs that the analysis card actually renders.
function analysisCardToolIds(
  snapshot: NonNullable<Ai["snapshot"]>,
  threadMessages: readonly ThreadMessage[],
) {
  const ids = new Set<string>();
  for (const task of snapshot.invocations) {
    if (task.name !== "chapter_analysis") continue;
    const parent = threadMessages.find(
      (message) => message.id === task.messageId,
    );
    const delegation = parent?.content.find(
      (part) =>
        part.type === "tool-call" && part.toolCallId === task.toolCallId,
    );
    const transcript = analysisTranscript(
      snapshot,
      task,
      threadMessages,
      delegation?.type === "tool-call" ? delegation.messages : undefined,
    );
    for (const message of transcript) {
      for (const part of message.content) {
        if (part.type === "tool-call") ids.add(part.toolCallId);
      }
    }
  }
  return ids;
}

/** Renders task-owned messages together and leaves ordinary replies in the thread. */
function AssistantMessageWithResults() {
  const { ai, projectId } = useWorkspace();
  const messageId = useAuiState((s) => s.message.id);
  const threadMessages = useAuiState((s) => s.thread.messages);
  const toolContext = useContext(DelegatedToolContext);
  const snapshot = ai.snapshot;
  const record = snapshot?.records.find((item) => item.id === messageId);
  const analysisTask =
    snapshot && record?.subagentRunId
      ? snapshot.invocations.find(
          (task) =>
            task.name === "chapter_analysis" &&
            ownsAnalysisRecord(snapshot, task, record),
        )
      : undefined;

  if (snapshot && analysisTask) {
    const hasDelegatingTool = threadMessages.some(
      (message) =>
        message.id === analysisTask.messageId &&
        message.content.some(
          (part) =>
            part.type === "tool-call" &&
            part.toolName === "analyze_chapter" &&
            part.toolCallId === analysisTask.toolCallId,
        ),
    );
    if (hasDelegatingTool) return null;

    const transcript = analysisTranscript(
      snapshot,
      analysisTask,
      threadMessages,
    );
    if (transcript[0]?.id !== messageId) return null;
    return (
      <DirectChapterAnalysis key={analysisTask.id} task={analysisTask}>
        <SubagentMessages messages={transcript} />
      </DirectChapterAnalysis>
    );
  }

  const toolResultIds = new Set(
    Object.values(record?.tools ?? {}).map(({ id }) => id),
  );
  const castingTask = snapshot?.invocations.find(
    (task) => task.name === "casting" && task.id === record?.subagentRunId,
  );
  const castingResultHasParent = threadMessages.some(
    (item) => item.id === castingTask?.messageId && item.id !== messageId,
  );
  const castingTasks = new Set(
    snapshot?.invocations
      .filter((task) => task.name === "casting" && task.messageId === messageId)
      .map((task) => task.id),
  );
  const castingResults = (snapshot?.records ?? [])
    .filter(
      (item) =>
        item.id !== messageId &&
        item.subagentRunId &&
        castingTasks.has(item.subagentRunId),
    )
    .flatMap((item) => item.results)
    .filter((reference) => reference.kind === "casting_suggestion");
  const ownResults = (record?.results ?? []).filter(({ kind, id }) => {
    if (kind === "casting_suggestion" && castingResultHasParent) return false;
    return kind !== "chapter_split_proposal" || !toolResultIds.has(id);
  });
  const results = Array.from(
    new Map(
      [...ownResults, ...castingResults].map((item) => [item.id, item]),
    ).values(),
  );
  const message = threadMessages.find((item) => item.id === messageId);
  const hasTools = message?.content.some((part) => part.type === "tool-call");
  const cardToolIds =
    snapshot && hasTools
      ? analysisCardToolIds(snapshot, threadMessages)
      : undefined;
  if (
    results.length === 0 &&
    message?.content.length &&
    message.content.every(
      (part) => part.type === "tool-call" && cardToolIds?.has(part.toolCallId),
    )
  )
    return null;

  return (
    <>
      <ThreadAssistantMessage hiddenToolCallIds={cardToolIds} />
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
  async function act(operation: () => Promise<void>) {
    setActing(true);
    try {
      await operation();
    } finally {
      setActing(false);
    }
  }
  const startingAnalysis = ai.snapshot?.invocations.find(
    (task) =>
      task.runId === ai.snapshot?.run?.id &&
      task.name === "chapter_analysis" &&
      !task.toolCallId &&
      !ai.snapshot?.records.some(
        (record) =>
          record.subagentRunId === task.id && record.runId === task.runId,
      ),
  );
  const casting = ai.snapshot?.castingProgress;
  const failed = ai.failure || ai.readFailure;
  return (
    <div className="flex flex-col gap-2">
      {startingAnalysis ? (
        <DirectChapterAnalysis
          key={startingAnalysis.id}
          task={startingAnalysis}
        />
      ) : null}
      {casting && casting.total > 0 ? (
        <div role="status" className="space-y-2 px-4 py-3">
          <Progress value={casting.finished} max={casting.total}>
            <ProgressLabel>
              {casting.finished < casting.total ? (
                <Trans>正在生成试听</Trans>
              ) : (
                <Trans>正在整理选角建议</Trans>
              )}
            </ProgressLabel>
            <span
              aria-hidden
              className="ml-auto text-xs text-muted-foreground tabular-nums"
            >
              {casting.finished} / {casting.total}
            </span>
          </Progress>
          {casting.failed > 0 ? (
            <p className="text-xs text-muted-foreground">
              <Trans>{casting.failed} 条试听未能生成</Trans>
            </p>
          ) : null}
        </div>
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
