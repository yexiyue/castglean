import type { Segment, SegmentKind } from "@/lib/bindings";

export interface SegmentEditDraft {
  kind: SegmentKind;
  speaker: string;
}
interface EditorState {
  draft: SegmentEditDraft | null;
  status: "idle" | "saving" | "failed" | "saved";
  retry: (() => Promise<void>) | null;
  confirmed: boolean;
  target: { projectId: string; chapterId: string; segment: Segment } | null;
}
export const emptySegmentEdit: EditorState = {
  draft: null,
  status: "idle",
  retry: null,
  confirmed: false,
  target: null,
};

/** In-memory operation and draft state for one desktop project. */
export class SegmentEditRegistry {
  states: Record<string, EditorState> = {};
  private locks = new Set<string>();
  private listeners = new Set<() => void>();
  private version = 0;
  private guardingUnload = false;
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.hasPending()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  hasPending = () =>
    Object.values(this.states).some(
      (state) => state.status === "saving" || state.status === "failed",
    );
  private patch(key: string, change: Partial<EditorState>) {
    this.states = {
      ...this.states,
      [key]: { ...(this.states[key] ?? emptySegmentEdit), ...change },
    };
    const guard = this.hasPending();
    if (typeof window !== "undefined" && guard !== this.guardingUnload) {
      this.guardingUnload = guard;
      if (guard) window.addEventListener("beforeunload", this.beforeUnload);
      else window.removeEventListener("beforeunload", this.beforeUnload);
    }
    this.version++;
    for (const listener of this.listeners) listener();
  }
  setDraft = (key: string, draft: SegmentEditDraft | null) =>
    this.patch(key, { draft });
  setTarget = (key: string, target: EditorState["target"]) =>
    this.patch(key, { target });
  setConfirmed = (key: string, confirmed: boolean) =>
    this.patch(key, { confirmed });
  isPending = (key: string) => this.locks.has(key);
  persist = async (
    key: string,
    action: () => Promise<void>,
    read?: () => Promise<void>,
  ) => {
    if (this.locks.has(key)) return;
    this.locks.add(key);
    this.patch(key, { status: "saving", retry: action });
    try {
      await action();
      await read?.();
      this.patch(key, { status: "saved", retry: null });
    } catch {
      this.patch(key, { status: "failed" });
    } finally {
      this.locks.delete(key);
    }
  };
}
