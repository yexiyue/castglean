import assert from "node:assert/strict";
import { test } from "vitest";
import { firstRunStep } from "../../src/lib/first-run-step.ts";

test("first-run guide follows real project state", () => {
  assert.equal(firstRunStep([]), "new");
  assert.equal(
    firstRunStep([{ sourceCount: 0, chapterCount: 0 }]),
    "draft",
  );
  assert.equal(
    firstRunStep([
      { sourceCount: 0, chapterCount: 0 },
      { sourceCount: 1, chapterCount: 3 },
    ]),
    "done",
  );
  assert.equal(
    firstRunStep([{ chapterCount: 0 }]),
    "draft",
  );
  assert.equal(
    firstRunStep([
      { chapterCount: 0 },
      { chapterCount: 3 },
    ]),
    "done",
  );
});
