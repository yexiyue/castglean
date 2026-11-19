import { commands } from "@/lib/bindings";

/** Transient requests live with the desktop workspace, never in project storage. */
export type CandidateOperation = {
  projectId: string;
  chapterId: string;
  candidateId: string;
  commandId: string;
  revision: number;
  selected: string[] | null;
  conflicts: string[];
  phase: "write" | "read";
  inFlight: boolean;
  rejected: boolean;
  failed: boolean;
};

export class CandidateOperationRegistry {
  readonly entries = new Map<string, CandidateOperation>();
  private version = 0;
  private listeners = new Set<() => void>();
  private guardingUnload = false;
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.entries.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  notify = () => {
    if (
      typeof window !== "undefined" &&
      !!this.entries.size !== this.guardingUnload
    ) {
      this.guardingUnload = !!this.entries.size;
      if (this.guardingUnload)
        window.addEventListener("beforeunload", this.beforeUnload);
      else window.removeEventListener("beforeunload", this.beforeUnload);
    }
    this.version++;
    for (const listener of this.listeners) listener();
  };

  async process(
    key: string,
    operation: CandidateOperation,
    onSaved: () => Promise<void>,
  ): Promise<boolean> {
    if (this.entries.get(key) !== operation || operation.inFlight) return false;
    operation.inFlight = true;
    operation.failed = false;
    this.notify();
    try {
      if (operation.phase === "write") {
        try {
          await commands.chapterAnalysisCandidateProcess(
            operation.projectId,
            operation.candidateId,
            operation.commandId,
            operation.revision,
            operation.selected,
            operation.conflicts,
          );
        } catch (cause) {
          operation.rejected =
            typeof cause === "string" &&
            [
              "conflict",
              "source_changed",
              "invalid_data",
              "not_found",
              "capacity_exceeded",
              "analysis_conflict",
              "analysis_source_changed",
              "analysis_invalid_data",
              "analysis_not_found",
              "analysis_capacity_exceeded",
            ].includes(cause);
          throw cause;
        }
        operation.phase = "read";
      }
      await onSaved();
      this.entries.delete(key);
      return true;
    } catch {
      operation.failed = true;
      return false;
    } finally {
      operation.inFlight = false;
      this.notify();
    }
  }
}
