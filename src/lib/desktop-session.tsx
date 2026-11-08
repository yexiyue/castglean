import { useLocation, useNavigate } from "@tanstack/react-router";
import type { Context, Dispatch, ReactNode, SetStateAction } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

type WorkspaceValues = Record<string, unknown>;

interface DesktopSession {
  openIds: string[];
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
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
  const [value, setValue] = useState(() =>
    key in values ? (values[key] as T) : initial,
  );
  const update: Dispatch<SetStateAction<T>> = useCallback(
    (next) =>
      setValue((current) => {
        const resolved =
          typeof next === "function"
            ? (next as (value: T) => T)(current)
            : next;
        values[key] = resolved;
        return resolved;
      }),
    [values, key],
  );
  return [value, update];
}
