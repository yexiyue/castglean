import { useMemo, useSyncExternalStore } from "react";
import { commands } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import {
  auditionIdentity,
  clearAuditionDraft,
  StudioOperationRegistry,
} from "@/lib/studio-operations";

export function useStudioOperations() {
  const { workspace } = useDesktopSession();
  const registry = useMemo(() => {
    const values = workspace("voices");
    if (!(values.studioOperations instanceof StudioOperationRegistry)) {
      const created = new StudioOperationRegistry(commands, undefined, (id) =>
        clearAuditionDraft(
          values,
          created,
          auditionIdentity({ kind: "candidate", id }),
        ),
      );
      values.studioOperations = created;
    }
    return values.studioOperations as StudioOperationRegistry;
  }, [workspace]);
  useSyncExternalStore(
    registry.subscribe,
    registry.snapshot,
    registry.snapshot,
  );
  return registry;
}
