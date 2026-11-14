import type { StartRun } from "../bindings";

/** Desktop-session lifetime: one unresolved start per assistant session. */
export class PendingAiStarts {
  private readonly requests = new Map<string, StartRun>();
  private readonly recovered = new Map<string, "accepted" | "abandoned">();
  private readonly beforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };

  get(sessionId: string): StartRun | undefined {
    return this.requests.get(sessionId);
  }

  begin(request: StartRun): boolean {
    if (this.requests.has(request.sessionId)) return false;
    if (
      this.requests.size === 0 &&
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    )
      window.addEventListener("beforeunload", this.beforeUnload);
    this.requests.set(request.sessionId, structuredClone(request));
    return true;
  }

  resolve(request: StartRun): void {
    if (this.requests.get(request.sessionId)?.requestId === request.requestId) {
      this.requests.delete(request.sessionId);
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
