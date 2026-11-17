import { AbstractAgent } from "@ag-ui/client";
import {
  type BaseEvent,
  EventType,
  type Message,
  type RunAgentInput,
  type SubagentErrorEvent,
  type SubagentFinishedEvent,
  type SubagentStartedEvent,
} from "@ag-ui/core";
import { Channel } from "@tauri-apps/api/core";
import { Observable } from "rxjs";
import type {
  AgentFrame,
  AgentPage,
  AiError,
  Configuration,
  RunInfo,
  WorkspaceContext,
} from "../bindings";
import { commands } from "../bindings";
import type { AgentStart, PendingAiStarts } from "./pending-starts";

export type ModelBinding = {
  configuration: Configuration;
  confirmRebind: boolean;
  expectedProjectRevision: number;
  workspaceContext?: WorkspaceContext | null;
};
export function activeRun(run: RunInfo | null | undefined): boolean {
  return !!run && ["queued", "running", "cancelling"].includes(run.status);
}

/** The newer projection wins; identities outside its bounded window stay loaded. */
function mergeById<T extends { id: string }>(earlier: T[], newer: T[]): T[] {
  const updated = new Set(newer.map((value) => value.id));
  return [...earlier.filter((value) => !updated.has(value.id)), ...newer];
}

function insertBeforeId<T extends { id: string }>(
  history: T[],
  loaded: T[],
  anchor: string | undefined,
): T[] {
  const loadedById = new Map(loaded.map((value) => [value.id, value]));
  const historyIds = new Set(history.map((value) => value.id));
  const remaining = loaded.filter((value) => !historyIds.has(value.id));
  const position = Math.max(
    0,
    remaining.findIndex((value) => value.id === anchor),
  );
  return [
    ...remaining.slice(0, position),
    ...history.map((value) => loadedById.get(value.id) ?? value),
    ...remaining.slice(position),
  ];
}

function mergeHistory(earlier: AgentPage | null, newer: AgentPage): AgentPage {
  if (!earlier || earlier.session.id !== newer.session.id) return newer;
  const loadedIds = new Set(
    (earlier.messages as Message[]).map((message) => message.id),
  );
  const disjointWindow =
    newer.messages.length > 0 &&
    !(newer.messages as Message[]).some((message) => loadedIds.has(message.id));
  let before: AgentPage["before"] = null;
  if (newer.before != null) {
    if (disjointWindow) before = newer.before;
    else if (earlier.before != null)
      before = Math.min(earlier.before, newer.before);
  }
  return {
    ...newer,
    messages: mergeById(
      earlier.messages as Message[],
      newer.messages as Message[],
    ),
    records: mergeById(earlier.records, newer.records),
    runs: mergeById(earlier.runs, newer.runs),
    invocations: mergeById(earlier.invocations, newer.invocations),
    contexts: { ...earlier.contexts, ...newer.contexts },
    before,
  };
}

export class AiRequestError extends Error {
  sessionId?: string;
  readonly detail: AiError | null;
  constructor(message: string, detail: unknown) {
    super(message);
    const known: string[] = [
      "invalid_request",
      "not_found",
      "conflict",
      "busy",
      "configuration_changed",
      "configuration_unavailable",
      "budget_exhausted",
      "storage_failed",
    ];
    this.detail =
      typeof detail === "string" && known.includes(detail)
        ? (detail as AiError)
        : null;
  }
}

type Options = {
  sessionId: string;
  binding: () => ModelBinding | null;
  revision: () => Promise<number>;
  ensureSession: (text: string) => Promise<void>;
  onPage: (page: AgentPage) => void;
  failureText: () => string;
  onResync: () => void;
  onStopError?: (error: unknown) => void;
  pending: PendingAiStarts;
  start: (request: AgentStart) => Promise<RunInfo>;
};

/** IPC agent: observable teardown only detaches. Explicit stop is a separate command. */
export class DesktopAgent extends AbstractAgent {
  private page: AgentPage | null = null;
  private detach: (() => void) | undefined;
  private starting: Promise<RunInfo> | undefined;
  private submission:
    | { resolve: (run: RunInfo) => void; reject: (error: unknown) => void }
    | undefined;
  private stopRequested = false;
  private cancelling: { id: string; promise: Promise<RunInfo> } | undefined;
  private intent: "message" | "retry" | "analyze" | "split" = "message";
  private historyAnchor:
    | { message: string | undefined; record: string | undefined }
    | undefined;

