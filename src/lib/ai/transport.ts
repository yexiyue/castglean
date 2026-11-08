import { Channel } from "@tauri-apps/api/core";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type {
  AiError,
  Configuration,
  HistoryPage,
  RunInfo,
  StartRun,
  StreamEvent,
} from "../bindings.ts";
import { commands } from "../bindings.ts";
import {
  activeRun,
  ResponseStream,
  ResyncRequired,
  SessionProjection,
} from "./stream.ts";

export type ModelBinding = {
  configuration: Configuration;
  confirmRebind: boolean;
  expectedProjectRevision: number;
  workspaceContext?: StartRun["workspaceContext"];
};
export class AiRequestError extends Error {
  readonly detail: AiError | null;
  constructor(message: string, detail: unknown) {
    super(message);
    const known = [
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

class Inbox {
  private events: StreamEvent[] = [];
  private wake: (() => void) | undefined;
  private closed = false;
  push(event: StreamEvent) {
    if (this.closed) return;
    if (this.events.length >= 9)
      this.events = [
        {
          type: "resync_required",
          version: 1,
          sessionId: event.sessionId,
          runId: event.runId ?? null,
          sequence: event.sequence,
        },
      ];
    else this.events.push(event);
    this.wake?.();
    this.wake = undefined;
  }
  async next(): Promise<StreamEvent | null> {
    while (!this.closed && !this.events.length)
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    return this.closed ? null : (this.events.shift() ?? null);
  }
  close() {
    this.closed = true;
    this.events = [];
    this.wake?.();
    this.wake = undefined;
  }
}

/** AI SDK adapter for a host-owned session. Aborting a reader only unsubscribes. */
export class AiTransport implements ChatTransport<UIMessage> {
  readonly resumeStreamIsReplay = true;
  readonly projection = new SessionProjection();
  private disposed = false;
  private detach: (() => void) | undefined;
  private requests = new Map<string, StartRun>();
  private starting: Promise<RunInfo> | null = null;
  private accepted: string | null = null;
  private stopRequested = false;
  private cancelling: { id: string; promise: Promise<RunInfo> } | null = null;

  private startRun: (request: StartRun, analyze: boolean) => Promise<RunInfo>;
  private projectRevision: (() => Promise<number>) | undefined;
  private sessionId: string;
  private binding: () => ModelBinding | null;
  private onSnapshot: (page: HistoryPage) => void;
  private failureText: string;
  private ensureSession: ((text: string) => Promise<HistoryPage>) | undefined;
  constructor(
    sessionId: string,
    binding: () => ModelBinding | null,
    onSnapshot: (page: HistoryPage) => void,
    failureText: string,
    ensureSession?: (text: string) => Promise<HistoryPage>,
    startRun: (request: StartRun, analyze: boolean) => Promise<RunInfo> = (
      request,
    ) => commands.aiStart(request),
    projectRevision?: () => Promise<number>,
  ) {
    this.startRun = startRun;
    this.projectRevision = projectRevision;
    this.sessionId = sessionId;
    this.binding = binding;
    this.onSnapshot = onSnapshot;
    this.failureText = failureText;
    this.ensureSession = ensureSession;
  }
  activate() {
    this.disposed = false;
  }
  setFailureText(text: string) {
    this.failureText = text;
  }
  restore(page: HistoryPage) {
    this.disposed = false;
    this.projection.restore(page);
  }
  dispose() {
    this.disposed = true;
    this.detach?.();
  }
  close = () => this.dispose();
  private notify() {
    const page = this.projection.snapshot();
    if (page && !this.disposed) this.onSnapshot(page);
  }
  private async reload(): Promise<HistoryPage> {
    const page = await commands.aiHistory(this.sessionId, null, 20);
    if (!this.disposed) {
      this.projection.restore(page);
      this.notify();
    }
    return page;
  }
  async loadOlder(): Promise<void> {
    const page = this.projection.snapshot();
    if (!page || page.before == null) return;
    const older = await commands.aiHistory(this.sessionId, page.before, 20);
    if (!this.disposed) {
      this.projection.prepend(older);
      this.notify();
    }
  }
  private cancel(id: string): Promise<RunInfo> {
    if (this.cancelling?.id !== id)
      this.cancelling = {
        id,
        promise: commands.aiCancel(id).catch((error) => {
          if (this.cancelling?.id === id) this.cancelling = null;
          throw new AiRequestError(this.failureText, error);
        }),
      };
    return this.cancelling.promise;
  }
  async stop(): Promise<void> {
    this.stopRequested = true;
    const run = this.starting
      ? await this.starting
      : this.projection.snapshot()?.run;
    const id = run?.id ?? this.accepted;
    if (id) await this.cancel(id);
  }
  private async accept(request: StartRun, analyze: boolean): Promise<RunInfo> {
    try {
      return await this.startRun(request, analyze);
    } catch (error) {
      // A lost acceptance response is a read-only lookup, never another start.
      const accepted = await commands
        .aiRequestStatus(request)
        .catch(() => null);
      if (accepted) return accepted;
      throw new AiRequestError(this.failureText, error);
    }
  }
  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const selected = this.binding();
    if (this.disposed || !selected)
      throw new AiRequestError(this.failureText, null);
    this.stopRequested = false;
    const frozenContext = selected.workspaceContext
      ? { ...selected.workspaceContext }
      : null;
    const current = this.projection.snapshot();
    const last = options.messages[options.messages.length - 1];
    const message =
      last?.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n") ?? "";
    const analyze =
      !!options.body &&
      "action" in options.body &&
      options.body.action === "analyze";
    const retry = options.trigger === "regenerate-message";
    if (
      (!retry && last?.role !== "user") ||
      (retry && (!current?.run || activeRun(current.run)))
    )
      throw new AiRequestError(this.failureText, null);
    const key = analyze
      ? `analysis:${last?.id}`
      : retry
        ? `retry:${current?.run?.id}`
        : (last?.id ?? "");
    let request = this.requests.get(key);
    if (!request) {
      const run = current?.run;
      let trigger: StartRun["trigger"];
      if (retry) {
        if (!run) throw new AiRequestError(this.failureText, null);
        trigger = { type: "retry", run_id: run.id };
      } else if (
        !analyze &&
        run &&
        (run.status === "waiting_for_input" || run.status === "interrupted")
      ) {
        trigger = { type: "continue", run_id: run.id, message };
      } else {
        trigger = { type: "message", message };
      }
      const expectedProjectRevision = this.projectRevision
        ? await this.projectRevision()
        : selected.expectedProjectRevision;
      if (this.disposed) throw new AiRequestError(this.failureText, null);
      request = {
        sessionId: this.sessionId,
        requestId: crypto.randomUUID(),
        ...selected,
        workspaceContext: frozenContext
          ? {
              ...frozenContext,
              action: analyze
                ? "analyze"
                : options.body &&
                    "action" in options.body &&
                    options.body.action === "split"
                  ? "split"
                  : "auto",
            }
          : null,
        expectedProjectRevision,
        trigger,
      };
      this.requests.set(key, request);
    }
    const pending = (async () => {
      if (!this.projection.snapshot() && this.ensureSession) {
        this.projection.restore(await this.ensureSession(message));
      }
      return this.accept(request, analyze);
    })();
    this.starting = pending;
    let run: RunInfo;
    try {
      run = await pending;
      this.accepted = run.id;
    } finally {
      if (this.starting === pending) this.starting = null;
    }
    if (this.stopRequested) await this.cancel(run.id);
    if (!this.disposed) await this.reload();
    return this.connect(run.id, options.abortSignal);
  }
  async reconnectToStream(
    options: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0],
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    if (this.disposed) return null;
    if (!this.projection.snapshot() && this.ensureSession) return null;
    const page = await this.reload();
    if (!page.run || !activeRun(page.run)) return null;
    return this.connect(page.run.id, options.abortSignal);
  }
  private connect(
    runId: string,
    signal?: AbortSignal,
  ): ReadableStream<UIMessageChunk> {
    this.detach?.();
    let stopped = this.disposed || signal?.aborted === true;
    let disconnect: (() => void) | undefined;
    let inbox: Inbox | undefined;
    const stop = () => {
      stopped = true;
      inbox?.close();
      disconnect?.();
    };
    this.detach = stop;
    signal?.addEventListener("abort", stop, { once: true });
    const owner = this;
    async function* chunks(): AsyncGenerator<UIMessageChunk> {
      const projector = new ResponseStream();
      try {
        while (!stopped && !owner.disposed) {
          const page = owner.projection.snapshot();
          if (!page) return;
          inbox = new Inbox();
          const local = inbox;
          const id = crypto.randomUUID();
          let listening = true;
          disconnect = () => {
            listening = false;
            local.close();
            void commands.aiUnsubscribe(owner.sessionId, id).catch(() => {});
          };
          const channel = new Channel<StreamEvent>((event) => {
            if (listening && !stopped && !owner.disposed) local.push(event);
          });
          // Establish the subscription before yielding the restored response.
          await commands.aiSubscribe(
            owner.sessionId,
            id,
            page.session.sequence,
            channel,
          );
          if (stopped || owner.disposed) {
            disconnect();
            return;
          }
          let resync = false;
          try {
            for (const chunk of projector.push(page, runId, owner.failureText))
              yield chunk;
            if (projector.done) return;
            while (!stopped && !owner.disposed) {
              const event = await local.next();
              if (!event) return;
              try {
                owner.projection.apply(event);
                owner.notify();
                const snapshot = owner.projection.snapshot();
                if (!snapshot) throw new ResyncRequired();
                for (const chunk of projector.push(
                  snapshot,
                  runId,
                  owner.failureText,
                ))
                  yield chunk;
                await commands.aiAcknowledge(
                  owner.sessionId,
                  id,
                  event.sequence,
                );
                if (projector.done) return;
              } catch (error) {
                if (!(error instanceof ResyncRequired)) throw error;
                resync = true;
                break;
              }
            }
          } finally {
            disconnect();
          }
          if (resync && !stopped && !owner.disposed) {
            await owner.reload();
            for (const chunk of projector.reset()) yield chunk;
          }
        }
      } catch (error) {
        throw error instanceof AiRequestError
          ? error
          : new AiRequestError(owner.failureText, null);
      } finally {
        disconnect?.();
        signal?.removeEventListener("abort", stop);
      }
    }
    const iterator = chunks();
    return new ReadableStream<UIMessageChunk>(
      {
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          stop();
          await iterator.return(undefined);
        },
      },
      { highWaterMark: 0 },
    );
  }
}
