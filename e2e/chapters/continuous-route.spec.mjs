import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("continuous-route", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1440, height: 780 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message)); page.setDefaultTimeout(15000);
const region = page.locator('[data-slot="source-scroll"]');
const calls = () => page.evaluate(() => window.fixture.calls.filter(call => call.command === "local_project_text"));
const settle = () => page.waitForFunction(() => document.querySelector('[data-slot="source-scroll"]')?.getAttribute("aria-busy") === "false");
try {
 await page.goto("http://localhost:1437/project/fixture-project?fixture=desktop&continuousReader=1");
 await page.locator('[data-source-line="0"]').waitFor(); await settle();
 const initial = await calls();
 const next = Math.max(...initial.map(call => call.args.line + call.args.count));
 await page.evaluate(line => { window.fixture.failTextFrom = line; }, next);
 for (let i = 0; i < 5 && !await page.getByRole("alert").filter({ hasText: "无法读取原文" }).isVisible(); i++) {
  await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(150);
 }
 await page.getByRole("alert").filter({ hasText: "无法读取原文" }).waitFor();
 assert.ok(await page.locator('[data-source-line]').count() > 0, "loaded source remains visible");
 const failed = (await calls()).length;
 await region.evaluate(el => { el.scrollTop = el.scrollHeight - 1; });
 await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 assert.equal((await calls()).length, failed, "failure does not cause automatic read loops");
 await page.evaluate(() => { window.fixture.failTextFrom = null; });
 await page.getByRole("button", { name: "重新读取", exact: true }).click();
 await page.waitForFunction(n => window.fixture.calls.filter(call => call.command === "local_project_text").length > n, failed); await settle();
 await page.getByRole("alert").filter({ hasText: "无法读取原文" }).waitFor({ state: "hidden" });
 for (let i = 0; i < 18; i++) {
  const count = (await calls()).length;
  await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(n => window.fixture.calls.filter(call => call.command === "local_project_text").length > n, count); await settle();
 }
 assert.ok(await region.locator('[data-source-line]').count() < 160, "continuous reading retains a bounded DOM");
 const firstReads = (await calls()).filter(c => c.args.line === 0).length;
 await region.evaluate(el => { el.scrollTop = 0; });
 await page.locator('[data-source-line="0"]').waitFor(); await settle();
 assert.ok((await calls()).filter(c => c.args.line === 0).length > firstReads, "evicted first block is read again");
 await page.locator('[data-source-line="29"]').scrollIntoViewIfNeeded();
 await page.locator('[data-source-line="31"]').waitFor();
 const expected = "边界原文🌲，前一块的结尾。\r\n\r\n下一块中文🙂，保持原文。\r\n";
 await page.evaluate(() => { const a = document.querySelector('[data-source-line="29"]'), b = document.querySelector('[data-source-line="31"]'); getSelection().setBaseAndExtent(a.firstChild, 0, b.firstChild, b.firstChild.length); });
 await page.getByRole("button", { name: "询问选中的原文", exact: true }).waitFor();
 const copied = await region.evaluate(el => { const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data })); return data.getData("text/plain"); });
 assert.equal(copied, expected);
 for (let i = 0; i < 4; i++) {
  const count = (await calls()).length;
  await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(n => window.fixture.calls.filter(call => call.command === "local_project_text").length > n, count); await settle();
 }
 assert.equal(await page.locator('[data-source-line="29"]').count(), 1, "selected source remains mounted while scrolling");
 await page.getByRole("button", { name: "询问选中的原文", exact: true }).click();
 await page.getByRole("button", { name: "移除引用", exact: true }).waitFor();
 const input = page.getByRole("textbox", { name: "工程问题或补充说明" });
 await input.fill("检查跨块原文");
 await page.getByRole("button", { name: "发送", exact: true }).click();
 await page.waitForFunction(() => window.fixture.calls.some(call => call.command === "ai_start"));
 const message = await page.evaluate(() => window.fixture.calls.find(call => call.command === "ai_start").args.request.trigger.message);
 assert.ok(message.includes(expected), "assistant receives the exact selected source text");
 assert.ok(message.includes("chapter_id=continuous-one"));
 await page.evaluate(() => getSelection().removeAllRanges());
 await page.getByRole("button", { name: "转到行", exact: true }).click();
 const jumpDialog = page.getByRole("dialog", { name: "转到行" });
 await jumpDialog.getByRole("spinbutton", { name: "原文行号" }).fill("601");
 await jumpDialog.getByRole("button", { name: "前往" }).click();
 const row = page.locator('[data-source-row="600"]'); await row.waitFor(); await settle();
 const top = await row.evaluate(el => el.getBoundingClientRect().top);
 assert.ok(top >= 80 && top < 300);
 const relativeTop = await row.evaluate(el => el.getBoundingClientRect().top - el.closest('[data-slot="source-scroll"]').getBoundingClientRect().top);
 await page.setViewportSize({ width: 1024, height: 780 });
 await page.waitForFunction(y => { const el = document.querySelector('[data-source-row="600"]'); return Math.abs(el.getBoundingClientRect().top - el.closest('[data-slot="source-scroll"]').getBoundingClientRect().top - y) < 3; }, relativeTop);
 const anchor = await region.evaluate(el => { const first = el.querySelector('[data-source-row]'); el.scrollTop = 0; return { line: Number(first.dataset.sourceRow), top: first.getBoundingClientRect().top, reads: window.fixture.calls.filter(c => c.command === "local_project_text").length }; });
 await page.waitForFunction(a => window.fixture.calls.filter(c => c.command === "local_project_text").slice(a.reads).some(c => c.args.line < a.line), anchor); await settle();
 await page.waitForFunction(a => { const row = document.querySelector(`[data-source-row="${a.line}"]`); return row && Math.abs(row.getBoundingClientRect().top - a.top) < 3 && document.querySelector('[data-slot="source-scroll"]').scrollTop > 0; }, anchor);
 await page.getByRole("button", { name: "转到行", exact: true }).click();
 const again = page.getByRole("dialog", { name: "转到行" });
 await again.getByRole("spinbutton", { name: "原文行号" }).fill("601");
 await again.getByRole("button", { name: "前往" }).click();
 await row.waitFor(); await settle();
 assert.ok((await row.boundingBox()).y < 300, "repeating a jump returns to the target");
 assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
 for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) {
  const narrow = await browser.newPage({ viewport: { width: 1024, height: 780 } });
  narrow.on("pageerror", error => errors.push(error.message));
  await narrow.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&continuousReader=1&locale=${locale}&theme=${theme}`);
  await narrow.locator('[data-source-line="0"]').waitFor();
  await narrow.waitForFunction(() => document.querySelector('[data-slot="source-scroll"]')?.getAttribute("aria-busy") === "false");
  const reads = await narrow.evaluate(() => window.fixture.calls.filter(c => c.command === "local_project_text").length);
  await narrow.locator('[data-slot="source-scroll"]').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await narrow.waitForFunction(n => window.fixture.calls.filter(c => c.command === "local_project_text").length > n, reads);
  assert.equal(await narrow.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(await narrow.evaluate(() => window.fixture.unexpected), []);
  await narrow.close();
 }
 assert.deepEqual(errors, []);
 console.log("PASS actual route: incremental failure, explicit retry, bounded reading and rehydration");
} finally { await browser.close(); }
});