  constructor(private readonly options: Options) {
    super({ threadId: options.sessionId });
  }
  setIntent(intent: "message" | "retry" | "analyze" | "split") {
    this.intent = intent;
    this.stopRequested = false;
  }
  snapshot() {
    return this.page;
  }
  restore(page: AgentPage) {
    this.page = this.mergePage(page);
    this.setMessages(this.page.messages as Message[]);
    this.options.onPage(this.page);
  }
  private mergePage(page: AgentPage): AgentPage {
    const merged = mergeHistory(this.page, page);
    const reopened =
      merged.before != null &&
      (this.page?.before == null || merged.before > this.page.before);
    if (!this.page || reopened)
      this.historyAnchor = {
        message: (page.messages[0] as Message | undefined)?.id,
        record: page.records[0]?.id,
      };
    return merged;
  }
  close() {
    this.detach?.();
  }

  /** Runtime append is fire-and-forget; the composer waits for host acceptance. */
  submit(append: () => void | Promise<void>): Promise<RunInfo> {
    if (this.submission)
      return Promise.reject(
        new AiRequestError(this.options.failureText(), "busy"),
      );
    return new Promise((resolve, reject) => {
      this.submission = { resolve, reject };
      try {
        const submission = this.submission;
        const result = append();
        if (result)
          void result.catch((error) => {
            if (this.submission === submission) {
              this.submission = undefined;
              reject(error);
            }
          });
      } catch (error) {
        this.submission = undefined;
        reject(error);
      }
    });
  }

