import { createContext, type ReactNode, useContext } from "react";

/** Targets owned by the persistent desktop shell; content stays owned by the active workspace. */
export const WorkspaceChromeContext = createContext<{
  leading: HTMLElement | null;
  projectSwitcher: ReactNode;
} | null>(null);

export function useWorkspaceChrome() {
  return useContext(WorkspaceChromeContext);
}
