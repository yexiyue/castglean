import { useCallback, useRef, useState } from "react";
import type { SegmentKind } from "@/lib/bindings";

export interface SegmentEditDraft {
  kind: SegmentKind;
  speaker: string;
}
interface EditorState {
  draft: SegmentEditDraft | null;
  status: "idle" | "saving" | "failed" | "saved";
  retry: (() => Promise<void>) | null;
}
const EMPTY: EditorState = { draft: null, status: "idle", retry: null };

/** Owned by the workspace so selecting another segment or panel retains failed edits. */
export function useSegmentEditDrafts() {
  const [states, setStates] = useState<Record<string, EditorState>>({});
  const locks = useRef(new Set<string>());
  const patch = useCallback(
    (key: string, change: Partial<EditorState>): void => {
      setStates((current) => ({
        ...current,
        [key]: { ...(current[key] ?? EMPTY), ...change },
      }));
    },
    [],
  );
  const setDraft = useCallback(
    (key: string, draft: SegmentEditDraft | null): void => {
      patch(key, { draft });
    },
    [patch],
  );
  const persist = useCallback(
    async (key: string, action: () => Promise<void>): Promise<void> => {
      if (locks.current.has(key)) return;
      locks.current.add(key);
      patch(key, { status: "saving", retry: action });
      try {
        await action();
        patch(key, { status: "saved", retry: null });
      } catch {
        patch(key, { status: "failed" });
      } finally {
        locks.current.delete(key);
      }
    },
    [patch],
  );
  return { states, setDraft, persist, empty: EMPTY };
}
export type SegmentEditDrafts = ReturnType<typeof useSegmentEditDrafts>;