  override run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      let detach: (() => void) | undefined;
      let closed = false;
      const accept = async () => {
        if (this.options.pending.get(this.threadId))
          throw new AiRequestError(this.options.failureText(), null);
        const binding = this.options.binding();
        if (!binding)
          throw new AiRequestError(this.options.failureText(), null);
        const last = [...input.messages]
          .reverse()
          .find((message) => message.role === "user");
        const text =
          last?.role === "user" && typeof last.content === "string"
            ? last.content
            : "";
        const context = binding.workspaceContext
          ? { ...binding.workspaceContext }
          : null;
        const intent = this.intent;
        this.intent = "message";
        const forwardedProps: Record<string, string> = {};
        if (intent === "retry" && this.page?.run)
          forwardedProps.retryRunId = this.page.run.id;
        else if (
          this.page?.run &&
          ["waiting_for_input", "interrupted"].includes(this.page.run.status)
        )
          forwardedProps.continueRunId = this.page.run.id;
        const request: AgentStart = {
          input: { ...input, protocolVersion: "1.0", forwardedProps },
          ...binding,
          workspaceContext: context
            ? {
                ...context,
                action:
                  intent === "analyze" || intent === "split"
                    ? intent
                    : context.action,
              }
            : null,
          expectedProjectRevision: await this.options.revision(),
        };
        await this.options.ensureSession(text);
        if (closed) throw new AiRequestError(this.options.failureText(), null);
        if (!this.options.pending.begin(request))
          throw new AiRequestError(this.options.failureText(), null);
        let run: RunInfo;
        try {
          run = await this.options.start(request);
        } catch (error) {
          const accepted = await commands
            .agentRequestStatus(request)
            .catch(() => null);
          if (!accepted)
            throw new AiRequestError(this.options.failureText(), error);
          run = accepted;
        }
        this.options.pending.resolve(request);
        return run;
      };
      const submission = this.submission;
      this.submission = undefined;
      const start = accept();
      this.starting = start;
      void start
        .then((run) => {
          submission?.resolve(run);
          if (!closed) detach = this.listen(subscriber);
          if (this.stopRequested)
            void this.cancel(run.id).catch((error) =>
              this.options.onStopError?.(error),
            );
        })
        .catch((error) => {
          const failure =
            error instanceof AiRequestError
              ? error
              : new AiRequestError(this.options.failureText(), error);
          failure.sessionId = this.threadId;
          submission?.reject(failure);
          if (!closed) subscriber.error(failure);
        })
        .finally(() => {
          if (this.starting === start) this.starting = undefined;
        });
      return () => {
        closed = true;
        detach?.();
      };
    });
  }

  protected override connect(): Observable<BaseEvent> {
    return new Observable((subscriber) => this.listen(subscriber));
  }

  private listen(subscriber: {
    next: (event: BaseEvent) => void;
    error: (error: unknown) => void;
    complete: () => void;
  }) {
    this.detach?.();
    const subscription = crypto.randomUUID();
    let closed = false;
    let cursor: number | undefined;
    const detach = () => {
      if (closed) return;
      closed = true;
      void commands
        .agentUnsubscribe(this.threadId, subscription)
        .catch(() => {});
    };
    this.detach = detach;
    const channel = new Channel<AgentFrame>((frame) => {
      if (closed) return;
      if (
        frame.type === "reset" ||
        (cursor !== undefined && frame.cursor !== cursor + 1)
      ) {
        detach();
        subscriber.complete();
        this.options.onResync();
        return;
      }
      cursor = frame.cursor;
      const latest = frame.page;
      const page = this.mergePage(latest);
      this.page = page;
      this.options.onPage(page);
      const historical = frame.restore
        ? page.invocations.filter(
            (task) =>
              !latest.invocations.some((current) => current.id === task.id),
          )
        : [];
      for (const value of frame.events) {
        const event = value as BaseEvent;
        if (event.type === "MESSAGES_SNAPSHOT")
          subscriber.next({ ...event, messages: page.messages as Message[] });
        else subscriber.next(event);
        if (event.type === "RUN_STARTED") {
          for (const task of historical) {
            const start: SubagentStartedEvent = {
              type: EventType.SUBAGENT_STARTED,
              subagentRunId: task.id,
              name: task.name,
              ...(task.parentId ? { parentSubagentRunId: task.parentId } : {}),
              ...(task.messageId ? { parentMessageId: task.messageId } : {}),
              ...(task.toolCallId ? { parentToolCallId: task.toolCallId } : {}),
            };
            subscriber.next(start);
          }
        }
        if (event.type === "MESSAGES_SNAPSHOT") {
          for (const task of historical) {
            if (task.status === "succeeded") {
              const end: SubagentFinishedEvent = {
                type: EventType.SUBAGENT_FINISHED,
                subagentRunId: task.id,
                outcome: { type: "success" },
              };
              subscriber.next(end);
            } else if (
              ["failed", "interrupted", "cancelled"].includes(task.status)
            ) {
              const error: SubagentErrorEvent = {
                type: EventType.SUBAGENT_ERROR,
                subagentRunId: task.id,
                message: task.error ?? "task_failed",
              };
              subscriber.next(error);
            }
          }
        }
      }
      void commands
        .agentAcknowledge(this.threadId, subscription, frame.cursor)
        .catch(() => {});
      if (!activeRun(page.run)) {
        subscriber.complete();
        detach();
      }
    });
    void commands
      .agentSubscribe(
        this.threadId,
        subscription,
        this.page?.session.sequence ?? 0,
        channel,
      )
      .then(() => {
        if (closed)
          void commands
            .agentUnsubscribe(this.threadId, subscription)
            .catch(() => {});
      })
      .catch((error) => {
        if (!closed)
          subscriber.error(
            new AiRequestError(this.options.failureText(), error),
          );
        detach();
      });
    return detach;
  }

  async loadOlder() {
    if (this.page?.before == null) return false;
    const before = this.page.before;
    const anchor = this.historyAnchor;
    const older = await commands.agentHistory(this.threadId, before, 20);
    // A live frame may have arrived while the older page was being read.
    // Its mutable facts win even though the historical page has the earlier cursor.
    const current = this.page;
    const sameCursor = current.before === before;
    this.restore({
      ...mergeHistory(older, current),
      messages: insertBeforeId(
        older.messages as Message[],
        current.messages as Message[],
        anchor?.message,
      ),
      records: insertBeforeId(older.records, current.records, anchor?.record),
      before: sameCursor ? older.before : current.before,
    });
    if (sameCursor)
      this.historyAnchor = {
        message: (older.messages[0] as Message | undefined)?.id,
        record: older.records[0]?.id,
      };
    return true;
  }

  private cancel(id: string): Promise<RunInfo> {
    if (this.cancelling?.id !== id) {
      const promise = commands.agentCancel(id).catch((error) => {
        if (this.cancelling?.id === id) this.cancelling = undefined;
        throw error;
      });
      this.cancelling = { id, promise };
    }
    return this.cancelling.promise;
  }

  async stop() {
    this.stopRequested = true;
    const run = this.starting ? await this.starting : this.page?.run;
    if (run && activeRun(run)) await this.cancel(run.id);
  }
}
