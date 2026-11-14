import { useLocation, useNavigate } from "@tanstack/react-router";
import type { Context, Dispatch, ReactNode, SetStateAction } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { BindingOperationRegistry } from "@/lib/binding-operations";
import { PendingAiStarts } from "@/lib/ai/pending-starts";
import { CandidateOperationRegistry } from "@/lib/candidate-operations";
import { SegmentEditRegistry } from "@/lib/segment-edit-registry";
import { StudioOperationRegistry } from "@/lib/studio-operations";
import { VoiceEditOperations } from "@/lib/voice-edit-operations";
import { StructureOperationRegistry } from "@/lib/structure-operation";

type WorkspaceValues = Record<string, unknown>;

interface DesktopSession {
  openIds: string[];
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  registerExitGuard: (id: string, guard: () => Promise<boolean>) => () => void;
  canCloseTab: (id: string) => Promise<boolean>;
  canCloseAll: () => Promise<boolean>;
  hasPendingCandidateOperations: () => boolean;
  hasPendingBindingOperations: () => boolean;
  hasPendingSegmentEdits: () => boolean;
  hasUnsavedVoiceEdits: () => boolean;
  hasPendingStudioOperations: () => boolean;
  hasPendingAiStarts: () => boolean;
  hasUnsavedConnectionSettings: () => boolean;
  hasUnsavedStructure: () => boolean;
  workspace: (id: string) => WorkspaceValues;
  /** 设置以浮层出现，跨路由保持打开，地址栏用 ?settings= 标记当前分区。 */
  settingsOpen: boolean;
  settingsSection: string;
  openSettings: (section?: string) => void;
  closeSettings: () => void;
}
const SessionContext: Context<DesktopSession | null> =
  import.meta.hot?.data.desktopContext ??
  createContext<DesktopSession | null>(null);
