import { type ShouldBlockFn, useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { useDesktopSession } from "@/lib/desktop-session";

export function usePauseNavigationGuard(
  projectId: string,
  onBlocked: () => void,
) {
  const { registerExitGuard } = useDesktopSession();
  const pauseExitGuard = useRef<(() => Promise<boolean>) | null>(null);
  const pauseOperationGuard = useRef<(() => boolean) | null>(null);
  const pauseDirtyGuard = useRef<(() => boolean) | null>(null);
  const boundaryOperationPending = useRef(false);

  const afterPauseExit = useCallback(
    (action: () => void) => {
      if (boundaryOperationPending.current) return Promise.resolve(false);
      const ready = pauseExitGuard.current?.() ?? Promise.resolve(true);
      return ready.then((saved) => {
        const allowed = saved && (pauseOperationGuard.current?.() ?? true);
        if (allowed) action();
        else onBlocked();
        return allowed;
      });
    },
    [onBlocked],
  );

  useEffect(
    () => registerExitGuard(projectId, () => afterPauseExit(() => {})),
    [projectId, registerExitGuard, afterPauseExit],
  );
  const shouldBlockNavigation = useCallback<ShouldBlockFn>(
    async ({ current, next }) =>
      current.pathname !== next.pathname && !(await afterPauseExit(() => {})),
    [afterPauseExit],
  );
  const shouldBlockUnload = useCallback(
    () =>
      (pauseDirtyGuard.current?.() ?? false) ||
      boundaryOperationPending.current ||
      !(pauseOperationGuard.current?.() ?? true),
    [],
  );
  useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: shouldBlockUnload,
  });
  return {
    afterPauseExit,
    pauseExitGuard,
    pauseOperationGuard,
    pauseDirtyGuard,
    boundaryOperationPending,
  };
}
