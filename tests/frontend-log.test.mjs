import assert from "node:assert/strict";
import { test } from "node:test";
import { frontendHandlers } from "../src/lib/frontend-log.ts";

test("exception handlers report categories without forwarding sensitive values", () => {
  const calls = [];
  const handlers = frontendHandlers((...args) => calls.push(args));
  const sensitive = { message: "私人正文 sk-secret", stack: "sk-secret", filename: "私人正文" };
  handlers.scriptError(sensitive);
  handlers.unhandledRejection({ reason: sensitive });
  handlers.renderError(sensitive);
  assert.deepEqual(calls, [
    ["error", "script_error"],
    ["warn", "unhandled_rejection"],
    ["error", "render_error"],
  ]);
});
