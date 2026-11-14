import { useMemo, useSyncExternalStore } from "react";
import { useDesktopSession } from "@/lib/desktop-session";
import {
  emptySegmentEdit,
  SegmentEditRegistry,
} from "@/lib/segment-edit-registry";

export function useSegmentEditRegistry(registry: SegmentEditRegistry) {
  useSyncExternalStore(
    registry.subscribe,
    registry.snapshot,
    registry.snapshot,
  );
  return {
    states: registry.states,
    setDraft: registry.setDraft,
    setTarget: registry.setTarget,
    setConfirmed: registry.setConfirmed,
    persist: registry.persist,
    isPending: registry.isPending,
    empty: emptySegmentEdit,
  };
}

/** The desktop workspace owns pending edits across chapter and route changes. */
export function useSegmentEditDrafts(projectId: string) {
  const { workspace } = useDesktopSession();
  const registry = useMemo(() => {
    const values = workspace(projectId);
    if (!(values.segmentEditRegistry instanceof SegmentEditRegistry))
      values.segmentEditRegistry = new SegmentEditRegistry();
    return values.segmentEditRegistry as SegmentEditRegistry;
  }, [projectId, workspace]);
  return useSegmentEditRegistry(registry);
}
export type SegmentEditDrafts = ReturnType<typeof useSegmentEditDrafts>;
