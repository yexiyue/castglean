import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("http://localhost:1437/models?fixture=desktop&designAvailability=1");
  const statusLink = page.locator('[data-slot="desktop-bar"] a[href="/models"]');
  await statusLink.waitFor();
  assert.equal(await statusLink.getAttribute("role"), null);
  const modelNav = page.getByRole("link", { name: "模型中心", exact: true });
  assert.equal(await modelNav.getAttribute("aria-current"), "page");
  assert.deepEqual(await modelNav.evaluate(el => { const style = getComputedStyle(el); return [style.height, style.paddingLeft, style.borderRadius]; }), ["32px", "8px", "8px"]);
  const voiceNav = page.getByRole("link", { name: "音色中心", exact: true });
  await voiceNav.focus(); await voiceNav.press("Space");
  assert.equal(new URL(page.url()).pathname, "/models");
  await voiceNav.press("Enter"); await page.waitForURL(url => url.pathname === "/voices");
  await page.goBack(); await page.getByRole("link", { name: "模型中心", exact: true }).waitFor();
  await page.getByRole("tab", { name: "表格视图" }).click();
  await page.getByRole("button", { name: "Kokoro", exact: true }).waitFor();
  await page.getByRole("button", { name: "Kokoro", exact: true }).click();
  const detail = page.getByRole("dialog"); await detail.waitFor();
  assert.equal(await detail.evaluate(element => getComputedStyle(element).padding), "0px");
  await page.keyboard.press("Escape"); await detail.waitFor({ state: "hidden" });
  const checkColumns = async (name, count) => {
    const nodes = page.locator(`[class*="resource-${name}-columns"]`);
    assert.ok((await nodes.count()) >= 2);
    const columns = await nodes.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).gridTemplateColumns));
    assert.equal(columns[0].split(" ").length, count);
    for (const row of columns.slice(1)) {
      assert.equal(row.split(" ").length, count);
      assert.equal(columns[0], row);
    }
  };
  await checkColumns("model", 5);
  await page.getByRole("tab", { name: "音色设计" }).click();
  await page.getByRole("button", { name: /Qwen Voice Design/ }).waitFor();
  await checkColumns("design", 4);
  await page.getByRole("tab", { name: "卡片视图" }).click();
  const cards = page.locator(".resource-card-columns");
  assert.notEqual(await cards.evaluate((element) => getComputedStyle(element).gridTemplateColumns), "none");
  await page.setViewportSize({ width: 520, height: 680 });
  await page.getByRole("tab", { name: "表格视图" }).click();
  const compact = page.locator(".resource-compact-columns").first();
  assert.equal((await compact.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).split(" ").length, 2);
  await page.goto("http://localhost:1437/voices?fixture=desktop&manyPresetVoices=1");
  await page.getByRole("searchbox", { name: "搜索预置音色" }).fill("公开音色 149");
  await page.getByRole("button", { name: /公开音色 149 很长的名称/ }).click();
  const voiceDetail = page.getByRole("dialog");
  const voiceTitle = voiceDetail.getByRole("heading", { name: /公开音色 149 很长的名称/ });
  await voiceTitle.waitFor();
  for (const node of [voiceTitle, voiceDetail.locator('[data-slot="dialog-description"]').getByText("很长的模型名称用于区分不同来源和确认可访问名称", { exact: true })]) {
    assert.equal(await node.evaluate(el => getComputedStyle(el).textOverflow), "clip");
    assert.equal(await node.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  }
  console.log("PASS resource card and table columns at wide and narrow sizes");
} finally {
  await browser.close();
}
