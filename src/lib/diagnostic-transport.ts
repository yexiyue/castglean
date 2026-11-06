import { Channel } from "@tauri-apps/api/core";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { DiagnosticSnapshot, ModelSelection } from "@/lib/bindings";
import { commands } from "./bindings.ts";
import { DiagnosticStream } from "./diagnostic-stream.ts";

export type DiagnosticModelBinding = {
  selection: ModelSelection;
  revision: number;
  confirmRebind: boolean;
};

export class DiagnosticTransport implements ChatTransport<UIMessage> {
  private current: DiagnosticSnapshot | null = null;
  private detach: (() => void) | undefined;
  private disposed = false;
  private requests = new Map<string, string>();
  private activeRequest: string | null = null;
  private draft: string;
  private selection: () => DiagnosticModelBinding | null;
  private onSnapshot: (s: DiagnosticSnapshot) => void;
  private failureText: string;
  constructor(
    draft: string,
    selection: () => DiagnosticModelBinding | null,
    onSnapshot: (s: DiagnosticSnapshot) => void,
    failureText: string,
  ) {
    this.draft = draft;
    this.selection = selection;
    this.onSnapshot = onSnapshot;
    this.failureText = failureText;
  }
  restore(snapshot: DiagnosticSnapshot | null) {
    this.disposed = false;
    this.current = snapshot;
  }
  reset() {
    this.detach?.();
    this.current = null;
    this.activeRequest = null;
  }
  async stop() {
    const identity = this.activeRequest ?? this.current?.runId;
    if (identity) await commands.diagnosticCancel(this.draft, identity);
  }
  dispose() {
    this.disposed = true;
    this.detach?.();
  }
  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
  ) {
    if (options.trigger !== "submit-message") throw new Error(this.failureText);
    const selected = this.selection();
    if (!selected) throw new Error(this.failureText);
    const last = options.messages[options.messages.length - 1];
    if (last?.role !== "user") throw new Error(this.failureText);
    const message = last.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    let request = this.requests.get(last.id);
    if (!request) {
      request = crypto.randomUUID();
      this.requests.set(last.id, request);
    }
    this.activeRequest = request;
    // AI SDK aborts on component teardown too. Only explicit Stop cancels host work.
    const snapshot = await commands.diagnosticStart({
      draftId: this.draft,
      sessionId: this.current?.sessionId ?? null,
      selected: selected.selection,
      expectedConfigurationRevision: selected.revision,
      confirmRebind: selected.confirmRebind,
      message,
      requestId: request,
    });
    this.current = snapshot;
    this.onSnapshot(snapshot);
    if (this.disposed)
      return new ReadableStream<UIMessageChunk>({ start: (c) => c.close() });
    return this.subscribe(snapshot);
  }
  async reconnectToStream(
    _options: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0],
  ) {
    if (!this.current) return null;
    return this.subscribe(this.current);
  }
  private subscribe(initial: DiagnosticSnapshot) {
    this.detach?.();
    this.disposed = false;
    const id = crypto.randomUUID();
    const projector = new DiagnosticStream();
    let closed = false;
    let acceptedSequence = -1;
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const disconnect = () => {
          void commands.diagnosticUnsubscribe(
            this.draft,
            initial.sessionId,
            id,
          );
        };
        this.detach = () => {
          disconnect();
          if (!closed) {
            closed = true;
            controller.close();
          }
        };
        const receive = (snapshot: DiagnosticSnapshot) => {
          if (
            closed ||
            snapshot.runId !== initial.runId ||
            snapshot.sessionId !== initial.sessionId ||
            snapshot.sequence <= acceptedSequence
          )
            return;
          acceptedSequence = snapshot.sequence;
          this.current = snapshot;
          this.onSnapshot(snapshot);
          for (const chunk of projector.push(snapshot))
            controller.enqueue(chunk);
          if (projector.done) {
            closed = true;
            controller.close();
            disconnect();
          }
        };
        receive(initial);
        if (!closed)
          void commands
            .diagnosticSubscribe(
              this.draft,
              initial.sessionId,
              id,
              new Channel<DiagnosticSnapshot>(receive),
            )
            .catch(() => {
              if (!closed) {
                closed = true;
                controller.error(new Error(this.failureText));
                disconnect();
              }
            });
      },
      cancel: () => {
        this.detach?.();
      },
    });
  }
}
