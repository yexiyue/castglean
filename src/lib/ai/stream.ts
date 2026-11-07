import type { UIMessage, UIMessageChunk } from "ai";
import type {
  HistoryPage,
  Message,
  RunInfo,
  StreamEvent,
} from "../bindings.ts";

export class ResyncRequired extends Error {
  constructor() {
    super("ai_resync_required");
  }
}
export const activeRun = (run: RunInfo | null | undefined) =>
  !!run && ["queued", "running", "cancelling"].includes(run.status);

/** A disposable view projection. Host history remains the only authority. */
export class SessionProjection {
  private page: HistoryPage | null = null;
  private messages = new Map<string, Message>();
  restore(page: HistoryPage): void {
    this.page = page;
    this.messages = new Map(
      page.messages.map((message) => [message.id, message]),
    );
  }
  prepend(page: HistoryPage): void {
    if (!this.page || page.session.id !== this.page.session.id)
      throw new ResyncRequired();
    for (const message of page.messages) {
      const old = this.messages.get(message.id);
      if (!old || old.version < message.version)
        this.messages.set(message.id, message);
    }
    this.page = { ...this.page, before: page.before };
  }
  apply(event: StreamEvent): boolean {
    if (
      !this.page ||
      event.version !== 1 ||
      event.sessionId !== this.page.session.id
    )
      throw new ResyncRequired();
    if (event.type === "resync_required") throw new ResyncRequired();
    if (event.sequence <= this.page.session.sequence) return false;
    if (event.sequence !== this.page.session.sequence + 1)
      throw new ResyncRequired();
    if (
      event.session.id !== event.sessionId ||
      event.session.sequence !== event.sequence ||
      (event.run && event.run.sessionId !== event.sessionId) ||
      (event.run?.id ?? null) !== (event.runId ?? null)
    )
      throw new ResyncRequired();
    const next = new Map(this.messages);
    for (const change of event.changes) {
      if (change.type === "message") {
        const old = next.get(change.message.id);
        if (old && old.version > change.message.version)
          throw new ResyncRequired();
        next.set(change.message.id, change.message);
      } else {
        const message = next.get(change.messageId);
        const part = message?.parts.parts[change.part];
        if (
          !message ||
          message.version !== change.fromVersion ||
          change.version <= change.fromVersion ||
          part?.type !== "text" ||
          part.text.length !== change.offsetUtf16
        )
          throw new ResyncRequired();
        next.set(message.id, {
          ...message,
          version: change.version,
          parts: {
            version: message.parts.version,
            parts: message.parts.parts.map((part, index) =>
              index === change.part
                ? {
                    type: "text" as const,
                    text:
                      part.type === "text"
                        ? part.text + change.text
                        : change.text,
                  }
                : part,
            ),
          },
        });
      }
    }
    this.messages = next;
    this.page = { ...this.page, session: event.session, run: event.run };
    return true;
  }
  snapshot(): HistoryPage | null {
    return this.page
      ? {
          ...this.page,
          messages: [...this.messages.values()].sort(
            (a, b) => a.ordinal - b.ordinal,
          ),
        }
      : null;
  }
}

export function aiMessages(
  messages: Message[],
  failureText: string,
): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    parts: message.parts.parts.map((part) => {
      if (part.type === "text")
        return { type: "text" as const, text: part.text };
      const tool = {
        type: "dynamic-tool" as const,
        toolName: part.name,
        toolCallId: part.id,
        input: part.input,
      };
      if (part.state === "completed")
        return {
          ...tool,
          state: "output-available" as const,
          output: part.output,
        };
      if (part.state === "failed" || part.state === "interrupted")
        return {
          ...tool,
          state: "output-error" as const,
          errorText: failureText,
        };
      return { ...tool, state: "input-available" as const };
    }),
  }));
}

/** Converts one run's stable assistant message to the SDK's incremental wire format. */
export class ResponseStream {
  private messageId: string | null = null;
  private texts = new Map<string, string>();
  private ended = new Set<string>();
  private inputs = new Set<string>();
  private outputs = new Set<string>();
  private finished = false;
  reset(): UIMessageChunk[] {
    this.messageId = null;
    this.texts.clear();
    this.ended.clear();
    this.inputs.clear();
    this.outputs.clear();
    this.finished = false;
    // AI SDK 7 clears the current response's text/tool state with reset-step.
    // This transport emits no start-step, so a resync replaces the entire reply.
    return [{ type: "reset-step" }];
  }
  push(
    page: HistoryPage,
    runId: string,
    failureText: string,
  ): UIMessageChunk[] {
    if (this.finished) return [];
    const chunks: UIMessageChunk[] = [];
    const message = [...page.messages]
      .reverse()
      .find(
        (message) => message.runId === runId && message.role === "assistant",
      );
    if (message) {
      if (this.messageId && this.messageId !== message.id)
        throw new ResyncRequired();
      if (!this.messageId) {
        this.messageId = message.id;
        chunks.push({ type: "start", messageId: message.id });
      }
      message.parts.parts.forEach((part, index) => {
        if (part.type === "text") {
          const id = `${message.id}:${index}`;
          const old = this.texts.get(id);
          if (old !== undefined && !part.text.startsWith(old))
            throw new ResyncRequired();
          if (old === undefined) {
            for (const previous of this.texts.keys())
              if (!this.ended.has(previous)) {
                chunks.push({ type: "text-end", id: previous });
                this.ended.add(previous);
              }
            chunks.push({ type: "text-start", id });
          }
          if (part.text.length > (old?.length ?? 0))
            chunks.push({
              type: "text-delta",
              id,
              delta: part.text.slice(old?.length ?? 0),
            });
          this.texts.set(id, part.text);
        } else {
          if (!this.inputs.has(part.id)) {
            chunks.push({
              type: "tool-input-available",
              toolCallId: part.id,
              toolName: part.name,
              input: part.input,
              dynamic: true,
            });
            this.inputs.add(part.id);
          }
          if (part.state !== "running" && !this.outputs.has(part.id)) {
            chunks.push(
              part.state === "completed"
                ? {
                    type: "tool-output-available",
                    toolCallId: part.id,
                    output: part.output,
                    dynamic: true,
                  }
                : {
                    type: "tool-output-error",
                    toolCallId: part.id,
                    errorText: failureText,
                    dynamic: true,
                  },
            );
            this.outputs.add(part.id);
          }
        }
      });
    }
    if (!page.run || page.run.id !== runId || !activeRun(page.run)) {
      for (const id of this.texts.keys())
        if (!this.ended.has(id)) {
          chunks.push({ type: "text-end", id });
          this.ended.add(id);
        }
      chunks.push({ type: "finish" });
      this.finished = true;
    }
    return chunks;
  }
  get done(): boolean {
    return this.finished;
  }
}
