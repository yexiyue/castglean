import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
  await page.goto("http://localhost:1437/voices?fixture=desktop&manyVoices=1&library=mine&voiceLibraryDeletion=1");
  const search = page.getByRole("searchbox", { name: "搜索我的音色" });
  const first = page.getByRole("button", { name: "查看音色「山风」" });
  await first.click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(el => document.activeElement === el, await first.elementHandle());
  for (const name of ["山风", "海潮"]) {
    await page.getByRole("button", { name: `查看音色「${name}」` }).click();
    await page.getByRole("button", { name: "管理音色", exact: true }).click();
    await page.getByRole("button", { name: "删除音色…" }).click();
    await page.getByText(`已删除音色「${name}」。`).waitFor();
    await page.waitForFunction(el => document.activeElement === el, await search.elementHandle());
    assert.equal(await page.getByRole("button", { name: `查看音色「${name}」` }).count(), 0);
  }
  assert.equal(await page.getByRole("button", { name: "查看音色「山雨」" }).count(), 1);
  console.log("PASS ordinary close restores row focus and deleting a voice restores search focus");
} finally { await browser.close(); }
