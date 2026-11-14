import assert from "node:assert/strict";
import { test } from "vitest";
import { PendingAiStarts } from "../../src/lib/ai/pending-starts.ts";

test("unresolved starts lock their session and only their own identity can release it", () => {
  const registry = new PendingAiStarts();
  const first = { sessionId: "one", requestId: "first", trigger: { type: "message", message: "original" } };
  const other = { sessionId: "one", requestId: "other" };
  const independent = { sessionId: "two", requestId: "another" };
  assert.equal(registry.begin(first), true);
  first.trigger.message = "changed";
  assert.equal(registry.get("one").trigger.message, "original");
  assert.equal(registry.begin(other), false);
  assert.equal(registry.begin(independent), true);
  registry.resolve(other);
  assert.equal(registry.get("one").requestId, first.requestId);
  registry.resolve(first);
  assert.equal(registry.begin(other), true);
  registry.resolve(other);
  registry.resolve(independent);
  assert.equal(registry.hasPending(), false);
});
