import { createContext, useContext, useState } from "react";
import type { Context, ReactNode } from "react";
import { openProjectFile, saveProjectFile } from "@/lib/project-files";
import type { FileState } from "@/lib/project-files";

/** Transient UI snapshots; disk operations belong to the native host or browser file adapter. */
export interface PreviewChapter {
  id: string;
  title: string;
  filename: string;
  readonly source: string;
  bytes: number;
  characters: number;
}
export interface PreviewProject {
  id: string;
  title: string;
  description: string;
  chapters: PreviewChapter[];
  fileState?: FileState;
}
export interface ProjectDraft {
  title: string;
  description: string;
  chapters: PreviewChapter[];
  step: number;
}
const emptyDraft = (): ProjectDraft => ({
  title: "",
  description: "",
  chapters: [],
  step: 0,
});
interface PreviewProjectsState {
  projects: PreviewProject[];
  draft: ProjectDraft;
  setDraft: (
    update: ProjectDraft | ((draft: ProjectDraft) => ProjectDraft),
  ) => void;
  createProject: () => PreviewProject | undefined;
  openProject: (file?: File) => Promise<PreviewProject | null>;
  saveProject: (id: string) => Promise<void>;
}
const PreviewProjectsContext: Context<PreviewProjectsState | null> =
  import.meta.hot?.data.projectContext ??
  createContext<PreviewProjectsState | null>(null);
if (import.meta.hot)
  import.meta.hot.data.projectContext = PreviewProjectsContext;
export function PreviewProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<PreviewProject[]>([]);
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  function createProject() {
    if (
      !draft.title.trim() ||
      !draft.chapters.length ||
      draft.chapters.some((c) => !c.title.trim())
    )
      return;
    const project: PreviewProject = {
      id: `preview-${crypto.randomUUID()}`,
      title: draft.title.trim(),
      description: draft.description.trim(),
      chapters: draft.chapters.map((chapter) => ({
        ...chapter,
        title: chapter.title.trim(),
      })),
    };
    setProjects((current) => [project, ...current]);
    setDraft(emptyDraft());
    return project;
  }
  async function openProject(file?: File) {
    const project = await openProjectFile(file);
    if (project)
      setProjects((current) => [
        project,
        ...current.filter((p) => p.id !== project.id),
      ]);
    return project;
  }
  async function saveProject(id: string) {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    const fileState = await saveProjectFile(project);
    if (fileState)
      setProjects((current) =>
        current.map((p) => (p === project ? { ...p, fileState } : p)),
      );
  }
  return (
    <PreviewProjectsContext.Provider
      value={{
        projects,
        draft,
        setDraft,
        createProject,
        openProject,
        saveProject,
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
