import assert from "node:assert/strict";
import test from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

globalThis.window = { crypto: globalThis.crypto };
const { DiagnosticTransport } = await import("../src/lib/diagnostic-transport.ts");

const snapshot = (status = "running", sequence = 1) => ({
  draftId: "draft", sessionId: "session", runId: "request", sequence, status,
  messages: [{ id: "answer", role: "assistant", parts: [], interrupted: false }],
});
const options = (signal) => ({
  trigger: "submit-message", abortSignal: signal,
  messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "Check" }] }],
});

test("teardown abort detaches without cancelling; restored transport receives terminal state", async () => {
  const calls = [];
  let channel;
  mockIPC((command, args) => {
    calls.push(command);
    if (command === "diagnostic_start") return snapshot();
    if (command === "diagnostic_subscribe") channel = args.channel;
  });
  try {
    const updates = [];
    const transport = new DiagnosticTransport("draft", () => ({ selection: { connectionId: "c", modelId: "m" }, revision: 1, confirmRebind: false }), s => updates.push(s), "Failed");
    // React StrictMode runs setup/cleanup/setup with the same memoized transport.
    transport.dispose();
    transport.restore(null);
    const abort = new AbortController();
    const stream = await transport.sendMessages(options(abort.signal));
    assert.ok(channel, "restored transport must subscribe");
    transport.dispose();
    abort.abort();
    assert.equal(calls.includes("diagnostic_cancel"), false);
    transport.restore(snapshot());
    const resumed = await transport.reconnectToStream({});
    await transport.stop();
    assert.equal(calls.filter(c => c === "diagnostic_cancel").length, 1);
    channel.onmessage(snapshot("cancelled", 2));
    const reader = resumed.getReader();
    const chunks = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value.type);
    }
    assert.equal(updates.at(-1).status, "cancelled");
    assert.equal(chunks.at(-1), "finish");
    assert.equal((await stream.getReader().read()).done, false); // buffered start
  } finally { clearMocks(); }
});

test("explicit stop during startup uses request identity; teardown cannot resubscribe", async () => {
  let finish;
  let started;
  const cancellations = [];
  let subscriptions = 0;
  mockIPC((command, args) => {
    if (command === "diagnostic_start") {
      started = args.request.requestId;
      return new Promise(resolve => { finish = resolve; });
    }
    if (command === "diagnostic_cancel") cancellations.push(args.sessionId);
    if (command === "diagnostic_subscribe") subscriptions++;
  });
  try {
    const transport = new DiagnosticTransport("draft", () => ({ selection: { connectionId: "c", modelId: "m" }, revision: 1, confirmRebind: false }), () => {}, "Failed");
    const pending = transport.sendMessages(options());
    await transport.stop();
    assert.deepEqual(cancellations, [started]);
    transport.dispose();
    finish(snapshot("cancelled"));
    const stream = await pending;
    assert.equal((await stream.getReader().read()).done, true);
    assert.equal(subscriptions, 0);
  } finally { clearMocks(); }
});

test("out-of-order host notifications cannot revert the business snapshot", async () => {
  let channel;
  mockIPC((command, args) => {
    if (command === "diagnostic_subscribe") channel = args.channel;
  });
  try {
    const updates = [];
    const transport = new DiagnosticTransport("draft", () => null, s => updates.push(s), "Failed");
    transport.restore(snapshot("running", 4));
    const stream = await transport.reconnectToStream({});
    channel.onmessage(snapshot("running", 3));
    channel.onmessage({ ...snapshot("running", 5), sessionId: "other" });
    channel.onmessage(snapshot("running", 4));
    assert.deepEqual(updates.map(s => s.sequence), [4]);
    channel.onmessage(snapshot("waiting_for_input", 6));
    channel.onmessage(snapshot("running", 5));
    assert.deepEqual(updates.map(s => s.sequence), [4, 6]);
    assert.equal(updates.at(-1).status, "waiting_for_input");
    await stream.cancel();
  } finally { clearMocks(); }
});

