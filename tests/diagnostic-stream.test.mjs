import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticStream, diagnosticMessages } from "../src/lib/diagnostic-stream.ts";

const snapshot = (sequence, status = "running", parts = []) => ({
  draftId: "draft", sequence, runId: "run", sessionId: "session", status,
  messages: [{ id: "answer", role: "assistant", parts, interrupted: false }],
});
test("text and tool lifecycles are ordered, and duplicate snapshots emit nothing", () => {
  const projector = new DiagnosticStream();
  assert.deepEqual(projector.push(snapshot(1, "running", [{ type: "text", text: "检查" }])).map((c) => c.type), ["start", "text-start", "text-delta"]);
  assert.deepEqual(projector.push(snapshot(1)), []);
  const parts = [{ type: "text", text: "检查目录" }, { type: "tool", id: "call", name: "directory", input: "{}", output: null, failed: false }];
  assert.deepEqual(projector.push(snapshot(2, "running", parts)).map((c) => c.type), ["text-delta", "tool-input-available"]);
  parts[1] = { ...parts[1], output: '{"chapters":3}' };
  assert.deepEqual(projector.push(snapshot(3, "waiting_for_input", parts)).map((c) => c.type), ["tool-output-available", "text-end", "finish"]);
  assert.deepEqual(projector.push(snapshot(4, "running", parts)), []);
});
test("out-of-order snapshots cannot revert accepted text", () => {
  const projector = new DiagnosticStream(); projector.push(snapshot(3, "running", [{ type: "text", text: "完整" }]));
  assert.deepEqual(projector.push(snapshot(2, "running", [{ type: "text", text: "旧" }])), []);
  assert.equal(projector.push(snapshot(4, "cancelled", [{ type: "text", text: "完整" }])).at(-1).type, "finish");
});
test("restored tool state is derived from host facts rather than a generated message", () => {
  const messages = diagnosticMessages([{ id: "m", role: "assistant", interrupted: true, parts: [{ type: "tool", id: "t", name: "test_rules", input: "{}", output: "interrupted", failed: true }] }]);
  assert.equal(messages[0].parts[0].state, "output-error");
  assert.equal(messages[0].parts[0].errorText, "interrupted");
});


test("AI SDK accepts delayed text and repeated snapshots containing earlier tools", async () => {
  const { readUIMessageStream } = await import("ai");
  const projector = new DiagnosticStream();
  const tool = { type: "tool", id: "call", name: "directory", input: "{}", output: '{"chapters":3}', failed: false };
  const snapshots = [
    snapshot(1, "running", [{ type: "text", text: "前言" }]),
    snapshot(2, "running", [{ type: "text", text: "前言" }, tool]),
    snapshot(3, "running", [{ type: "text", text: "前言完成" }, tool, { type: "text", text: "正" }]),
    snapshot(4, "running", [{ type: "text", text: "前言完成" }, tool, { type: "text", text: "正文" }]),
    snapshot(5, "waiting_for_input", [{ type: "text", text: "前言完成" }, tool, { type: "text", text: "正文完成" }]),
  ];
  const stream = new ReadableStream({ start(controller) {
    for (const current of snapshots) for (const chunk of projector.push(current)) controller.enqueue(chunk);
    controller.close();
  }});
  let result;
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) result = message;
  assert.equal(result.parts.filter(part => part.type === "text").map(part => part.text).join(""), "前言完成正文完成");
  assert.equal(result.parts.find(part => part.type === "dynamic-tool").state, "output-available");
});
