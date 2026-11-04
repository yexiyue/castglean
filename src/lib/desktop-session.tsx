import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
} from "react";
import type { ReactNode, Context, Dispatch, SetStateAction } from "react";

type WorkspaceValues = Record<string, unknown>;
interface DesktopSession {
  openIds: string[];
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  returnTo: string;
  rememberLocation: (path: string) => void;
  workspace: (id: string) => WorkspaceValues;
}
const SessionContext: Context<DesktopSession | null> =
  import.meta.hot?.data.desktopContext ??
  createContext<DesktopSession | null>(null);
if (import.meta.hot) import.meta.hot.data.desktopContext = SessionContext;
export function DesktopSessionProvider({ children }: { children: ReactNode }) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [returnTo, setReturnTo] = useState("/");
  const workspaces = useRef(new Map<string, WorkspaceValues>());
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
  const rememberLocation = useCallback((path: string) => setReturnTo(path), []);
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
        returnTo,
        rememberLocation,
        workspace,
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
  const update: Dispatch<SetStateAction<T>> = (next) =>
    setValue((current) => {
      const resolved =
        typeof next === "function" ? (next as (value: T) => T)(current) : next;
      values[key] = resolved;
      return resolved;
    });
  return [value, update];
}