test("start sends the exact model revision and explicit rebind decision", async () => {
  let sent;
  mockIPC((command, args) => {
    if (command === "diagnostic_start") {
      sent = args.request;
      return snapshot("waiting_for_input");
    }
  });
  try {
    const selected = { connectionId: "c", modelId: "m" };
    const transport = new DiagnosticTransport("draft", () => ({
      selection: selected, revision: 7, confirmRebind: true,
    }), () => {}, "Failed");
    const stream = await transport.sendMessages(options());
    assert.deepEqual(sent.selected, selected);
    assert.equal(sent.expectedConfigurationRevision, 7);
    assert.equal(sent.confirmRebind, true);
    await stream.cancel();
  } finally { clearMocks(); }
});

test("startup credential failure restores the committed failed run without replaying the request", async () => {
  const calls = [];
  let request;
  mockIPC((command,args) => {
    calls.push(command);
    if (command === "diagnostic_start") {
      request = args.request.requestId;
      throw {domain:"llm",error:"credential_unavailable"};
    }
    if (command === "diagnostic_snapshot") return {...snapshot("failed",8),runId:request,error:"credential_unavailable"};
  });
  try {
    const updates = [];
    const transport = new DiagnosticTransport("draft",() => ({selection:{connectionId:"c",modelId:"m"},revision:1,confirmRebind:false}),s=>updates.push(s),"Safe failure");
    await assert.rejects(transport.sendMessages(options()),error => error.message === "Safe failure" && error.detail.error === "credential_unavailable");
    assert.equal(updates.at(-1).status,"failed");
    assert.equal(updates.at(-1).error,"credential_unavailable");
    assert.equal(calls.filter(c=>c==="diagnostic_start").length,1);
    assert.equal(calls.includes("diagnostic_subscribe"),false);
  } finally { clearMocks(); }
});

test("a lost startup response reconnects to the committed run without starting another model call", async () => {
  let request;
  let starts = 0;
  let channel;
  mockIPC((command,args) => {
    if (command === "diagnostic_start") {
      starts++;
      request = args.request.requestId;
      throw new Error("lost IPC response");
    }
    if (command === "diagnostic_snapshot") return {...snapshot(),runId:request};
    if (command === "diagnostic_subscribe") channel = args.channel;
  });
  try {
    const updates = [];
    const transport = new DiagnosticTransport("draft",() => ({selection:{connectionId:"c",modelId:"m"},revision:1,confirmRebind:false}),s=>updates.push(s),"Safe failure");
    const stream = await transport.sendMessages(options());
    assert.ok(channel);
    channel.onmessage({...snapshot("waiting_for_input",2),runId:request});
    const reader = stream.getReader();
    while (!(await reader.read()).done) {}
    assert.equal(updates.at(-1).status,"waiting_for_input");
    assert.equal(starts,1);
  } finally { clearMocks(); }
});

test("a structured startup read failure follows the recovered run through completion", async () => {
  for (const status of ["running", "waiting_for_input"]) {
    let request;
    let channel;
    let starts = 0;
    mockIPC((command,args) => {
      if (command === "diagnostic_start") {
        starts++;
        request = args.request.requestId;
        throw {domain:"project",error:"read_failed"};
      }
      if (command === "diagnostic_snapshot") return {...snapshot(status),runId:request};
      if (command === "diagnostic_subscribe") channel = args.channel;
    });
    try {
      const updates = [];
      const transport = new DiagnosticTransport("draft",() => ({selection:{connectionId:"c",modelId:"m"},revision:1,confirmRebind:false}),s=>updates.push(s),"Safe failure");
      const stream = await transport.sendMessages(options());
      if (status === "running") {
        assert.ok(channel, "an accepted active run must stay subscribed after a snapshot read error");
        channel.onmessage({...snapshot("waiting_for_input",2),runId:request});
      }
      const reader = stream.getReader();
      while (!(await reader.read()).done) {}
      assert.equal(updates.at(-1).status,"waiting_for_input");
      assert.equal(starts,1);
    } finally { clearMocks(); }
  }
});
