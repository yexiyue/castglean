import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const errors = [];
async function open(query) {
 const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
 page.setDefaultTimeout(10000); page.on("pageerror", e => errors.push(e.message));
 await page.goto(`http://localhost:1437/__workbench?${query}`, { timeout: 60000 });
 await page.getByRole("textbox", { name: "分章问题或补充说明", exact: true }).waitFor();
 return page;
}
async function info(page) { await page.getByRole("button", { name: "会话信息", exact: true }).click(); return page.locator('[data-slot="context-usage"]'); }
try {
 let page = await open("usage=1&window=1");
 let context = await info(page);
 await context.getByText("25%", { exact: true }).waitFor();
 assert.equal(await context.getByRole("progressbar").getAttribute("aria-valuenow"), "25");
 await context.getByText("2,400", { exact: true }).waitFor();
 await context.getByText("1,000", { exact: true }).waitFor();
 assert.equal(await context.getByText(/\/64/).count(), 0);
 await page.keyboard.press("Escape");
 await page.getByRole("combobox", { name: "诊断模型", exact: true }).selectOption("connection:other-model");
 assert.equal(await page.getByRole("checkbox").count(), 0);
 context = await info(page);
 // Last request still belongs to the original model, never divide by the new model's window.
 await context.getByText("25%", { exact: true }).waitFor();
 await context.getByText("上次请求 · Fixture", { exact: true }).waitFor();
 await page.keyboard.press("Escape");
 const input = page.getByRole("textbox", { name: "分章问题或补充说明", exact: true });
 const text = "超长输入🙂".repeat(1500);
 await input.fill(text);
 await page.getByRole("button", { name: "发送", exact: true }).click();
 await page.waitForFunction(() => window.fixture.calls.some(c => c.command === "ai_start"));
 const request = await page.evaluate(() => window.fixture.calls.find(c => c.command === "ai_start").args.request);
 assert.equal(request.configuration.selection.modelId, "other-model");
 assert.equal(request.confirmRebind, true);
 assert.equal(request.trigger.message, text);
 await page.close();
 for (const query of ["usage=1", "window=1", "usage=1&window=1&rebind=1"]) {
  page = await open(query); context = await info(page);
  await context.getByText("未知", { exact: true }).waitFor();
  assert.equal(await context.getByRole("progressbar").count(), 0);
  await page.close();
 }
 page = await open("status=running&usage=1&window=1");
 const select = page.getByRole("combobox", { name: "诊断模型", exact: true });
 await select.selectOption("connection:other-model");
 assert.equal(await select.inputValue(), "connection:other-model");
 assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.command === "ai_start" || c.command === "ai_cancel").length), 0);
 await page.getByRole("button", { name: "停止", exact: true }).click();
 await page.getByRole("button", { name: "发送", exact: true }).waitFor();
 assert.equal(await select.inputValue(), "connection:other-model");
 await page.getByRole("textbox", { name: "分章问题或补充说明", exact: true }).fill("停止后使用新模型");
 await page.getByRole("button", { name: "发送", exact: true }).click();
 await page.waitForFunction(() => window.fixture.calls.some(c => c.command === "ai_start"));
 assert.equal(await page.evaluate(() => window.fixture.calls.find(c => c.command === "ai_start").args.request.configuration.selection.modelId), "other-model");
 await page.close();
 assert.deepEqual(errors, []);
 console.log("PASS provider usage/window/unknown/revision states, original-model attribution, uncapped exact input, direct model selection, active-run isolation and retained next model");
} finally { await browser.close(); }
