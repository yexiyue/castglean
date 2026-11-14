import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

test("sample source is isolated, immutable, paged and uses valid UTF-8 chapter coordinates", async () => {
    const { sampleReader } = await import("../../src/lib/workspace/sample-reader.ts");
    const project = await sampleReader.localProjectSnapshot("sample");
    const source = project.sources[0];
    let line = 0;
    const lines = [];
    do {
      const page = await sampleReader.localProjectText(project.id, source.id, line, 2);
      assert.equal(page.sha256, source.sha256);
      lines.push(...page.lines);
      line = page.nextLine;
    } while (line !== null);
    const text = lines.map((item) => item.text).join("");
    const bytes = Buffer.from(text, "utf8");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
    assert.equal(bytes.length, source.bytes);
    for (const [index, item] of lines.entries()) {
      assert.equal(item.line, index);
      assert.equal(bytes.subarray(item.start, item.end).toString("utf8"), item.text);
    }
    for (const chapter of project.chapters) {
      const snapshot = await sampleReader.chapterAnalysisSnapshot(project.id, chapter.id);
      assert.deepEqual([snapshot.binding.start, snapshot.binding.end], [chapter.start, chapter.end]);
      assert.equal(snapshot.versionId, null);
      assert.equal(lines[chapter.heading].start, chapter.start);
      assert.ok(bytes.subarray(chapter.start, chapter.end).toString("utf8").startsWith(chapter.title));
    }
    project.title = "changed";
    lines[0].text = "changed";
    assert.equal((await sampleReader.localProjectSnapshot("sample")).title, "夜航灯");
    assert.notEqual((await sampleReader.localProjectText("sample", source.id, 0, 1)).lines[0].text, "changed");
    await assert.rejects(sampleReader.localProjectSnapshot("real-project"));
    await assert.rejects(sampleReader.localProjectText("sample", "other", 0, 1));
    await assert.rejects(sampleReader.chapterAnalysisSnapshot("sample", "other"));
});
