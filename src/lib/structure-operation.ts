import {
  commands,
  type LocalProjectSnapshot_Serialize,
  type ProjectEdit_Deserialize,
} from "@/lib/bindings";

interface StructureRequestBase {
  projectId: string;
  commandId: string;
  draftKey: string | null;
}
export type StructureRequest = StructureRequestBase &
  (
    | { kind: "edit"; revision: number; edit: ProjectEdit_Deserialize }
    | { kind: "undo"; revision: number }
    | { kind: "proposal"; proposalId: string; action: "adopt" | "discard" }
  );

export type StructureOperation = {
  request: StructureRequest;
  phase:
    | "sending"
    | "unknown"
    | "reading"
    | "confirmed-unread"
    | "review"
    | "done";
  snapshot?: LocalProjectSnapshot_Serialize;
};

/** One unresolved structure write per project, retained across route unmounts. */
export class StructureOperationRegistry {
  private current: StructureOperation | null = null;
  private listeners = new Set<() => void>();
  snapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  hasPending = () => this.current !== null && this.current.phase !== "done";
  private set(next: StructureOperation | null) {
    this.current = next;
    for (const listener of this.listeners) listener();
  }
  start(request: StructureRequest) {
    if (this.current) return;
    this.set({ request: structuredClone(request), phase: "unknown" });
    void this.retry();
  }
  async retry() {
    const operation = this.current;
    if (
      !operation ||
      !["unknown", "review", "confirmed-unread"].includes(operation.phase)
    )
      return;
    if (operation.phase === "unknown" || operation.phase === "review") {
      this.set({ ...operation, phase: "sending" });
      try {
        const request = operation.request;
        if (request.kind === "edit")
          await commands.localProjectEdit(
            request.projectId,
            request.revision,
            request.commandId,
            request.edit,
          );
        else if (request.kind === "undo")
          await commands.localProjectUndo(
            request.projectId,
            request.revision,
            request.commandId,
          );
        else if (request.action === "adopt")
          await commands.splitAdopt(request.proposalId, request.commandId);
        else await commands.splitDiscard(request.proposalId, request.commandId);
      } catch {
        this.set({ ...operation, phase: "unknown" });
        return;
      }
    }
    await this.readConfirmed(operation.request);
  }
  private async readConfirmed(request: StructureRequest) {
    this.set({ request, phase: "reading" });
    try {
      const snapshot = await commands.localProjectSnapshot(request.projectId);
      this.set({ request, phase: "done", snapshot });
    } catch {
      this.set({ request, phase: "confirmed-unread" });
    }
  }
  async review() {
    const operation = this.current;
    if (!operation || operation.phase !== "unknown") return;
    this.set({ ...operation, phase: "reading" });
    try {
      const snapshot = await commands.localProjectSnapshot(
        operation.request.projectId,
      );
      this.set({ ...operation, phase: "review", snapshot });
    } catch {
      this.set({ ...operation, phase: "unknown" });
    }
  }
  stop() {
    if (this.current?.phase === "review") this.set(null);
  }
  clearDone() {
    if (this.current?.phase === "done") this.set(null);
  }
}

export function structureOperations(
  values: Record<string, unknown>,
): StructureOperationRegistry {
  const existing = values.structureOperations;
  if (existing instanceof StructureOperationRegistry) return existing;
  const created = new StructureOperationRegistry();
  values.structureOperations = created;
  return created;
}
