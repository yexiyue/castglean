import assert from "node:assert/strict";
import { test } from "node:test";
import { BindingOperationRegistry } from "../src/lib/binding-operations.ts";

const target = { kind: "character", character_id: "a" };
const edit = { type: "bind", voice: { kind: "library", id: "voice-a" } };
test("identity rename freezes affected chapters before replay and reads after confirmation", async () => {
  let lose = true; let failRead = false; let chapters = ["chapter-a"]; const calls = [];
  const host = {
    async chapterAnalysisCharacterUsage() { if (failRead) throw "read_failed"; return chapters.map(chapterId => ({ chapterId })); },
    async chapterAnalysisCharacterAliases() { return []; },
    async chapterAnalysisCharacters() { return []; },
    async chapterAnalysisSnapshot() { return {}; },
    async chapterAnalysisCharacterEdit(...args) { calls.push(structuredClone(args)); if (lose) { lose = false; throw new Error("lost"); } },
  };
  const registry = new BindingOperationRegistry("project", host, () => "identity-command");
  await registry.startIdentity("a", "chapter-a", 3, { type: "rename", name: "新名字", expected_affected_chapters: [] });
  assert.equal(registry.identityOperation.error, "unknown");
  chapters = ["chapter-b"];
  failRead = true;
  await registry.resumeIdentity();
  assert.deepEqual(calls[1], calls[0]);
  assert.deepEqual(calls[0][4].expected_affected_chapters, ["chapter-a"]);
  assert.equal(registry.identityOperation.error, "read");
  failRead = false;
  await registry.resumeIdentity();
  assert.equal(calls.length, 2);
  assert.equal(registry.identityOperation, null);
});
test("identity conflict preserves request until a successful read and explicit abandon", async () => {
  let failRead = true; let writes = 0;
  const host = {
    async chapterAnalysisCharacterUsage() { if (failRead) throw "read_failed"; return []; },
    async chapterAnalysisCharacterAliases() { return []; },
    async chapterAnalysisCharacters() { return []; },
    async chapterAnalysisSnapshot() { return {}; },
    async chapterAnalysisCharacterEdit() { writes++; throw "conflict"; },
  };
  const registry = new BindingOperationRegistry("project", host, () => "identity-command");
  await registry.startIdentity("a", "chapter-a", 3, { type: "reuse", chapter_id: "chapter-a", existing_id: "b", expected_analysis_revision: 7 });
  await registry.resumeIdentity();
  assert.equal(writes, 1);
  await registry.abandonIdentity();
  assert.equal(registry.identityOperation.abandonFailed, true);
  failRead = false;
  await registry.abandonIdentity();
  assert.equal(registry.identityOperation, null);
});
test("profile receipt recovery freezes target, revisions and text", async () => {
  const calls = []; let lose = true; let failRead = false;
  const host = {
    async localProjectSnapshot() { if (failRead) throw "read_failed"; return { revision: 5 }; },
    async voiceBindingBindings() { return []; },
    async voiceBindingProfiles() { if (failRead) throw "read_failed"; return [{ target, revision: 3, text: "原画像" }]; },
    async voiceBindingProfileSet(...args) { calls.push(structuredClone(args)); if (lose) { lose = false; throw new Error("lost"); } },
  };
  const registry = new BindingOperationRegistry("project", host, () => "profile-command");
  await registry.startProfile(target, "原画像", 4, 2);
  assert.equal(registry.profileOperation.error, "unknown");
  assert.equal(await registry.start(target, edit), false);
  failRead = true;
  await registry.resumeProfile();
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(registry.profileOperation.error, "read");
  failRead = false;
  await registry.resumeProfile();
  assert.equal(calls.length, 2);
  assert.equal(registry.profileOperation, null);
  assert.equal(registry.latestProfiles[0].text, "原画像");
});
test("profile conflict can only be abandoned after a successful read", async () => {
  let failRead = true; let writes = 0;
  const host = {
    async localProjectSnapshot() { if (failRead) throw "read_failed"; return { revision: 6 }; },
    async voiceBindingBindings() { return []; },
    async voiceBindingProfiles() { return []; },
    async voiceBindingProfileSet() { writes++; throw "conflict"; },
  };
  const registry = new BindingOperationRegistry("project", host, () => "profile-command");
  await registry.startProfile(target, "草稿", 4, 2);
  await registry.resumeProfile();
  assert.equal(writes, 1);
  await registry.abandonProfile();
  assert.equal(registry.profileOperation.abandonFailed, true);
  failRead = false;
  await registry.abandonProfile();
  assert.equal(registry.profileOperation, null);
});
function fixture() {
  const calls = [];
  const state = { projectRevision: 4, bindingRevision: 2, failRead: false, loseReply: false, conflict: false };
  const host = {
    async localProjectSnapshot() { if (state.failRead) throw "read_failed"; return { revision: state.projectRevision }; },
    async voiceBindingBindings() { if (state.failRead) throw "read_failed"; return [{ target, revision: state.bindingRevision }]; },
    async voiceBindingEdit(...args) { calls.push(structuredClone(args)); if (state.conflict) throw "conflict"; if (state.loseReply) { state.loseReply = false; state.projectRevision++; state.bindingRevision++; throw new Error("reply lost"); } },
  };
  return { state, calls, registry: new BindingOperationRegistry("project", host, () => "command-1") };
}
test("unknown receipt replays frozen identity and revisions, not a new target", async () => {
  const { state, calls, registry } = fixture();
  state.loseReply = true;
  await registry.start(target, edit);
  assert.equal(registry.operation.error, "unknown");
  assert.equal(await registry.start({ kind: "narrator" }, { type: "unbind" }), false);
  await registry.resume();
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(registry.operation, null);
  assert.equal(registry.latest.project.revision, 5);
});
test("confirmed write and failed refresh only reads on recovery", async () => {
  const { state, calls, registry } = fixture();
  let reads = 0;
  const host = {
    async localProjectSnapshot() { if (++reads > 1 && state.failRead) throw "read_failed"; return { revision: 4 }; },
    async voiceBindingBindings() { return []; },
    async voiceBindingEdit(...args) { calls.push(args); state.failRead = true; },
  };
  const operations = new BindingOperationRegistry("project", host, () => "command-2");
  await operations.start(target, edit);
  assert.equal(operations.operation.phase, "read");
  assert.equal(operations.operation.error, "read");
  state.failRead = false;
  await operations.resume();
  assert.equal(calls.length, 1);
  assert.equal(operations.operation, null);
  assert.equal(registry.operation, null);
});
test("conflict cannot replay and explicit abandon requires a successful read", async () => {
  const { state, calls, registry } = fixture();
  state.conflict = true;
  await registry.start(target, edit);
  assert.equal(registry.operation.error, "rejected");
  await registry.resume();
  assert.equal(calls.length, 1);
  state.failRead = true;
  await registry.abandon();
  assert.ok(registry.operation);
  state.failRead = false;
  await registry.abandon();
  assert.equal(registry.operation, null);
});
test("preflight failure retains the draft and retry reads before submitting", async () => {
  const { state, calls, registry } = fixture();
  state.failRead = true;
  await registry.start(target, edit);
  assert.equal(registry.operation.phase, "prepare");
  assert.equal(registry.operation.error, "prepare");
  assert.equal(calls.length, 0);
  state.failRead = false;
  await registry.resume();
  assert.equal(calls.length, 1);
  assert.equal(registry.operation, null);
});
