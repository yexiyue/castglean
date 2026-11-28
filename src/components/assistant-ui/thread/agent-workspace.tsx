import type { Interrupt } from "@ag-ui/core";
import {
  AssistantRuntimeProvider,
  AuiConfig,
  defineToolkit,
  type ThreadMessage,
  type ToolCallMessagePartProps,
  Tools,
  useAuiState,
} from "@assistant-ui/react";
import { useLingui } from "@lingui/react/macro";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { ErrorState } from "@/components/assistant-ui/elements/error-state";
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
import { CastingPlan } from "@/components/assistant-ui/tools/casting-plan";
import { ChapterAnalysisTask } from "@/components/assistant-ui/tools/chapter-analysis-task";
import { DelegatedToolCard } from "@/components/assistant-ui/tools/delegated-tool-card";
import {
  type DelegatedDomainContext,
  DelegatedToolContext,
  type DelegatedToolContextValue,
  DelegatedToolProvider,
} from "@/components/assistant-ui/tools/delegated-tool-context";
import {
  StartRecovered,
  StartRecovery,
} from "@/components/assistant-ui/tools/start-recovery";
import { SubagentMessages } from "@/components/assistant-ui/tools/subagent-messages";
import { parseToolResult } from "@/components/assistant-ui/tools/tool-result";
import { Button } from "@/components/ui/button";
import type { useAiSession } from "@/hooks/use-ai-session";
import type { Invocation } from "@/lib/bindings";

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
  castingPlans: ReturnType<typeof castingPlans>;
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
  onReview?: DelegatedToolContextValue["onReview"];
  /** Domain registries and callbacks the in-card result surfaces call. */
  domain?: DelegatedDomainContext;
  chapterTitle?: (chapterId: string) => string | undefined;
  /** Empty-thread content (guidance, quick actions) replacing the default welcome. */
  welcome?: ReactNode;
  afterMessages?: ReactNode;
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
  domain,
  chapterTitle,
  welcome,
  afterMessages,
  composer,
}: Props) {
  const plans = useMemo(() => castingPlans(ai.snapshot), [ai.snapshot]);
  const workspace = useMemo<WorkspaceValue>(
    () => ({
      ai,
      castingPlans: plans,
      projectId,
      retryDisabled,
      chapterTitle,
    }),
    [ai, plans, projectId, retryDisabled, chapterTitle],
  );
  const toolContext: DelegatedToolContextValue = useMemo(
    () => ({ projectId, version: resultVersion, onReview, ...domain }),
    [projectId, resultVersion, onReview, domain],
  );
  return (
    <AssistantRuntimeProvider runtime={ai.runtime} config={toolConfig}>
      <AgentWorkspaceContext.Provider value={workspace}>
        <DelegatedToolProvider value={toolContext}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Thread
              autoFocus={false}
              afterMessages={afterMessages}
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
  const byId = new Map<string, ThreadMessage>();
  function visit(messages: readonly ThreadMessage[]) {
    for (const message of messages) {
      if (byId.has(message.id)) continue;
      byId.set(message.id, message);
      for (const part of message.content) {
        if (part.type === "tool-call" && part.messages) visit(part.messages);
      }
    }
  }
  visit(nested);
  visit(threadMessages);
  const transcript = new Map<string, ThreadMessage>();
  for (const record of records) {
    // assistant-ui projects anchored messages with the invocation ID.
    const message = byId.get(record.id) ?? byId.get(record.subagentRunId ?? "");
    if (message) transcript.set(message.id, message);
  }
  return [...transcript.values()];
}

function AnalysisMessages({
  messages,
  task,
}: {
  messages: readonly ThreadMessage[];
  task?: Invocation;
}) {
  const { ai } = useWorkspace();
  const { t } = useLingui();
  const records = ai.snapshot?.records ?? [];
  const reviewIds = new Set(
    ai.snapshot?.invocations
      .filter((item) => item.name === "review" && item.parentId === task?.id)
      .map((item) => item.id),
  );
  const reviewMessages = new Set(
    records
      .filter(
        (record) => record.subagentRunId && reviewIds.has(record.subagentRunId),
      )
      .map((record) => record.id),
  );
  return (
    <SubagentMessages
      messages={messages}
      showIndicator={false}
      author={(message) =>
        reviewMessages.has(message.id) || reviewIds.has(message.id)
          ? t({
              message: "归属预审",
              comment:
                "Name of the read-only chapter attribution review subagent.",
            })
          : t`章节分析`
      }
    />
  );
}

function hasSubagentReply(messages: readonly ThreadMessage[] | undefined) {
  return (
    messages?.some(
      (message) =>
        message.role === "assistant" &&
        message.content.some(
          (part) => part.type === "text" && !!part.text.trim(),
        ),
    ) ?? false
  );
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
      hasReply={hasSubagentReply(transcript)}
    >
      {transcript?.length ? (
        <AnalysisMessages messages={transcript} task={task} />
      ) : null}
    </ChapterAnalysisTask>
  );
}

