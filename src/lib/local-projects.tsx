import { isTauri } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  commands,
  type FilePreview,
  type ImportSource,
  type LocalProjectListItem,
  type LocalProjectSnapshot_Serialize,
} from "@/lib/bindings";

export const desktop = isTauri();
const selectionStorageKey = "castglean.pending-source-selections";
let staleSelectionCleanup: Promise<void> | undefined;

function prepareImportSelections() {
  if (!desktop) return Promise.resolve();
  if (!staleSelectionCleanup) {
    staleSelectionCleanup = (async () => {
      const stored = sessionStorage.getItem(selectionStorageKey);
      let ids: unknown = [];
      try {
        ids = stored ? JSON.parse(stored) : [];
      } catch {
        sessionStorage.removeItem(selectionStorageKey);
      }
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
        sessionStorage.removeItem(selectionStorageKey);
        return;
      }
      await Promise.all(ids.map((id) => commands.localSourceRelease(id)));
      sessionStorage.removeItem(selectionStorageKey);
    })().catch((error) => {
      staleSelectionCleanup = undefined;
      throw error;
    });
  }
  return staleSelectionCleanup;
}
type Draft = {
  title: string;
  description: string;
};
export type ImportSession = {
  files: FilePreview[];
  split: boolean;
  commandIds: Map<string, string>;
  completed: { id: string; filename: string }[];
  errors: Record<string, string>;
  operations: Record<string, ImportSource>;
};
type ProjectsState = {
  projects: LocalProjectListItem[];
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  upsertProject: (project: LocalProjectSnapshot_Serialize) => void;
  pendingSources: number;
  importSession: (projectId?: string) => ImportSession;
  updateImportSession: (
    session: ImportSession,
    update: (session: ImportSession) => void,
  ) => void;
  bindImportSession: (session: ImportSession, projectId: string) => void;
  prepareImportSelections: () => Promise<void>;
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
  const sessions = useRef(new Map<string, ImportSession>());
  const pendingRef = useRef(0);
  const [, refreshSessions] = useState(0);
  const importSession = useCallback((projectId?: string) => {
    const key = projectId ?? "";
    let session = sessions.current.get(key);
    if (!session) {
      session = {
        files: [],
        split: true,
        commandIds: new Map(),
        completed: [],
        errors: {},
        operations: {},
      };
      sessions.current.set(key, session);
    }
    return session;
  }, []);
  const updateImportSession = useCallback(
    (session: ImportSession, update: (session: ImportSession) => void) => {
      update(session);
      const ids = Array.from(sessions.current.values()).flatMap((item) =>
        item.files.map((file) => file.id),
      );
      pendingRef.current = ids.length;
      if (desktop)
        sessionStorage.setItem(selectionStorageKey, JSON.stringify(ids));
      refreshSessions((version) => version + 1);
    },
    [],
  );
  const bindImportSession = useCallback(
    (session: ImportSession, projectId: string) => {
      for (const [key, value] of sessions.current) {
        if (value === session && key !== projectId)
          sessions.current.delete(key);
      }
      sessions.current.set(projectId, session);
    },
    [],
  );
  const pendingSources = Array.from(sessions.current.values()).reduce(
    (count, session) => count + session.files.length,
    0,
  );
  const [loading, setLoading] = useState(desktop);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    void prepareImportSelections().catch(() => {});
    function beforeUnload(event: BeforeUnloadEvent) {
      if (pendingRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
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
        importSession,
        updateImportSession,
        bindImportSession,
        prepareImportSelections,
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