if (import.meta.hot) import.meta.hot.data.desktopContext = SessionContext;
export function DesktopSessionProvider({ children }: { children: ReactNode }) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const workspaces = useRef(new Map<string, WorkspaceValues>());
  const exitGuards = useRef(new Map<string, () => Promise<boolean>>());
  // 浮层状态就是地址栏里的 ?settings=：只有一处真相，
  // 深链、浏览器后退与跨页面导航都自动跟随。
  const settingsParam =
    typeof location.search.settings === "string"
      ? location.search.settings
      : undefined;
  const settingsOpen = settingsParam !== undefined;
  const settingsSection = settingsParam ?? "general";
  const openTab = useCallback(
    (id: string) =>
      setOpenIds((current) =>
        current.includes(id) ? current : [...current, id],
      ),
    [],
  );
  const closeTab = useCallback(
    (id: string) =>
      setOpenIds((current) => current.filter((tab) => tab !== id)),
    [],
  );
  const registerExitGuard = useCallback(
    (id: string, guard: () => Promise<boolean>) => {
      exitGuards.current.set(id, guard);
      return () => {
        if (exitGuards.current.get(id) === guard) exitGuards.current.delete(id);
      };
    },
    [],
  );
  const canCloseTab = useCallback(
    (id: string) => exitGuards.current.get(id)?.() ?? Promise.resolve(true),
    [],
  );
  const canCloseAll = useCallback(async () => {
    for (const guard of exitGuards.current.values()) {
      if (!(await guard())) return false;
    }
    return true;
  }, []);
  const hasPendingCandidateOperations = useCallback(
    () =>
      Array.from(workspaces.current.values()).some(
        (values) =>
          values.candidateOperations instanceof CandidateOperationRegistry &&
          values.candidateOperations.entries.size > 0,
      ),
    [],
  );
  const hasPendingBindingOperations = useCallback(
    () =>
      Array.from(workspaces.current.values()).some(
        (values) =>
          values.bindingOperations instanceof BindingOperationRegistry &&
          values.bindingOperations.hasPending(),
      ),
    [],
  );
  const hasPendingSegmentEdits = useCallback(
    () =>
      Array.from(workspaces.current.values()).some(
        (values) =>
          values.segmentEditRegistry instanceof SegmentEditRegistry &&
          values.segmentEditRegistry.hasPending(),
      ),
    [],
  );
  const hasUnsavedVoiceEdits = useCallback(() => {
    const edits = workspaces.current.get("voices")?.editOperations;
    return edits instanceof VoiceEditOperations && edits.hasUnsaved();
  }, []);
  const hasPendingStudioOperations = useCallback(() => {
    const operations = workspaces.current.get("voices")?.studioOperations;
    return (
      operations instanceof StudioOperationRegistry && operations.hasPending()
    );
  }, []);
  const hasPendingAiStarts = useCallback(
    () =>
      Array.from(workspaces.current.values()).some(
        (values) =>
          values.aiPendingStarts instanceof PendingAiStarts &&
          values.aiPendingStarts.hasPending(),
      ),
    [],
  );
  const hasUnsavedConnectionSettings = useCallback(() => {
    const settings = workspaces.current.get("settings");
    return (
      settings?.unsavedConnection === true ||
      settings?.unsavedEngineSettings === true
    );
  }, []);
  const hasUnsavedStructure = useCallback(
    () =>
      Array.from(workspaces.current.values()).some(
        (values) =>
          (values.structureOperations instanceof StructureOperationRegistry &&
            values.structureOperations.hasPending()) ||
          Object.keys(values).some(
            (key) =>
              key.startsWith("structure:edit:") ||
              key.startsWith("structure:volume:") ||
              key === "structure:rules",
          ),
      ),
    [],
  );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (hasUnsavedStructure()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasUnsavedStructure]);
  const openSettings = useCallback(
    (section = "general") => {
      if (settingsParam === section) return;
      void navigate({
        to: ".",
        search: (previous) => ({ ...previous, settings: section }),
        // 浮层已经打开时只改写当前记录：后退直接回到浮层之前，
        // 而不是逐个回退分区。
        replace: settingsParam !== undefined,
      });
    },
    [navigate, settingsParam],
  );
  const closeSettings = useCallback(() => {
    if (settingsParam === undefined) return;
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, settings: undefined }),
      replace: true,
    });
  }, [navigate, settingsParam]);
  const workspace = useCallback((id: string) => {
    let values = workspaces.current.get(id);
    if (!values) {
      values = {};
      workspaces.current.set(id, values);
    }
    return values;
  }, []);
  return (
    <SessionContext.Provider
      value={{
        openIds,
        openTab,
        closeTab,
        registerExitGuard,
        canCloseTab,
        canCloseAll,
        hasPendingCandidateOperations,
        hasPendingBindingOperations,
        hasPendingSegmentEdits,
        hasUnsavedVoiceEdits,
        hasPendingStudioOperations,
        hasPendingAiStarts,
        hasUnsavedConnectionSettings,
        hasUnsavedStructure,
        workspace,
        settingsOpen,
        settingsSection,
        openSettings,
        closeSettings,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function useDesktopSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("DesktopSessionProvider is required");
  return session;
}
/** View state survives route changes; it never becomes authoritative project data. */
export function useWorkspaceState<T>(
  id: string,
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const { workspace } = useDesktopSession();
  const values = workspace(id);
  const scopeRef = useRef<{
    values: WorkspaceValues;
    key: string;
    initial: T;
  } | null>(null);
  if (
    !scopeRef.current ||
    scopeRef.current.values !== values ||
    scopeRef.current.key !== key
  )
    scopeRef.current = { values, key, initial };
  const scope = scopeRef.current;
  const [, refresh] = useState(0);
  const value = key in values ? (values[key] as T) : scope.initial;
  const update: Dispatch<SetStateAction<T>> = useCallback(
    (next) => {
      // Persist the session draft before React can unmount this view. A state
      // updater may otherwise never run when selection and navigation coincide.
      const current = key in values ? (values[key] as T) : scope.initial;
      const resolved =
        typeof next === "function" ? (next as (value: T) => T)(current) : next;
      values[key] = resolved;
      refresh((version) => version + 1);
    },
    [values, key, scope],
  );
  return [value, update];
}
