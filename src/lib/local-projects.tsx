import { isTauri } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  commands,
  type LocalProjectListItem,
  type LocalProjectSnapshot_Serialize,
} from "@/lib/bindings";

export const desktop = isTauri();
type Draft = {
  title: string;
  description: string;
};
type ProjectsState = {
  projects: LocalProjectListItem[];
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  upsertProject: (project: LocalProjectSnapshot_Serialize) => void;
  pendingSources: number;
  setPendingSources: React.Dispatch<React.SetStateAction<number>>;
  loading: boolean;
  loadError: boolean;
};
const Context = createContext<ProjectsState | null>(null);

/** Host-owned metadata projections. Source text and project edits remain in Rust. */
export function LocalProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<LocalProjectListItem[]>([]);
  const [draft, setDraft] = useState<Draft>({
    title: "",
    description: "",
  });
  const [pendingSources, setPendingSources] = useState(0);
  const [loading, setLoading] = useState(desktop);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void commands
      .localProjectList()
      .then((items) => {
        if (active)
          setProjects((current) => [
            ...current,
            ...items.filter((item) => !current.some((p) => p.id === item.id)),
          ]);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const upsertProject = useCallback(
    (project: LocalProjectSnapshot_Serialize) => {
      const item = {
        id: project.id,
        title: project.title,
        description: project.description,
        revision: project.revision,
        sourceCount: project.sources.length,
        chapterCount: project.chapters.length,
      };
      setProjects((items) => {
        if (items.some((p) => p.id === item.id && p.revision > item.revision))
          return items;
        return [item, ...items.filter((p) => p.id !== item.id)];
      });
    },
    [],
  );
  return (
    <Context.Provider
      value={{
        projects,
        draft,
        setDraft,
        upsertProject,
        loading,
        loadError,
        pendingSources,
        setPendingSources,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useLocalProjects() {
  const value = useContext(Context);
  if (!value) throw new Error("LocalProjectsProvider is required");
  return value;
}
