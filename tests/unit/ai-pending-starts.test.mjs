import assert from "node:assert/strict";
import { test } from "vitest";
import { PendingAiStarts } from "../../src/lib/ai/pending-starts.ts";

test("unresolved starts lock their session and only their own identity can release it", () => {
  const registry = new PendingAiStarts();
  const first = { input: { threadId: "one", runId: "first", messages: [{role:"user",content:"original"}] } };
  const other = { input: { threadId: "one", runId: "other" } };
  const independent = { input: { threadId: "two", runId: "another" } };
  assert.equal(registry.begin(first), true);
  first.input.messages[0].content = "changed";
  assert.equal(registry.get("one").input.messages[0].content, "original");
  assert.equal(registry.begin(other), false);
  assert.equal(registry.begin(independent), true);
  registry.resolve(other);
  assert.equal(registry.get("one").input.runId, first.input.runId);
  registry.resolve(first);
  assert.equal(registry.begin(other), true);
  registry.resolve(other);
  registry.resolve(independent);
  assert.equal(registry.hasPending(), false);
});
