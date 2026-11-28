import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import { SessionInput } from "../../src/components/assistant-ui/input/session-input";
import { AgentWorkspace } from "../../src/components/assistant-ui/thread/agent-workspace";
import { SessionPalette } from "../../src/components/assistant-ui/thread/session-palette";
import { useAiSession } from "../../src/hooks/use-ai-session";
import { DesktopSessionProvider } from "../../src/lib/desktop-session";
import { messages as zh } from "../../src/locales/zh/messages.po";
import { messages as en } from "../../src/locales/en/messages.po";
import { configuration, page } from "./ai-fixtures.mjs";
import { regressionSnapshot } from "./agent-session-regressions.mjs";
import "../../src/index.css";

const scenario = new URLSearchParams(location.search).get("scenario");
const calls: string[] = [];
const submissions: unknown[] = [];
const question = { id: "question", reason: "human_input", message: "请补充章节范围", responseSchema: { type: "string" } };
const current = page(1, (scenario === "interrupt" || scenario === "casting") ? "waiting_for_input" : scenario === "stop" ? "running" : "succeeded");
current.session.title = "已有会话";
if (scenario === "retry") {
  current.run.status = "failed";
  current.messages.unshift({ id: "question-message", role: "user", content: "检查分章" });
}
if (scenario === "interrupt") current.interrupts = [question];
if (scenario === "casting") {
  current.interrupts = [{
    id: "casting-question",
    reason: "casting_audition_approval",
    responseSchema: { type: "object" },
    metadata: { castingAuditionPlan: { items: [
      { id: "one", targetName: "甲", text: "原文甲", resource: "Ready", source: { kind: "directory", label: "甲声线", backend: "qwen", model: "clone", device: "Cpu" } },
      { id: "two", targetName: "乙", text: "原文乙", resource: "Ready", source: { kind: "design", engine: "designer", description: "清亮的声音", device: "Metal" } },
      { id: "three", targetName: "丙", text: "原文丙", resource: { Missing: { missing_bytes: 2048 } }, source: { kind: "design", engine: "designer", description: "低沉的声音", device: "Metal" } },
    ] } },
  }];
}
if (scenario === "stop") current.invocations = [{ id: "task", runId: "run", name: "章节分析", parentId: null, toolCallId: null, messageId: "answer", status: "running", error: null }];
let channel: { onmessage: (value: unknown) => void } | undefined;
function snapshot(restore = true) {
  const snapshot = regressionSnapshot(current, restore);
  if (current.run.status === "failed")
    snapshot.events.splice(-1, 1, { type: "RUN_ERROR", message: "task_failed" });
  return snapshot;
}
Object.assign(window, {
  isTauri: true,
  agentRegression: {
    calls,
    submissions,
    finishRetry(status: "failed" | "succeeded") {
      current.run.status = status;
      current.session.sequence++;
      channel!.onmessage(snapshot(false));
    },
    finishCancellation() {
      current.run.status = "cancelled";
      current.session.sequence++;
      channel!.onmessage(snapshot(false));
    },
  },
});
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
    case "agent_start":
      submissions.push(args);
      if (scenario === "retry") {
        current.run.retryOf = current.run.id;
        current.run.id = (args!.request as { input: { runId: string } }).input.runId;
        current.run.status = "running";
        current.session.sequence++;
        return structuredClone(current.run);
      }
      throw "storage_failed";
    case "agent_request_status": return null;
    case "agent_cancel":
      current.run.status = "cancelling";
      current.session.sequence++;
      channel!.onmessage(snapshot(false));
      return current.run;
    default: throw new Error(`Unexpected IPC: ${command}`);
  }
});
const fixtureParams = new URLSearchParams(location.search);
const locale = fixtureParams.get("locale") === "en" ? "en" : "zh";
document.documentElement.classList.toggle("dark", fixtureParams.get("theme") === "dark");
i18n.load(locale, locale === "en" ? en : zh);
i18n.activate(locale);
function Harness() {
  const ai = useAiSession({ projectId: "project", taskKind: "chapter_splitting", title: "新会话", binding: () => ({ configuration, confirmRebind: false, expectedProjectRevision: 1 }), failureText: "请求失败" });
  return <main className="flex h-screen flex-col">
    <SessionPalette ai={ai} />
    <output aria-label="当前会话">{ai.sessionId}</output>
    <AgentWorkspace
      key={ai.sessionId}
      ai={ai}
      projectId="project"
      composer={<SessionInput
        label="消息输入"
        placeholder=""
        value=""
        onChange={() => {}}
        disabled={false}
        active={ai.active}
        answering={(ai.snapshot?.interrupts.length ?? 0) > 0}
        answerTarget={`agent-answers-${ai.sessionId}`}
        stopping={ai.snapshot?.run?.status === "cancelling"}
        onSend={ai.send}
        onStop={ai.stop}
      />}
    />
  </main>;
}
const rootRoute = createRootRoute({ component: () => <DesktopSessionProvider><I18nProvider i18n={i18n}><Harness /></I18nProvider></DesktopSessionProvider> });
const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
