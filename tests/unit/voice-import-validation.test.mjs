import assert from "node:assert/strict";
import { test } from "vitest";
import { importDraftSchema, importEntriesSchema } from "../../src/components/voices/import-validation.ts";

test("import decisions reject missing actions, descriptions and duplicate original identities", () => {
  const row = { index: 0, originalId: "voice", action: "Import", description: "", existingDescription: "" };
  const invalid = importEntriesSchema.safeParse([row, { ...row, index: 1, action: "" }, { ...row, index: 2, description: "provided" }]);
  assert.equal(invalid.success, false);
  assert.deepEqual(invalid.error.issues.map(issue => [issue.message, issue.path[0]]), [["description", 0], ["action", 1], ["duplicate", 2]]);
  assert.equal(importEntriesSchema.safeParse([{ ...row, existingDescription: "package text" }, { ...row, index: 1, action: "ImportAsNew", description: "new" }, { ...row, index: 2, action: "Skip" }]).success, true);
  assert.equal(importDraftSchema.safeParse({ included: [-1], choices: {}, excluded: [], descriptions: {} }).success, false);
});
