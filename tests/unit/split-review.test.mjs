import assert from "node:assert/strict";
import { test } from "vitest";
import { chapterChanges } from "../../src/lib/projects/split-review.ts";
import { sourcePrompt, utf8Excerpt } from "../../src/lib/projects/source-context.ts";
const chapter = (id, sourceId, start, end, title = "第一章", extra = {}) => ({ id, sourceId, start, end, title, heading: start, volumeId: null, predecessorIds: [], ...extra });

test("regenerated candidate ids do not imply new chapters; changed ranges remain reviewable", () => {
  const before = [chapter("a", "source", 0, 100), chapter("b", "source", 100, 200, "第二章")];
  const after = [chapter("new-a", "source", 0, 50), chapter("new", "source", 50, 100, "补充章"), chapter("new-b", "source", 100, 200, "第二章")];
  const result = chapterChanges(before, after, [], []);
  assert.deepEqual(result.map(item => item.kind), ["changed", "added", "unchanged"]);
  assert.equal(result[0].before.end, 100);
  assert.equal(result[0].after.end, 50);
});
test("same offsets in different sources remain distinct and removed rows are retained", () => {
  const result = chapterChanges([chapter("a", "one", 0, 100), chapter("b", "two", 0, 100)], [chapter("c", "two", 0, 100)], [], []);
  assert.deepEqual(result.map(item => [item.chapter.sourceId, item.kind]), [["one", "removed"], ["two", "unchanged"]]);
});
test("review compares titles and semantic volume identity, not regenerated ids", () => {
  const before = [chapter("a", "source", 0, 100, "旧标题", { volumeId: "v1" })];
  const after = [chapter("b", "source", 0, 100, "新标题", { volumeId: "v2" })];
  const volume = (id, line = 0) => ({ id, title: "第一卷", line, sourceId: "source", manual: false });
  assert.equal(chapterChanges(before, after, [volume("v1")], [volume("v2")])[0].kind, "changed");
  after[0].title = "旧标题";
  assert.equal(chapterChanges(before, after, [volume("v1")], [volume("v2")])[0].kind, "unchanged");
  assert.equal(chapterChanges(before, after, [volume("v1")], [volume("v2", 12)])[0].kind, "changed");
});
test("large directories compare without quadratic source discovery", () => {
  const before = Array.from({ length: 10000 }, (_, i) => chapter(`${i}`, `source-${i % 3}`, i, i + 1));
  const after = before.map(item => ({ ...item, id: `new-${item.id}` }));
  assert.equal(chapterChanges(before, after, [], []).filter(item => item.kind !== "unchanged").length, 0);
});
test("source previews respect Unicode boundaries and long prompts preserve the complete input and reference", () => {
  assert.equal(utf8Excerpt("中🙂文", 6), "中");
  const input = "正文".repeat(1000);
  const context = { sourceId: "source", line: 21, text: "🙂中文é".repeat(1000) };
  const prompt = sourcePrompt(input, context, "合成小说.txt", "原文引用");
  assert.ok(new TextEncoder().encode(prompt).length > 8192);
  assert.ok(prompt.endsWith(context.text));
  assert.ok(prompt.startsWith(input));
  assert.ok(prompt.includes("line=21"));
  assert.ok(!prompt.includes("\uFFFD"));
  assert.equal(sourcePrompt(input, null, "", ""), input);
});
