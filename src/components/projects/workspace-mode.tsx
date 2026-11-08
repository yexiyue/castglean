import { createContext, useContext } from "react";

export type ReadingLocation = {
  sourceId: string;
  chapterId: string;
  line: number;
  byte: number;
  offset: number;
};

/** View coordination only; source ranges and analysis validity remain host-owned. */
export const WorkspaceModeContext = createContext<{
  active: boolean;
  location: ReadingLocation | null;
  charactersRequest: number;
} | null>(null);

export function useWorkspaceMode() {
  return useContext(WorkspaceModeContext);
}
