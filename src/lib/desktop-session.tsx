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
import { PendingAiStarts } from "@/lib/ai";
import { BindingOperationRegistry } from "@/lib/binding-operations";
import { CandidateOperationRegistry } from "@/lib/candidate-operations";
import { SegmentEditRegistry } from "@/lib/segment-edit-registry";
import { StructureOperationRegistry } from "@/lib/structure-operation";
import { StudioOperationRegistry } from "@/lib/studio-operations";
import { VoiceEditOperations } from "@/lib/voice-edit-operations";

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
  /** 打开设置页面（/settings），可带分区深链；已是设置页时仅替换分区。
   *  同时记住触发元素（优先 returnFocusTo，如菜单触发按钮——菜单项本身
   *  在 portal 里，设置页打开后会随容器隐藏而不可聚焦），离开设置页时
   *  由 restoreSettingsFocus 归还焦点。 */
  openSettings: (section?: string, returnFocusTo?: HTMLElement) => void;
  /** 焦点归还：回到打开设置前的元素（对应对话框时代的关闭归还焦点）。 */
  restoreSettingsFocus: () => (() => void) | undefined;
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
  // 浮层已路由化：设置是独立页面（/settings?section=），
  // 入口与失败路径统一走 openSettings 导航。
  const onSettingsPage = location.pathname === "/settings";
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
          values.agentPendingStarts instanceof PendingAiStarts &&
          values.agentPendingStarts.hasPending(),
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
  const settingsOpener = useRef<{
    element: HTMLElement;
    id: string;
    label: string | null;
    text: string;
  } | null>(null);
  const openSettings = useCallback(
    (section = "general", returnFocusTo?: HTMLElement) => {
      if (!onSettingsPage) {
        const element = returnFocusTo ?? document.activeElement;
        settingsOpener.current =
          element instanceof HTMLElement
            ? {
                element,
                id: element.id,
                label: element.getAttribute("aria-label"),
                text: element.textContent ?? "",
              }
            : null;
      }
      void navigate({
        to: "/settings",
        // 保留既有参数（fixture/主题等透传），section 指向目标分区
        search: (previous) => ({ ...previous, section }),
        // 已在设置页时只替换分区：后退一次离开设置，
        // 不逐个回退分区。
        replace: onSettingsPage,
      });
    },
    [navigate, onSettingsPage],
  );
  const restoreSettingsFocus = useCallback(() => {
    const opener = settingsOpener.current;
    settingsOpener.current = null;
    if (!opener) return;
    let focused: HTMLElement | undefined;
    const focusOpener = (): boolean => {
      if (focused?.isConnected) return true;
      if (focused && document.activeElement !== document.body) return true;
      const matches = (element: HTMLElement): boolean => {
        if (element.getClientRects().length === 0) return false;
        // Generated component IDs can be reused by a different control after remount.
        if (opener.label)
          return element.getAttribute("aria-label") === opener.label;
        if (opener.id) return element.id === opener.id;
        return !!opener.text && element.textContent === opener.text;
      };
      const target =
        opener.element.isConnected && matches(opener.element)
          ? opener.element
          : Array.from(
              document.querySelectorAll<HTMLElement>(opener.element.tagName),
            ).find(matches);
      if (!target) return false;
      target.focus({ preventScroll: true });
      if (document.activeElement === target) focused = target;
      return focused === target;
    };
    // A loading shell can contain the same trigger before the destination remounts.
    // Follow its replacement without taking focus away from a control the user chose.
    const observer = new MutationObserver(focusOpener);
    const timeout = window.setTimeout(cleanup, 3000);
    function cleanup(): void {
      observer.disconnect();
      window.clearTimeout(timeout);
    }
    observer.observe(document.body, { childList: true, subtree: true });
    focusOpener();
    return cleanup;
  }, []);
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
        openSettings,
        restoreSettingsFocus,
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
/** Route loading/failure navigation can render before the desktop session mounts. */
export function useOpenSettings(): DesktopSession["openSettings"] {
  const session = useContext(SessionContext);
  const navigate = useNavigate();
  return useCallback(
    (section = "general", returnFocusTo?: HTMLElement) => {
      if (session) session.openSettings(section, returnFocusTo);
      else void navigate({ to: "/settings", search: { section } });
    },
    [session, navigate],
  );
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
