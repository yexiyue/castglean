import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import { AgentWorkspace } from "../../src/components/assistant-ui/thread/agent-workspace";
import { useAiSession } from "../../src/hooks/use-ai-session";
import { DesktopSessionProvider } from "../../src/lib/desktop-session";
import { messages } from "../../src/locales/zh/messages.po";
import { configuration, page } from "./ai-fixtures.mjs";
import { regressionSnapshot } from "./agent-session-regressions.mjs";
import "../../src/index.css";

const scenario = new URLSearchParams(location.search).get("scenario");
const calls: string[] = [];
const question = { id: "question", reason: "human_input", message: "请补充章节范围", responseSchema: { type: "string" } };
const current = page(1, scenario === "interrupt" ? "waiting_for_input" : scenario === "stop" ? "running" : "succeeded");
current.session.title = "已有会话";
if (scenario === "interrupt") current.interrupts = [question];
if (scenario === "stop") current.invocations = [{ id: "task", runId: "run", name: "章节分析", parentId: null, toolCallId: null, messageId: "answer", status: "running", error: null }];
let channel: { onmessage: (value: unknown) => void } | undefined;
function snapshot(restore = true) {
  return regressionSnapshot(current, restore);
}
Object.assign(window, { isTauri: true, agentRegression: { calls } });
mockIPC((command, args) => {
  calls.push(command);
  switch (command) {
    case "agent_sessions": return { sessions: [current.session], before: null };
    case "agent_history":
      return structuredClone(current);
    case "agent_subscribe":
      channel = args!.channel as typeof channel;
      channel!.onmessage(snapshot());
      return;
    case "agent_acknowledge": case "agent_unsubscribe": return;
    case "agent_start": throw "storage_failed";
    case "agent_request_status": return null;
    case "agent_cancel":
      current.run.status = "cancelling";
      current.session.sequence++;
      channel!.onmessage(snapshot(false));
      return current.run;
    default: throw new Error(`Unexpected IPC: ${command}`);
  }
});
i18n.load("zh", messages);
i18n.activate("zh");
function Harness() {
  const ai = useAiSession({ projectId: "project", taskKind: "chapter_splitting", title: "新会话", binding: () => ({ configuration, confirmRebind: false, expectedProjectRevision: 1 }), failureText: "请求失败" });
  return <main className="flex h-screen flex-col">
    <button type="button" onClick={ai.newSession}>新建会话</button>
    <output aria-label="当前会话">{ai.sessionId}</output>
    <AgentWorkspace key={ai.sessionId} ai={ai} projectId="project" />
  </main>;
}
const rootRoute = createRootRoute({ component: () => <DesktopSessionProvider><I18nProvider i18n={i18n}><Harness /></I18nProvider></DesktopSessionProvider> });
const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
