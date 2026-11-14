import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:1437/tests/workspace-state-fixture.html");
  await page.getByRole("button", { name: "更新并离开" }).click();
  await page.getByRole("button", { name: "重新打开" }).click();
  assert.equal(await page.locator("output").first().textContent(), "2");
  const draft = page.getByLabel("scoped draft");
  assert.equal(await draft.textContent(), "10");
  await page.getByRole("button", { name: "修改当前草稿" }).click();
  await page.getByRole("button", { name: "保留旧回调" }).click();
  await page.getByRole("button", { name: "切换键" }).click();
  assert.equal(await draft.textContent(), "10");
  await page.evaluate(() => window.lateDraftUpdate());
  assert.equal(await draft.textContent(), "10");
  await page.getByRole("button", { name: "切换工程" }).click();
  assert.equal(await draft.textContent(), "20");
  await page.getByRole("button", { name: "修改当前草稿" }).click();
  await page.getByRole("button", { name: "切换工程" }).click();
  await page.getByRole("button", { name: "切换键" }).click();
  assert.equal(await draft.textContent(), "111");
  await page.getByRole("button", { name: "切换键" }).click();
  await page.getByRole("button", { name: "切换工程" }).click();
  assert.equal(await draft.textContent(), "21");
  console.log("PASS consecutive session draft updates survive immediate unmount");
} finally { await browser.close(); }
