import type { RunAgentInput } from "@ag-ui/core";
import type { AgentRequest } from "../bindings";
export type AgentStart = Omit<AgentRequest, "input"> & { input: RunAgentInput };

/** Desktop-session lifetime: one unresolved start per assistant session. */
export class PendingAiStarts {
  private readonly requests = new Map<string, AgentStart>();
  private readonly recovered = new Map<string, "accepted" | "abandoned">();
  private readonly beforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };

  get(sessionId: string): AgentStart | undefined {
    return this.requests.get(sessionId);
  }

  begin(request: AgentStart): boolean {
    if (this.requests.has(request.input.threadId)) return false;
    if (
      this.requests.size === 0 &&
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    )
      window.addEventListener("beforeunload", this.beforeUnload);
    this.requests.set(request.input.threadId, structuredClone(request));
    return true;
  }

  resolve(request: AgentStart): void {
    if (
      this.requests.get(request.input.threadId)?.input.runId ===
      request.input.runId
    ) {
      this.requests.delete(request.input.threadId);
      if (
        this.requests.size === 0 &&
        typeof window !== "undefined" &&
        typeof window.removeEventListener === "function"
      )
        window.removeEventListener("beforeunload", this.beforeUnload);
    }
  }

  hasPending(): boolean {
    return this.requests.size > 0;
  }

  markRecovered(
    sessionId: string,
    outcome: "accepted" | "abandoned" = "accepted",
  ): void {
    this.recovered.set(sessionId, outcome);
  }
  wasRecovered(sessionId: string): "accepted" | "abandoned" | undefined {
    return this.recovered.get(sessionId);
  }
  acknowledge(sessionId: string): void {
    this.recovered.delete(sessionId);
  }
}
