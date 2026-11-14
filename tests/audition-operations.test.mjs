import assert from "node:assert/strict";
import { test } from "node:test";
import { StudioOperationRegistry } from "../src/lib/studio-operations.ts";
const request = { kind: "audition", backend: "kokoro", model: "kokoro", device: "Cpu", voice: { kind: "candidate", id: "candidate-1" }, text: "公开试听", style: null };
test("candidate save recovers an unknown receipt and only reads after confirmation", async () => {
  let candidate = { id: "candidate-1", saved_id: null }; let lost = true; let failRead = false; let writes = 0;
  const host = {
    async saveVoiceCandidate() { writes++; candidate.saved_id = "asset-1"; if (lost) { lost = false; throw new Error("lost"); } failRead = true; return { id: "asset-1" }; },
    async voiceStudioSnapshot() { if (failRead) throw "read_failed"; return { jobs: [], candidates: candidate ? [candidate] : [], sequence: 1 }; },
  };
  const registry = new StudioOperationRegistry(host);
  await registry.startCandidate("candidate-1", "公开候选", "save");
  assert.equal(await registry.start("audition", request), false);
  await registry.resumeCandidate("candidate-1");
  assert.equal(writes, 1);
  await registry.checkCandidate("candidate-1");
  assert.equal(registry.candidates.get("candidate-1").current, "saved");
  await registry.resumeCandidate("candidate-1");
  assert.equal(writes, 2);
  assert.equal(registry.candidates.get("candidate-1").phase, "read");
  failRead = false;
  await registry.resumeCandidate("candidate-1");
  assert.equal(writes, 2);
  assert.equal(registry.candidates.size, 0);
});
test("missing candidate after a lost removal requires explicit stop", async () => {
  let candidate = { id: "candidate-1", saved_id: null }; let writes = 0; let cleaned = 0;
  const host = { async discardVoiceCandidate() { writes++; candidate = null; throw new Error("lost"); }, async voiceStudioSnapshot() { return { jobs: [], candidates: candidate ? [candidate] : [], sequence: 1 }; } };
  const registry = new StudioOperationRegistry(host, () => "key", () => { cleaned++; });
  await registry.startCandidate("candidate-1", "公开候选", "remove");
  await registry.checkCandidate("candidate-1");
  assert.equal(registry.candidates.get("candidate-1").current, "missing");
  await registry.resumeCandidate("candidate-1");
  assert.equal(writes, 1);
  registry.stopCandidateRecovery("candidate-1");
  assert.equal(cleaned, 1);
  assert.equal(registry.candidates.size, 0);
});
test("design origin survives a lost receipt and follows the resulting candidate", async () => {
  let lost = true;
  const host = { async startVoiceJob() { if (lost) { lost = false; throw new Error("lost"); } return 8; }, async voiceStudioSnapshot() { return { jobs: [{ id: 8, candidate: null }], candidates: [], sequence: 1 }; } };
  const registry = new StudioOperationRegistry(host, () => "key");
  const origin = { projectId: "project-a", target: { kind: "character", character_id: "character-a" } };
  await registry.start("design", { kind: "design", engine: "engine", device: "Cpu", name: "name", description: "description", text: "text", seed: null }, origin);
  origin.target.character_id = "character-b";
  await registry.resume("design");
  registry.rememberJobs([{ id: 8, candidate: "candidate-a" }]);
  assert.equal(registry.originForCandidate("candidate-a").target.character_id, "character-a");
  assert.equal(registry.originForCandidate("unknown"), null);
});
test("lost response retries the same request identity and preserves target", async () => {
  const calls = []; let lost = true;
  const registry = new StudioOperationRegistry({ async startVoiceJob(...args) { calls.push(structuredClone(args)); if (lost) { lost = false; throw new Error("lost reply"); } return 8; }, async voiceStudioSnapshot() { return { jobs: [{ id: 8 }], candidates: [], sequence: 1 }; } }, () => "audition-key");
  await registry.start("candidate-1", request);
  assert.equal(registry.entries.get("candidate-1").phase, "start");
  assert.equal(await registry.start("candidate-1", { ...request, text: "other" }), false);
  request.text = "changed afterwards";
  await registry.resume("candidate-1");
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(calls[0][1].text, "公开试听");
  assert.equal(registry.entries.size, 0);
});
test("confirmed job with failed refresh retries only the read", async () => {
  let starts = 0; let fail = true;
  const registry = new StudioOperationRegistry({ async startVoiceJob() { starts++; return 9; }, async voiceStudioSnapshot() { if (fail) throw new Error("read failed"); return { jobs: [{ id: 9 }], candidates: [], sequence: 1 }; } }, () => "key");
  await registry.start("voice", { ...request, text: "原文" });
  assert.equal(registry.entries.get("voice").phase, "read");
  fail = false;
  await registry.resume("voice");
  assert.equal(starts, 1);
  assert.equal(registry.entries.size, 0);
});
test("abandoning an unknown result requires a successful read", async () => {
  let fail = true;
  const registry = new StudioOperationRegistry({ async startVoiceJob() { throw new Error("lost reply"); }, async voiceStudioSnapshot() { if (fail) throw new Error("read failed"); return { jobs: [], candidates: [], sequence: 1 }; } }, () => "key");
  await registry.start("voice", request);
  await registry.abandon("voice");
  assert.equal(registry.entries.get("voice").abandonFailed, true);
  fail = false;
  await registry.abandon("voice");
  assert.equal(registry.entries.size, 0);
});
test("a created task absent from the snapshot is not reported as recovered", async () => {
  let starts = 0;
  const registry = new StudioOperationRegistry({ async startVoiceJob() { starts++; return 9; }, async voiceStudioSnapshot() { return { jobs: [], candidates: [], sequence: 1 }; } }, () => "key");
  await registry.start("voice", request);
  assert.equal(registry.entries.get("voice").missing, true);
  await registry.resume("voice");
  assert.equal(starts, 1);
  await registry.abandon("voice");
  assert.equal(registry.entries.size, 0);
});
test("a dismissed identity or exhausted session does not silently start a new task", async () => {
  for (const [message, reason] of [["request already dismissed", "retired"], ["session task identity limit reached; restart the application", "limit"]]) {
    let starts = 0;
    const registry = new StudioOperationRegistry({ async startVoiceJob() { starts++; throw message; }, async voiceStudioSnapshot() { return { jobs: [], candidates: [], sequence: 1 }; } }, () => "key");
    await registry.start("voice", request);
    assert.equal(registry.entries.get("voice").startError, reason);
    await registry.resume("voice");
    assert.equal(starts, 1);
    await registry.abandon("voice");
    assert.equal(registry.entries.size, 0);
  }
});
