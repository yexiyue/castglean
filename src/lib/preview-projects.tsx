import type { Context, ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { ImportSnapshot } from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import type { FileState } from "@/lib/project-files";
import { desktop, openProjectFile, saveProjectFile } from "@/lib/project-files";

/** Metadata projections only. Sources and editing authority live in the host. */
export type PreviewProject = ImportSnapshot & { fileState?: FileState };
interface ProjectDraft {
  title: string;
  description: string;
  chapters: string[];
  step: number;
}
interface PreviewProjectsState {
  projects: PreviewProject[];
  draft: ProjectDraft;
  setDraft: (
    update: ProjectDraft | ((draft: ProjectDraft) => ProjectDraft),
  ) => void;
  upsertProject: (project: ImportSnapshot) => PreviewProject;
  openProject: () => Promise<PreviewProject | null>;
  saveProject: (id: string) => Promise<void>;
  loadError: boolean;
}
const PreviewProjectsContext: Context<PreviewProjectsState | null> =
  import.meta.hot?.data.projectContext ??
  createContext<PreviewProjectsState | null>(null);
if (import.meta.hot)
  import.meta.hot.data.projectContext = PreviewProjectsContext;
const projected = (p: ImportSnapshot): PreviewProject => ({
  ...p,
  fileState: p.filename ? { filename: p.filename } : undefined,
});
export function PreviewProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<PreviewProject[]>([]);
  const [draft, setDraft] = useState<ProjectDraft>({
    title: "",
    description: "",
    chapters: [],
    step: 0,
  });
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void commands
      .importList()
      .then((result) => {
        if (active) setProjects(result.map(projected));
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  function upsertProject(p: ImportSnapshot) {
    const next = projected(p);
    setProjects((current) => [
      next,
      ...current.filter((item) => item.id !== p.id),
    ]);
    return next;
  }
  async function openProject() {
    const p = await openProjectFile();
    return p ? upsertProject(p) : null;
  }
  async function saveProject(id: string) {
    const current = projects.find((p) => p.id === id);
    if (!current) return;
    const result = await saveProjectFile(current);
    if (!result) return;
    const next = projected(result);
    setProjects((items) => items.map((item) => (item.id === id ? next : item)));
  }
  return (
    <PreviewProjectsContext.Provider
      value={{
        projects,
        draft,
        setDraft,
        upsertProject,
        openProject,
        saveProject,
        loadError,
      }}
    >
      {children}
    </PreviewProjectsContext.Provider>
  );
}
export function usePreviewProjects() {
  const state = useContext(PreviewProjectsContext);
  if (!state) throw new Error("PreviewProjectsProvider is required");
  return state;
}
