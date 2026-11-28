import { chapterTask } from "../chapter-task.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "../managed-browser.mjs";

test("source-selection", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1024, height: 680 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  // Exercise the actual annotated reader and its clipboard event handler.
  await page.goto(`${process.env.FIXTURE_URL || "http://localhost:1437"}/project/fixture-project?fixture=desktop&analysis=1`);
  await (await chapterTask(page, "分析本章角色")).click();
  await page.locator("[data-segment-id]").first().waitFor();
  const fragment = page.locator("[data-segment-id]").nth(1);
  const sourceLine = page.locator('[data-source-line="1"]');
  const bounds = await sourceLine.boundingBox();
  const toggle = page.getByRole("button", { name: "显示角色标记", exact: true });
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await sourceLine.boundingBox(), bounds, "markers do not change the reading layout");
  await fragment.hover();
  const fragmentActions = page.locator('[data-source-actions="segment"]');
  const repair = fragmentActions.getByRole("button", { name: "修正归属" });
  await repair.waitFor();
  assert.equal((await repair.innerText()).trim(), "", "the compact action is icon-only");
  await fragmentActions.waitFor();
  const toolbarRect = await fragmentActions.boundingBox();
  const readerRect = await page.locator('[data-slot="source-scroll"]').boundingBox();
  assert.ok(toolbarRect.y >= readerRect.y, "near the top, the toolbar stays out of the window chrome");
  await mkdir("src-tauri/target/workflow-simplification", { recursive: true });
  await page.screenshot({
    path: "src-tauri/target/workflow-simplification/source-inline-review.png",
    animations: "disabled",
  });
  await repair.hover();
  const tooltip = page.locator('[data-slot="tooltip-content"]').filter({ hasText: "修正归属" });
  await tooltip.waitFor();
  await page.screenshot({
    path: "src-tauri/target/workflow-simplification/source-inline-tooltip.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await fragmentActions.waitFor({ state: "hidden" });
  await fragment.press("Enter");
  await repair.focus();
  await tooltip.waitFor();
  await page.keyboard.press("Escape");
  await fragmentActions.waitFor({ state: "hidden" });
  assert.equal(await fragment.evaluate((element) => element === document.activeElement), true);
  await fragment.press("Enter");
  await repair.click();
  await page.getByRole("tab", { name: "片段属性", exact: true, selected: true }).waitFor();
  await sourceLine.evaluate((line) => {
    const range = document.createRange();
    range.selectNodeContents(line);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  const selectionActions = page.locator('[data-source-actions="selection"]');
  await selectionActions.getByRole("button", { name: "从此行分章" }).click();
  const split = page.getByRole("dialog", { name: "从此行分章" });
  assert.match(await split.innerText(), /第 2 行/);
  await split.getByRole("button", { name: "取消" }).click();
  assert.equal(await page.evaluate(() => window.fixture.calls.filter(({ command }) => command === "local_project_edit").length), 0);
  await page.evaluate(() => getSelection().removeAllRanges());
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
  const grouped = await page.evaluate(async () => {
    const { mountRoleFixture } = await import("/tests/helpers/role-source-fixture.tsx");
    const { sourceByteSelection, sourceSelection, sourceSelectionBookmark, restoreSourceSelection } = await import("/src/lib/projects/source-selection.ts");
    const fixture = mountRoleFixture();
    const root = document.querySelector("#role-fixture");
    const leaves = [...root.querySelectorAll("[data-source-line]")];
    const range = document.createRange(); range.setStart(leaves[0], 0); range.setEnd(leaves.at(-1), leaves.at(-1).childNodes.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    const copied = sourceSelection(root).text;
    const bookmark = sourceSelectionBookmark(root);
    getSelection().removeAllRanges(); restoreSourceSelection(root, bookmark);
    const restored = sourceSelection(root).text;
    const groups = root.querySelectorAll("[data-segment-id]").length;
    const raw = range.toString();
    const walker = document.createTreeWalker(leaves[0], NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.data.indexOf("山");
      if (start >= 0 && !node.parentElement.closest(".select-none")) {
        getSelection().setBaseAndExtent(node, start, node, start + 1);
        break;
      }
    }
    const selectedBytes = sourceByteSelection(root);
    fixture.dispose(); return { expected: fixture.text, copied, restored, groups, raw, selectedBytes };
  });
  assert.equal(grouped.groups, 4, "same-line roles remain inline and continued roles retain their identity");
  assert.notEqual(grouped.raw, grouped.expected, "fixture includes visible role decorations");
  assert.deepEqual(grouped.selectedBytes, { start: 3, end: 6 }, "BOM bytes remain part of the original coordinate system");
  assert.equal(grouped.copied, grouped.expected, "visual role markers do not alter CRLF or Unicode");
  assert.equal(grouped.restored, grouped.expected, "bookmarks restore across same-line role fragments");
  assert.deepEqual(errors, []);
  console.log("PASS annotated clipboard excludes decorations; source offsets, reverse selection, nested/plain remounts, Unicode/CRLF and clamping remain exact");
} finally {
  await browser.close();
}
});
