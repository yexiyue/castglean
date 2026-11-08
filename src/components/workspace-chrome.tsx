import { createContext, useContext } from "react";

/** Targets owned by the persistent desktop shell; content stays owned by the active workspace. */
export const WorkspaceChromeContext = createContext<{
  leading: HTMLElement | null;
  trailing: HTMLElement | null;
} | null>(null);

export function useWorkspaceChrome() {
  return useContext(WorkspaceChromeContext);
}
