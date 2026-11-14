import { useMemo, useSyncExternalStore } from "react";
import { BindingOperationRegistry } from "@/lib/binding-operations";
import { commands } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";

export function useBindingOperations(projectId: string) {
  const { workspace } = useDesktopSession();
  const registry = useMemo(() => {
    const values = workspace(projectId);
    if (!(values.bindingOperations instanceof BindingOperationRegistry))
      values.bindingOperations = new BindingOperationRegistry(
        projectId,
        commands,
      );
    return values.bindingOperations as BindingOperationRegistry;
  }, [projectId, workspace]);
  useSyncExternalStore(
    registry.subscribe,
    registry.snapshot,
    registry.snapshot,
  );
  return registry;
}
