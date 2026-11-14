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
}