function DirectChapterAnalysis({
  task,
  transcript,
}: {
  task: Invocation;
  transcript?: readonly ThreadMessage[];
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
      hasReply={hasSubagentReply(transcript)}
    >
      {transcript?.length ? (
        <AnalysisMessages messages={transcript} task={task} />
      ) : null}
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
  const { ai, projectId, castingPlans: plans } = useWorkspace();
  const { t } = useLingui();
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
      <DirectChapterAnalysis
        key={analysisTask.id}
        task={analysisTask}
        transcript={transcript}
      />
    );
  }

  const toolResultIds = new Set(
    Object.values(record?.tools ?? {}).map(({ id }) => id),
  );
  const message = threadMessages.find((item) => item.id === messageId);
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

  const casting = plans.filter((plan) => plan.anchor === messageId);
  const owner = snapshot?.invocations.find(
    (task) => task.id === record?.subagentRunId,
  );
  const author =
    owner?.name === "chapter_splitting"
      ? t`检查全书分章`
      : owner?.name === "casting"
        ? t`工程选角建议`
        : undefined;
  const professionalActive =
    ai.active &&
    snapshot?.invocations.some(
      (task) => task.runId === snapshot.run?.id && task.status === "running",
    );
  return (
    <ThreadAssistantMessage
      author={author}
      hiddenToolCallIds={cardToolIds}
      showIndicator={!!author || !professionalActive}
      artifacts={
        casting.length > 0 || results.length > 0 ? (
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            {casting.map((plan) => (
              <CastingPlanInWorkspace key={plan.key} plan={plan} />
            ))}
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
        ) : null
      }
    />
  );
}

function castingPlans(snapshot: Ai["snapshot"]) {
  if (!snapshot) return [];
  const interrupt = (snapshot.interrupts as readonly Interrupt[]).find(
    (item) => item.reason === "casting_audition_approval",
  );
  const tasks = snapshot.invocations.filter((task) => task.name === "casting");
  const pendingTask = interrupt
    ? (tasks.find((task) => task.id === interrupt.subagentRunId) ??
      tasks.find((task) => task.runId === snapshot.run?.id))
    : undefined;
  const plans = tasks.map((task) => {
    const records = snapshot.records.filter(
      (row) => row.subagentRunId === task.id,
    );
    return {
      key: task.id,
      anchor: task.messageId ?? records.at(0)?.id,
      status: task.status,
      progress: task.castingProgress ?? undefined,
      published: records.some((row) =>
        row.results.some(
          (reference) => reference.kind === "casting_suggestion",
        ),
      ),
      interrupt: pendingTask === task ? interrupt : undefined,
      active: task.runId === snapshot.run?.id,
    };
  });
  if (interrupt && !pendingTask) {
    plans.push({
      key: interrupt.id,
      anchor: undefined,
      status: snapshot.run?.status ?? "queued",
      progress: undefined,
      published: false,
      interrupt,
      active: true,
    });
  }
  return plans;
}

function answersBlocked(ai: Ai, retryDisabled?: boolean) {
  return (
    ai.pendingStart ||
    !!ai.recoveredStart ||
    ai.loading ||
    ai.readFailure ||
    !!retryDisabled
  );
}

function CastingPlanInWorkspace({
  plan,
}: {
  plan: ReturnType<typeof castingPlans>[number];
}) {
  const { ai, projectId, retryDisabled } = useWorkspace();
  return (
    <CastingPlan
      answerTarget={
        plan.interrupt ? `agent-answers-${ai.sessionId}-casting` : undefined
      }
      projectId={projectId}
      status={plan.status}
      progress={plan.progress}
      published={plan.published}
      interrupt={plan.interrupt}
      blocked={answersBlocked(ai, retryDisabled)}
      accept={ai.acceptAnswers}
    />
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
  const { t } = useLingui();
  const { ai, projectId, retryDisabled, castingPlans: plans } = useWorkspace();
  const [acting, setActing] = useState(false);
  const casting =
    plans.find((plan) => plan.interrupt) ?? plans.find((plan) => plan.active);
  const hasCastingAnchor = useAuiState(
    (state) =>
      !!casting?.anchor &&
      state.thread.messages.some((message) => message.id === casting.anchor),
  );
  const questions =
    (ai.snapshot?.interrupts as readonly Interrupt[] | undefined)?.filter(
      (item) => item.id !== casting?.interrupt?.id,
    ) ?? [];
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
  const failed = ai.failure || ai.readFailure;
  return (
    <div className="flex min-w-0 flex-col gap-3 py-3 empty:hidden">
      {startingAnalysis ? (
        <DirectChapterAnalysis
          key={startingAnalysis.id}
          task={startingAnalysis}
        />
      ) : null}
      {casting && !hasCastingAnchor && (
        <CastingPlanInWorkspace key={casting.key} plan={casting} />
      )}
      {questions.length > 0 ? (
        <AgentQuestionGroup
          key={ai.sessionId}
          projectId={projectId}
          sessionId={ai.sessionId}
          interrupts={questions}
          blocked={answersBlocked(ai, retryDisabled)}
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
        <ErrorState
          title={
            ai.readFailure
              ? t`会话读取未完成，已有内容可能过时。`
              : (ai.failure?.message ?? "")
          }
          retryLabel={ai.readFailure ? t`重新读取会话` : t`重试执行`}
          retrying={acting}
          disabled={
            !ai.readFailure && (retryDisabled || ai.pendingStart || ai.loading)
          }
          onRetry={() =>
            void act(ai.readFailure ? () => ai.refresh() : ai.chat.regenerate)
          }
        />
      ) : null}
    </div>
  );
}
