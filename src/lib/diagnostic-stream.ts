import type { UIMessage, UIMessageChunk } from "ai";
import type {
  DiagnosticMessage,
  DiagnosticPart,
  DiagnosticSnapshot,
} from "@/lib/bindings";

function parsed(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function messagePart(part: DiagnosticPart): UIMessage["parts"][number] {
  if (part.type === "text") return { type: "text", text: part.text };
  const tool = {
    type: "dynamic-tool" as const,
    toolName: part.name,
    toolCallId: part.id,
    input: parsed(part.input),
  };
  if (part.output == null) return { ...tool, state: "input-available" };
  if (part.failed)
    return { ...tool, state: "output-error", errorText: part.output };
  return { ...tool, state: "output-available", output: parsed(part.output) };
}

export function diagnosticMessages(messages: DiagnosticMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    parts: message.parts.map(messagePart),
  }));
}
/** Projects authoritative snapshots into ordered AI SDK chunks. Duplicate snapshots are inert. */
export class DiagnosticStream {
  private sequence = -1;
  private started = false;
  private finished = false;
  private texts = new Map<string, number>();
  private ended = new Set<string>();
  private inputs = new Set<string>();
  private outputs = new Set<string>();
  private endTextParts(chunks: UIMessageChunk[]): void {
    for (const id of this.texts.keys()) {
      if (!this.ended.has(id)) {
        chunks.push({ type: "text-end", id });
        this.ended.add(id);
      }
    }
  }
  push(snapshot: DiagnosticSnapshot): UIMessageChunk[] {
    if (this.finished || snapshot.sequence <= this.sequence) return [];
    this.sequence = snapshot.sequence;
    const message = snapshot.messages[snapshot.messages.length - 1];
    if (message?.role !== "assistant") return [];
    const chunks: UIMessageChunk[] = [];
    if (!this.started) {
      chunks.push({ type: "start", messageId: message.id });
      this.started = true;
    }
    message.parts.forEach((part, index) => {
      if (part.type === "text") {
        const id = `${message.id}:${index}`;
        const size = this.texts.get(id);
        if (size === undefined) {
          // Tool hooks can arrive before buffered text. A later text part establishes
          // that the preceding text is complete; seeing a tool alone does not.
          this.endTextParts(chunks);
          chunks.push({ type: "text-start", id });
        }
        if (part.text.length > (size ?? 0))
          chunks.push({
            type: "text-delta",
            id,
            delta: part.text.slice(size ?? 0),
          });
        this.texts.set(id, part.text.length);
      } else {
        if (!this.inputs.has(part.id)) {
          chunks.push({
            type: "tool-input-available",
            toolCallId: part.id,
            toolName: part.name,
            input: parsed(part.input),
            dynamic: true,
          });
          this.inputs.add(part.id);
        }
        if (part.output != null && !this.outputs.has(part.id)) {
          chunks.push(
            part.failed
              ? {
                  type: "tool-output-error",
                  toolCallId: part.id,
                  errorText: part.output,
                  dynamic: true,
                }
              : {
                  type: "tool-output-available",
                  toolCallId: part.id,
                  output: parsed(part.output),
                  dynamic: true,
                },
          );
          this.outputs.add(part.id);
        }
      }
    });
    if (snapshot.status !== "running" && snapshot.status !== "cancelling") {
      this.endTextParts(chunks);
      chunks.push({ type: "finish" });
      this.finished = true;
    }
    return chunks;
  }
  get done() {
    return this.finished;
  }
}
