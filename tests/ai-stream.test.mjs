import assert from "node:assert/strict";
import test from "node:test";
import { ResponseStream, SessionProjection, ResyncRequired, aiMessages } from "../src/lib/ai/stream.ts";

import { message, page, update } from "./helpers/ai-fixtures.mjs";

test("ordered UTF-16 deltas are applied once and gaps never partially mutate a projection", () => {
  const projection = new SessionProjection(); projection.restore(page());
  const delta = update(page(1), [{ type: "text_delta", messageId: "answer", fromVersion: 1, version: 2, part: 0, offsetUtf16: 2, text: "中文" }]);
  assert.equal(projection.apply(delta), true); assert.equal(projection.apply(delta), false);
  assert.equal(projection.snapshot().messages[0].parts.parts[0].text, "🙂中文");
  assert.throws(() => projection.apply(update(page(3))), ResyncRequired);
  assert.throws(() => projection.apply(update(page(2), [
    { type: "message", message: { ...message("not committed"), id: "other", ordinal: 2 } },
    { type: "text_delta", messageId: "answer", fromVersion: 2, version: 3, part: 0, offsetUtf16: 1, text: "bad" },
  ])), ResyncRequired);
  assert.equal(projection.snapshot().messages.length, 1);
  assert.equal(projection.snapshot().session.sequence, 1);
});

test("older history cannot advance the live cursor or overwrite a newer message", () => {
  const projection = new SessionProjection(); projection.restore(page(7, "running", [message("new", 3)]));
  projection.prepend({ ...page(99), messages: [{ ...message("old", 1) }, { ...message("earlier"), id: "before", ordinal: 0 }], before: 0 });
  const snapshot = projection.snapshot();
  assert.equal(snapshot.session.sequence, 7); assert.equal(snapshot.messages[1].parts.parts[0].text, "new");
  assert.deepEqual(snapshot.messages.map(m => m.id), ["before", "answer"]);
});

test("SDK chunks preserve text/tool ordering and do not close text merely on tool arrival", () => {
  const projector = new ResponseStream();
  const answer = message("before");
  answer.parts.parts.push({ type: "tool", id: "call", name: "test_rules", input: {}, state: "running", output: null, result: null });
  const initial = projector.push(page(1, "running", [answer]), "run", "Failed");
  assert.deepEqual(initial.map(c => c.type), ["start", "text-start", "text-delta", "tool-input-available"]);
  assert.deepEqual(projector.push(page(1, "running", [answer]), "run", "Failed"), []);
  const complete = structuredClone(answer); complete.version = 2;
  complete.parts.parts[1] = { ...complete.parts.parts[1], state: "completed", output: { proposal_id: "p" }, result: { kind: "chapter_split_proposal", id: "p", summary: "方案" } };
  complete.parts.parts.push({ type: "text", text: "after" });
  const final = projector.push(page(2, "waiting_for_input", [complete]), "run", "Failed");
  assert.deepEqual(final.map(c => c.type), ["tool-output-available", "text-end", "text-start", "text-delta", "text-end", "finish"]);
  assert.equal(projector.done, true);
});

test("resync replaces a reply through the SDK reset protocol; unknown results remain inert data", () => {
  const projector = new ResponseStream();projector.push(page(), "run", "Failed");
  assert.deepEqual(projector.reset(), [{ type: "reset-step" }]);
  const answer = message("authoritative");
  answer.parts.parts.push({ type: "tool", id: "call", name: "future", input: {}, state: "interrupted", output: "private raw error", result: null });
  const messages = aiMessages([answer], "Safe failure");
  assert.equal(messages[0].parts[1].errorText, "Safe failure");
  assert.equal(projector.push(page(4, "cancelled", [answer]), "run", "Safe failure")[0].messageId, "answer");
  const unknown = structuredClone(answer); unknown.parts.parts[1] = { ...unknown.parts.parts[1], state: "completed", output: { directive: "arbitrary" }, result: { kind: "future_kind", id: "result", summary: "Safe summary" } };
  const projection = new SessionProjection(); projection.restore(page(5, "waiting_for_input", [unknown]));
  assert.equal(projection.snapshot().messages[0].parts.parts[1].result.summary, "Safe summary");
});
