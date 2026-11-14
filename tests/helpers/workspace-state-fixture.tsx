import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DesktopSessionProvider, useWorkspaceState } from "../../src/lib/desktop-session";

function Editor({ close }: { close: () => void }) {
  const [value, setValue] = useWorkspaceState("fixture", "draft", 0);
  return <><output>{value}</output><button onClick={() => {
    setValue(previous => previous + 1);
    setValue(previous => previous + 1);
    close();
  }}>更新并离开</button></>;
}

function Harness() {
  const [open, setOpen] = useState(true);
  const [workspaceId, setWorkspaceId] = useState("one");
  const [draftKey, setDraftKey] = useState("a");
  const [value, setValue] = useWorkspaceState(workspaceId, draftKey, workspaceId === "one" ? 10 : 20);
  return <>
    {open ? <Editor close={() => setOpen(false)} /> : <button onClick={() => setOpen(true)}>重新打开</button>}
    <output aria-label="scoped draft">{value}</output>
    <button onClick={() => setValue(v => v + 1)}>修改当前草稿</button>
    <button onClick={() => setDraftKey(key => key === "a" ? "b" : "a")}>切换键</button>
    <button onClick={() => setWorkspaceId(id => id === "one" ? "two" : "one")}>切换工程</button>
    <button onClick={() => { (window as any).lateDraftUpdate = () => setValue(v => v + 100); }}>保留旧回调</button>
  </>;
}

const rootRoute = createRootRoute({ component: () => <DesktopSessionProvider><Harness /></DesktopSessionProvider> });
const router = createRouter({ routeTree: rootRoute });
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
