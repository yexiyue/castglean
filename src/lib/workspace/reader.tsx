import { createContext, useContext } from "react";
import { commands } from "@/lib/bindings";

/** Read-only project data used by the workbench. Writes are intentionally outside this port. */
export type WorkspaceReader = { readOnly: boolean } & Pick<
  typeof commands,
  | "localProjectSnapshot"
  | "localProjectText"
  | "chapterAnalysisSnapshot"
  | "chapterAnalysisCharacters"
  | "chapterAnalysisDirectory"
  | "chapterAnalysisSegments"
  | "chapterAnalysisIssues"
>;

const desktopReader: WorkspaceReader = {
  readOnly: false,
  localProjectSnapshot: (...args) => commands.localProjectSnapshot(...args),
  localProjectText: (...args) => commands.localProjectText(...args),
  chapterAnalysisSnapshot: (...args) =>
    commands.chapterAnalysisSnapshot(...args),
  chapterAnalysisCharacters: (...args) =>
    commands.chapterAnalysisCharacters(...args),
  chapterAnalysisDirectory: (...args) =>
    commands.chapterAnalysisDirectory(...args),
  chapterAnalysisSegments: (...args) =>
    commands.chapterAnalysisSegments(...args),
  chapterAnalysisIssues: (...args) => commands.chapterAnalysisIssues(...args),
};
export const WorkspaceReaderContext =
  createContext<WorkspaceReader>(desktopReader);
export function useWorkspaceReader(): WorkspaceReader {
  return useContext(WorkspaceReaderContext);
}
