import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  headless: true,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  // Exercise the actual annotated reader and its clipboard event handler.
  await page.goto(`${process.env.FIXTURE_URL || "http://localhost:1437"}/project/fixture-project?fixture=desktop&analysis=1`);
  await page.getByRole("button", { name: "分析本章", exact: true }).click();
  await page.locator("[data-segment-id]").first().waitFor();
  const copied = await page.evaluate(async () => {
    const { sourceSelection } = await import("/src/lib/projects/source-selection.ts");
    const reader = document.querySelector('[data-slot="source-scroll"]');
    const lines = [...reader.querySelectorAll("[data-source-line]")];
    const selected = lines.slice(0, 3);
    const expected = selected.map((line) => {
      const copy = line.cloneNode(true);
      copy.querySelectorAll(".select-none").forEach((node) => node.remove());
      return copy.textContent;
    }).reduce((text, value, index) => text + (index && !/[\r\n]$/.test(text) ? "\n" : "") + value, "");
    const range = document.createRange();
    range.setStartBefore(selected[0].firstChild);
    range.setEndAfter(selected.at(-1).lastChild);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const raw = range.toString();
    const serialized = sourceSelection(reader)?.text;
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData });
    selected[0].dispatchEvent(event);
    return { expected, raw, serialized, copied: clipboardData.getData("text/plain"), prevented: event.defaultPrevented };
  });
  assert.notEqual(copied.raw, copied.expected, "fixture must include real speaker decoration text");
  assert.equal(copied.serialized, copied.expected);
  assert.equal(copied.copied, copied.expected);
  assert.equal(copied.prevented, true);

  // Real DOM ranges: UTF-16 offsets, nested evidence, element endpoints,
  // backward selection, and remounting between annotated and plain layouts.
  const result = await page.evaluate(async () => {
    const { sourceSelection, sourceSelectionBookmark, restoreSourceSelection } = await import("/src/lib/projects/source-selection.ts");
    const root = document.createElement("div");
    document.body.append(root);
    const first = "甲🌲乙丙\r\n";
    const last = "丁🙂戊己";
    const annotated = () => {
      root.innerHTML = '<pre data-source-line="0"><span><span class="select-none"><button><span>旁白</span></button></span><span id="first"></span><mark id="tail"></mark></span></pre><pre data-source-line="1"><span class="select-none">未知</span><span id="blank"></span></pre><pre data-source-line="2"><span class="select-none"><span>角色甲</span></span><span id="last"></span></pre>';
      root.querySelector("#first").textContent = first.slice(0, 4);
      root.querySelector("#tail").textContent = first.slice(4);
      root.querySelector("#blank").textContent = "\r\n";
      root.querySelector("#last").textContent = last;
    };
    const plain = () => {
      root.replaceChildren(...[first, "\r\n", last].map((text, line) => {
        const element = document.createElement("pre");
        element.dataset.sourceLine = String(line);
        element.textContent = text;
        return element;
      }));
    };
    annotated();
    getSelection().setBaseAndExtent(root.querySelector("#last").firstChild, 4, root.querySelector("#first").firstChild, 1);
    const initial = sourceSelection(root);
    const bookmark = sourceSelectionBookmark(root);
    plain();
    restoreSourceSelection(root, bookmark);
    const inPlain = { value: sourceSelection(root), bookmark: sourceSelectionBookmark(root) };
    annotated();
    restoreSourceSelection(root, bookmark);
    const inAnnotated = { value: sourceSelection(root), bookmark: sourceSelectionBookmark(root) };
    // Endpoints are elements rather than text nodes; exclude labels at both ends.
    getSelection().setBaseAndExtent(root.children[0], 0, root.children[2], root.children[2].childNodes.length);
    const full = sourceSelection(root)?.text;
    restoreSourceSelection(root, { anchorLine: 0, anchorOffset: 999, focusLine: 2, focusOffset: 999 });
    const clamped = sourceSelectionBookmark(root);
    getSelection().removeAllRanges();
    root.remove();
    return { initial, bookmark, inPlain, inAnnotated, full, clamped, expected: first.slice(1) + "\r\n" + last.slice(0, 4), all: first + "\r\n" + last };
  });
  assert.equal(result.initial.text, result.expected);
  assert.deepEqual(result.bookmark, { anchorLine: 2, anchorOffset: 4, focusLine: 0, focusOffset: 1 });
  for (const restored of [result.inPlain, result.inAnnotated]) {
    assert.deepEqual(restored.value, result.initial);
    assert.deepEqual(restored.bookmark, result.bookmark, "source offsets and backward direction survive remounts");
  }
  assert.equal(result.full, result.all);
  assert.deepEqual(result.clamped, { anchorLine: 0, anchorOffset: 7, focusLine: 2, focusOffset: 5 });
  assert.deepEqual(errors, []);
  console.log("PASS annotated clipboard excludes decorations; source offsets, reverse selection, nested/plain remounts, Unicode/CRLF and clamping remain exact");
} finally {
  await browser.close();
}
