/** Serializes writes for each library voice across detail and route lifetimes. */
export type UnknownVoiceEdit = {
  field: "name" | "description";
  value: string | null;
  draft: string;
  operationId: string;
  phase: "write" | "read";
};
export class VoiceEditOperations {
  private pending = new Set<string>();
  private drafts = new Map<string, { name?: string; description?: string }>();
  private unknown = new Map<string, UnknownVoiceEdit>();
  private listeners = new Set<() => void>();
  private version = 0;
  private completed = 0;
  private guardingUnload = false;
  private beforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  completionSnapshot = () => this.completed;
  isPending = (id: string) => this.pending.has(id);
  hasUnsaved = () =>
    this.pending.size > 0 || this.drafts.size > 0 || this.unknown.size > 0;
  draft = (id: string) => this.drafts.get(id);
  unknownEdit = (id: string) => this.unknown.get(id);
  unknownIds = () => [...this.unknown.keys()];
  markUnknown(id: string, edit: UnknownVoiceEdit) {
    this.unknown.set(id, edit);
    this.notify();
  }
  confirmUnknown(id: string, operationId: string) {
    const edit = this.unknown.get(id);
    if (!edit || edit.operationId !== operationId) return;
    this.unknown.set(id, { ...edit, phase: "read" });
    this.notify();
  }
  resolveUnknown(id: string, operationId: string) {
    const edit = this.unknown.get(id);
    if (!edit || edit.operationId !== operationId || edit.phase !== "read")
      return;
    this.unknown.delete(id);
    this.setDraft(id, edit.field, null, edit.draft);
    this.notify();
  }
  async resume(id: string, action: (edit: UnknownVoiceEdit) => Promise<void>) {
    const edit = this.unknown.get(id);
    if (!edit || this.pending.has(id)) throw new Error("voice_edit_pending");
    this.pending.add(id);
    this.notify();
    try {
      await action(edit);
    } finally {
      this.pending.delete(id);
      this.completed++;
      this.notify();
    }
  }
  abandonUnknown(id: string) {
    const edit = this.unknown.get(id);
    if (!edit) return;
    this.unknown.delete(id);
    this.setDraft(id, edit.field, null, edit.draft);
    this.notify();
  }
  setDraft(
    id: string,
    field: "name" | "description",
    value: string | null,
    expected?: string,
  ) {
    const current = this.drafts.get(id) ?? {};
    if (expected !== undefined && current[field] !== expected) return;
    const next = { ...current };
    if (value === null) delete next[field];
    else next[field] = value;
    if (next.name === undefined && next.description === undefined)
      this.drafts.delete(id);
    else this.drafts.set(id, next);
    this.notify();
  }
  clearDraft(id: string) {
    this.drafts.delete(id);
    this.notify();
  }

  async run<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.pending.has(id) || this.unknown.has(id))
      throw new Error("voice_edit_pending");
    this.pending.add(id);
    this.notify();
    try {
      return await action();
    } finally {
      this.pending.delete(id);
      this.completed++;
      this.notify();
    }
  }

  private notify() {
    const guard = this.hasUnsaved();
    if (typeof window !== "undefined" && guard !== this.guardingUnload) {
      this.guardingUnload = guard;
      if (guard) window.addEventListener("beforeunload", this.beforeUnload);
      else window.removeEventListener("beforeunload", this.beforeUnload);
    }
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
