import { expect, test } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { AgUiThreadController } from "../../node_modules/@assistant-ui/react-ag-ui/src/runtime/AgUiThreadController.ts";
import { DesktopAgent } from "../../src/lib/ai/agent.ts";
import { PendingAiStarts } from "../../src/lib/ai/pending-starts.ts";
import { configuration, page } from "../helpers/ai-fixtures.mjs";
import { regressionSnapshot } from "../helpers/agent-session-regressions.mjs";

globalThis.window ??= { crypto: globalThis.crypto };

test("browser regression fixture restores an answerable interrupt through the real runtime", async () => {
  const current = page(1, "waiting_for_input");
  const question = { id: "question", reason: "human_input", message: "请补充章节范围", responseSchema: { type: "string" } };
  current.interrupts = [question];
  const calls = [];
  mockIPC((command, args) => {
    calls.push(command);
    if (command === "agent_subscribe") args.channel.onmessage(regressionSnapshot(current));
  });
  const agent = new DesktopAgent({ sessionId: "session", binding: () => ({ configuration, confirmRebind: false, expectedProjectRevision: 1 }), revision: async () => 1, ensureSession: async () => {}, onPage: () => {}, failureText: () => "failed", onResync: () => {}, pending: new PendingAiStarts(), start: async () => { throw new Error("must not start"); } });
  const core = new AgUiThreadController({ agent, logger: { debug() {}, error() {} }, showThinking: true, autoCancelPendingToolCalls: false });
  try {
    agent.restore(current);
    await core.resume({ parentId: null, sourceId: null, runConfig: {} });
    expect(core.getPendingInterrupts()).toEqual({ messageId: "answer", interrupts: [question] });
    expect(calls).not.toContain("agent_start");
    expect(calls).not.toContain("agent_cancel");
  } finally {
    agent.close();
    clearMocks();
  }
});
