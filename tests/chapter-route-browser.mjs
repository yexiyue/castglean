import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const errors = [];
const reader = page => page.locator('[data-slot="source-scroll"]');
const footer = page => page.locator('[data-slot="chapter-reading-end"]');
const settle = page => page.waitForFunction(() => document.querySelector('[data-slot="source-scroll"]')?.getAttribute("aria-busy") === "false");
async function open(query = "", width = 1440) {
 const page = await browser.newPage({ viewport: { width, height: 780 } }); page.setDefaultTimeout(15000);
 page.on("pageerror", e => errors.push(e.message));
 await page.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&chapteredReader=1${query}`);
 await page.locator('[data-source-line="0"]').waitFor(); await settle(page); return page;
}
async function end(page) {
 for (let i = 0; i < 40 && !await footer(page).count(); i++) {
  const count = await page.evaluate(() => window.fixture.calls.filter(c => c.command === "local_project_text").length);
  await reader(page).evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(n => document.querySelector('[data-slot="chapter-reading-end"]') || window.fixture.calls.filter(c => c.command === "local_project_text").length > n, count);
  await settle(page);
 }
 await footer(page).waitFor();
}
async function jump(page, line) {
 await page.getByRole("button", { name: "转到行", exact: true }).click();
 const dialog = page.getByRole("dialog", { name: "转到行" });
 await dialog.getByRole("spinbutton", { name: "原文行号" }).fill(String(line + 1));
 await dialog.getByRole("button", { name: "前往" }).click();
 await page.locator(`[data-source-line="${line}"]`).waitFor(); await settle(page);
}
let page;
try {
 page = await open();
 await end(page);
 assert.deepEqual(await reader(page).locator('[data-source-line]').evaluateAll(nodes => nodes.map(n => Number(n.dataset.sourceLine))), [0, 1, 2]);
 assert.equal(await footer(page).getByRole("button", { name: "上一章" }).isDisabled(), true);
 await footer(page).getByRole("button", { name: "下一章" }).click();
 await page.getByRole("heading", { name: "第一章 山雨", exact: true }).waitFor();
 await page.locator('[data-source-line="3"]').waitFor();
 assert.equal(await page.locator('[data-source-line="2"]').count(), 0);
 await end(page);
 assert.equal(await page.locator('[data-source-line="73"]').count(), 0);
 const calls = await page.evaluate(() => window.fixture.calls.filter(c => c.command === "local_project_text"));
 assert.ok(calls.every(c => c.args.sourceId === "source" && c.args.line < 73 && c.args.line + c.args.count <= 73), "reads stop at the chapter boundary");
 const count = calls.length;
 await reader(page).evaluate(el => { el.scrollTop = el.scrollHeight; }); await settle(page);
 assert.equal((await page.evaluate(() => window.fixture.calls.filter(c => c.command === "local_project_text"))).length, count);
 await footer(page).getByRole("button", { name: "下一章" }).click();
 await page.getByRole("heading", { name: "第二章 来客", exact: true }).waitFor(); await end(page);
 assert.deepEqual(await reader(page).locator('[data-source-line]').evaluateAll(nodes => nodes.map(n => Number(n.dataset.sourceLine))), [73, 74, 75]);
 await footer(page).getByRole("button", { name: "下一章" }).click();
 await page.getByRole("heading", { name: "第二份原文", exact: true }).waitFor(); await end(page);
 assert.ok((await page.locator('[data-source-line="0"]').textContent()).includes("source-2"));
 assert.equal(await footer(page).getByRole("button", { name: "下一章" }).isDisabled(), true);
 await footer(page).getByRole("button", { name: "上一章" }).click();
 await page.getByRole("heading", { name: "第二章 来客", exact: true }).waitFor();
 await page.getByRole("tab", { name: /待检查/ }).click();
 await page.getByRole("region", { name: "待检查", exact: true }).getByRole("button").first().click();
 await page.locator('[data-source-line="74"]').waitFor();
 await page.getByRole("heading", { name: "第二章 来客", exact: true }).waitFor();
 await jump(page, 4); await page.getByRole("heading", { name: "第一章 山雨", exact: true }).waitFor();
 await jump(page, 74); await page.getByRole("heading", { name: "第二章 来客", exact: true }).waitFor();
 assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
 await page.close();
 page = await open("&shortpages=1");
 await jump(page, 40);
 await page.getByRole("heading", { name: "第一章 山雨", exact: true }).waitFor();
 await page.locator('[data-source-row="40"]').locator("..").getByRole("button", { name: "从此行分章" }).click();
 let dialog = page.getByRole("dialog", { name: "从此行分章" });
 await dialog.getByRole("button", { name: "确认调整" }).click();
 const splitChapter = page.getByRole("treeitem", { name: /人工新章/ });
 await splitChapter.waitFor(); await end(page);
 assert.equal(await page.locator('[data-source-line="40"]').count(), 0, "the prior chapter ends at the new boundary");
 await splitChapter.click();
 await page.getByRole("heading", { name: "人工新章", exact: true }).waitFor();
 await page.locator('[data-source-line="40"]').waitFor();
 assert.equal(await page.locator('[data-source-line="39"]').count(), 0);
 await page.locator('[data-source-row="40"]').locator("..").getByRole("button", { name: "合并此章" }).click();
 dialog = page.getByRole("dialog", { name: "合并此章" });
 await dialog.getByRole("button", { name: "确认调整" }).click();
 await page.getByRole("heading", { name: "第一章 山雨", exact: true }).waitFor();
 await page.locator('[data-source-line="40"]').waitFor();
 assert.equal(await page.locator('[data-source-line="73"]').count(), 0);
 assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.command === "local_project_edit").length), 2);
 assert.deepEqual(await page.evaluate(() => window.fixture.unexpected), []);
 await page.close();
 for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) {
  page = await open(`&locale=${locale}&theme=${theme}`, 1024); await end(page);
  await footer(page).getByText(locale === "zh" ? "本章结束" : "End of chapter", { exact: true }).waitFor();
  assert.equal(await footer(page).evaluate(el => el.scrollWidth > el.clientWidth), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.close();
 }
 assert.deepEqual(errors, []);
 console.log("PASS actual chapter boundaries, explicit navigation across files and four locale/theme layouts");
} catch (error) { if (page && !page.isClosed()) console.error((await page.locator("body").innerText()).slice(-2000)); throw error; } finally { await browser.close(); }
